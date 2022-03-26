import {
    DiagnosticSeverity,
    Diagnostic,
    Range
} from "vscode-languageserver";

import {
    SystemVerilogIndexer
} from "./svindexer";

import {
    ConnectionLogger,
    fsWriteFileSync,
    getTmpDirSync
} from "./genutils";

import * as child from 'child_process';
const path = require('path');

type TimerType = ReturnType<typeof setTimeout>;

function getVerilatorSeverity(severityString: string): DiagnosticSeverity {
    let result: DiagnosticSeverity = DiagnosticSeverity.Information;

    if (severityString.startsWith('Error')) {
        result = DiagnosticSeverity.Error;
    }
    else if (severityString.startsWith('Warning')) {
        result = DiagnosticSeverity.Warning;
    }

    return result;
}

function parseVerilatorDiagnostics(stdout: string, stderr: string, file: string, whitelistedMessages: RegExp[] = []): Diagnostic[] {
    let diagnostics: Diagnostic[] = [];
    let lines = stderr.split(/\r?\n/g);

    // RegExp expression for matching Verilator messages
    // Group 1: Severity
    // Group 2: Type (optional)
    // Group 3: Filename
    // Group 4: Line number
    // Group 5: Column number (optional)
    // Group 6: Message
    let regex: RegExp = new RegExp(String.raw`%(Error|Warning)(-[A-Z0-9_]+)?: (${file.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}):(\d+):(?:(\d+):)? (.*)`, 'i');

    // Parse output lines
    for (let i = 0; i < lines.length; ++i) {
        const line = lines[i]
        let terms = line.match(regex);
        if (terms != null) {
            let severity = getVerilatorSeverity(terms[1]);
            let message = "";
            let lineNum = parseInt(terms[4]) - 1;
            let colNum = 0;
            let colNumEnd = Number.MAX_VALUE
            if (terms[5]) {
                colNum = parseInt(terms[5]) - 1;
            }
            message = terms[6];

            let messageWhiteListed: Boolean = false;
            for (let whitelistedMessage of whitelistedMessages) {
                if (message.search(whitelistedMessage) >= 0) {
                    messageWhiteListed = true;
                    break;
                }
            }
            if (messageWhiteListed) {
                continue;
            }

            // Match the ^~~~~~~ under the error message
            if (/\s*\^~+/.exec(lines[i + 2])) {
                let startColNum: number = lines[i + 2].indexOf('|') + 2;
                colNum = lines[i + 2].indexOf('^');
                colNum = colNum > startColNum ? colNum - startColNum : colNum;
                colNumEnd = lines[i + 2].lastIndexOf('~');
                colNumEnd = colNumEnd > startColNum ? colNumEnd - startColNum : colNumEnd;
                i += 2;
            }


            if ((lineNum != NaN) && (colNum != NaN)) {
                diagnostics.push({
                    severity: severity,
                    range: Range.create(lineNum, colNum, lineNum, colNumEnd),
                    message: message,
                    code: 'verilator',
                    source: 'verilator'
                });
            }
        }
    }

    return diagnostics;
}

function getIcarusSeverity(severityString: string, message: string): DiagnosticSeverity {
    let result: DiagnosticSeverity = DiagnosticSeverity.Information;

    if (severityString === 'error' || message === 'syntax error') {
        result = DiagnosticSeverity.Error;
    }
    else if (severityString === 'warning') {
        result = DiagnosticSeverity.Warning;
    }

    return result;
}

function parseIcarusDiagnostics (stdout: string, stderr: string, file: string, whitelistedMessages: RegExp[] = []) {
    let diagnostics: Diagnostic[] = [];
    let lines = stderr.split(/\r?\n/g);

    // RegExp expression for matching Icarus messages
    // Group 1: Filename
    // Group 2: Line number
    // Group 3: Severity (optional)
    // Group 4: Message
    let regex: RegExp = new RegExp(String.raw`(${file.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}):(\d+):(?: (error|warning):)? (.*)`, 'i');

    // Parse output lines
    for (let i = 0; i < lines.length; ++i) {
        const line = lines[i]
        let terms = line.match(regex);
        if (terms != null) {
            let message = terms[4];
            let severity = getIcarusSeverity(terms[3], message);
            let lineNum = parseInt(terms[2]) - 1;

            let messageWhiteListed: Boolean = false;
            for (let whitelistedMessage of whitelistedMessages) {
                if (message.search(whitelistedMessage) >= 0) {
                    messageWhiteListed = true;
                    break;
                }
            }
            if (messageWhiteListed) {
                continue;
            }

            if (lineNum != NaN) {
                diagnostics.push({
                    severity: severity,
                    range: Range.create(lineNum, 0, lineNum, Number.MAX_VALUE),
                    message: message,
                    code: 'iverilog',
                    source: 'iverilog'
                });
            }
        }
    }

    return diagnostics;
}

export class VerilogDiagnostics {
    private static readonly _whitelistedMessages: RegExp[] = [
        /Unsupported: Interfaced port on top level module/i
    ];

    private _indexer: SystemVerilogIndexer;
    private _linter: 'icarus' | 'verilator' = 'icarus';
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

    public setLinter(linter: 'icarus' | 'verilator') {
        this._linter = linter;
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
        return new Promise((resolve, reject) => {
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
            let actFileArg: string = " " + actFile;
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
                        switch (this._linter) {
                            case "icarus":
                                resolve(parseIcarusDiagnostics(stdout, stderr, actFile, VerilogDiagnostics._whitelistedMessages));
                                break;
                            case "verilator":
                                resolve(parseVerilatorDiagnostics(stdout, stderr, actFile, VerilogDiagnostics._whitelistedMessages));
                                break;
                            default:
                                reject(new Error(`Unknown linter ${this._linter}`));
                                break;
                        }
                        
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

    public cleanupTmpFiles() {
        this._tmpDir.removeCallback();
    }
}
