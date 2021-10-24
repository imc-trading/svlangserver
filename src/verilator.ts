import {
    DiagnosticSeverity,
    Diagnostic,
    Range,
    TextDocument
} from "vscode-languageserver";

import {
    SystemVerilogIndexer
} from "./svindexer";

import {
    ConnectionLogger,
    fsWriteFileSync,
    fsUnlinkSync,
    getTmpDirSync
} from "./genutils";

import * as child from 'child_process';
const path = require('path');

type TimerType = ReturnType<typeof setTimeout>;

export class VerilatorDiagnostics {
    private _indexer: SystemVerilogIndexer;
    private _command: string = "";
    private _defines: string[] = [];
    private _optionsFile: string = "";
    private _alreadyRunning: Map<string, [child.ChildProcess, [Boolean]]> = new Map();
    private _fileWaiting: Map<string, [TimerType, any]> = new Map();
    private _tmpDir;
    private _freeTmpFileNums: number[] = [];
    private _totalTmpFileNums: number = 0;

    constructor(indexer: SystemVerilogIndexer) {
        this._indexer = indexer;
        this._tmpDir = getTmpDirSync();
    }

    public setCommand(cmd: string) {
        this._command = cmd;
    }

    public setOptionsFile(file: string) {
        this._optionsFile = file;
    }

    public setDefines(defines: string[]) {
        this._defines = defines || [];
    }

    private _getFreeTmpFileNum(): number {
        if (this._freeTmpFileNums.length <= 0) {
            this._freeTmpFileNums.push(this._totalTmpFileNums++);
        }
        return this._freeTmpFileNums.shift();
    }

    private _lintImmediate(file: string, text?: string): Promise<Diagnostic[]> {
        let _kill = () => {
            let [proc, statusRef] = this._alreadyRunning.get(file);
            statusRef[0] = false;
            proc.kill();
        };

        if (this._alreadyRunning.has(file)) {
            //ConnectionLogger.log(`DEBUG: Killing already running command to start a new one`);
            _kill();
        }
        return new Promise((resolve) => {
            let actFile: string = text == undefined ? file : path.join(this._tmpDir.name, "sources", file);
            let optionsFile: string = this._optionsFile;
            let vcTmpFileNum: number;
            if (text != undefined) {
                fsWriteFileSync(actFile, text);

                // if file write takes too long and another process started in the interim
                if (this._alreadyRunning.has(file)) {
                    //ConnectionLogger.log(`DEBUG: Killing already running command to start a new one`);
                    _kill();
                }

                if (this._indexer.fileHasPkg(file)) {
                    let vcFileContent: string = this._indexer.getOptionsFileContent()
                                                                .map(line => { return (line == file) ? actFile : line; })
                                                                .join('\n');
                    vcTmpFileNum = this._getFreeTmpFileNum();
                    let tmpVcFile: string = path.join(this._tmpDir.name, "vcfiles", `lint${vcTmpFileNum}.vc`);
                    fsWriteFileSync(tmpVcFile, vcFileContent);
                    optionsFile = tmpVcFile;

                    // if file write takes too long and another process started in the interim
                    if (this._alreadyRunning.has(file)) {
                        //ConnectionLogger.log(`DEBUG: Killing already running command to start a new one`);
                        _kill();
                    }
                }
            }

            let definesArg: string = this._defines.length > 0 ? this._defines.map(d => ` +define+${d}`).join('') : "";
            let optionsFileArg: string = optionsFile ? ' -f ' + optionsFile : "";
            let actFileArg: string = (this._indexer.fileHasPkg(file)) ? "" : " " + actFile;
            let command: string = this._command + definesArg + optionsFileArg + actFileArg;
            let statusRef: [Boolean] = [true];
            //ConnectionLogger.log(`DEBUG: verilator command ${command}`);
            this._alreadyRunning.set(file, [
                child.exec(command, (error, stdout, stderr) => {
                    if (optionsFile != this._optionsFile) {
                        this._freeTmpFileNums.push(vcTmpFileNum);
                    }
                    if (statusRef[0]) {
                        this._alreadyRunning.delete(file);
                        resolve(this._parseDiagnostics(error, stdout, stderr, actFile));
                    }
                    else {
                        resolve([]);
                    }
                }),
                statusRef
            ]);
        });
    }

    public lint(file: string, text?: string): Promise<Diagnostic[]> {
        try {
            if (text == undefined) {
                return this._lintImmediate(file, text)
                            .catch(error => {
                                ConnectionLogger.error(error);
                                return [];
                            });
            }
            else {
                if (this._fileWaiting.has(file)) {
                    let [waitTimer, resolver] = this._fileWaiting.get(file);
                    clearTimeout(waitTimer);
                    resolver(false);
                }

                return new Promise(resolve => {
                    this._fileWaiting.set(file, [setTimeout(resolve, 1000, true), resolve]);
                }).then((success) => {
                    if (!!success) {
                        this._fileWaiting.delete(file);
                        return this._lintImmediate(file, text);
                    }
                    return [];
                }).catch(error => {
                    ConnectionLogger.error(error);
                    return [];
                });
            }
        } catch(error) {
            ConnectionLogger.error(error);
            return Promise.resolve([]);
        }
    }

    private _parseDiagnostics(error: child.ExecException, stdout: string, stderr: string, file: string): Diagnostic[] {
        let diagnostics: Diagnostic[] = [];
        let lines = stderr.split(/\r?\n/g);

        // Parse output lines
        lines.forEach((line, i) => {
            if (line.startsWith('%')) {
                // remove the %
                line = line.substr(1)

                if (line.search("Unsupported: Interfaced port on top level module") > 0) {
                    return;
                }

                // was it for a submodule
                if (line.search(file) > 0) {
                    // remove the filename
                    line = line.replace(file, '');
                    line = line.replace(/\s+/g, ' ').trim();

                    let terms = this._splitTerms(line);
                    if (terms == null) {
                        return;
                    }

                    let severity = this._getSeverity(terms[1]);
                    let message = "";
                    let lineNum = parseInt(terms[4]) - 1;
                    let colNum = 0;
                    if (terms[5]) {
                        colNum = parseInt(terms[5]) - 1;
                    }
                    message = terms.slice(6).join(' ')

                    if (lineNum != NaN) {
                        diagnostics.push({
                            severity: severity,
                            range: Range.create(lineNum, colNum, lineNum, Number.MAX_VALUE),
                            message: message,
                            code: 'verilator',
                            source: 'verilator'
                        });
                    }
                }
            }
        });

        return diagnostics;
    }

    private _splitTerms(line: string): string[] {
        // RegExp expression for matching Verilog messages
        // Group 1: Severity
        // Group 2: Type (optional)
        // Group 3: Filename (optional)
        // Group 4: Line number
        // Group 6: Column number (optional)
        // Group 7: Message
        const regex = /(Error|Warning)(-[A-Z0-9_]+)?: ([A-Za-z0-9\_\-\.]+)?:(\d+):(?:(\d+):)? (.*)/i;
        const terms = line.match(regex);

        return terms;
    }

    private _getSeverity(severityString: string): DiagnosticSeverity {
        let result: DiagnosticSeverity = DiagnosticSeverity.Information;

        if (severityString.startsWith('Error')) {
            result = DiagnosticSeverity.Error;
        }
        else if (severityString.startsWith('Warning')) {
            result = DiagnosticSeverity.Warning;
        }

        return result;
    }

    public cleanupTmpFiles() {
        this._tmpDir.removeCallback();
    }
}
