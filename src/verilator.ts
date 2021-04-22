import {
    DiagnosticSeverity,
    Diagnostic,
    Range,
    TextDocument
} from "vscode-languageserver";

import {
    fsWriteFileSync,
    fsUnlinkSync,
    getTmpFileSync
} from "./genutils";

import * as child from 'child_process';

type TimerType = ReturnType<typeof setTimeout>;

export class VerilatorDiagnostics {
    private _command: string = "";
    private _defines: string[] = [];
    private _optionsFile: string = "";
    private _alreadyRunning: Map<string, [child.ChildProcess, [Boolean]]> = new Map();
    private _fileWaiting: Map<string, [TimerType, any]> = new Map();
    private _tmpFilesNotInUse: string[] = [];
    private _allTmpFiles: string[] = [];

    public setCommand(cmd: string) {
        this._command = cmd;
    }

    public setOptionsFile(file: string) {
        this._optionsFile = file;
    }

    public setDefines(defines: string[]) {
        this._defines = defines || [];
    }

    private _getTmpFile(): string {
        if (this._tmpFilesNotInUse.length <= 0) {
            let tmpFile: string = getTmpFileSync();
            this._allTmpFiles.push(tmpFile);
            return tmpFile;
        }

        return this._tmpFilesNotInUse.shift();
    }

    private _lintImmediate(file: string, text?: string): Promise<Diagnostic[]> {
        let _kill = () => {
            let [proc, statusRef] = this._alreadyRunning.get(file);
            proc.kill();
            statusRef[0] = false;
        };

        if (this._alreadyRunning.has(file)) {
            //console.log(`DEBUG: Killing already running command to start a new one`);
            _kill();
        }
        return new Promise((resolve) => {
            let actFile: string = text == undefined ? file : this._getTmpFile();
            if (text != undefined) {
                fsWriteFileSync(actFile, text);

                // if file write takes too long and another process started in the interim
                if (this._alreadyRunning.has(file)) {
                    //console.log(`DEBUG: Killing already running command to start a new one`);
                    _kill();
                }
            }

            let defineArgs: string = this._defines.length > 0 ? this._defines.map(d => ` +define+${d}`).join('') : "";
            let command: string = this._command + defineArgs +  (this._optionsFile ? ' -f ' + this._optionsFile : "") + " " + actFile;
            let statusRef: [Boolean] = [true];
            //console.log(`DEBUG: verilator command ${command}`);
            this._alreadyRunning.set(file, [
                child.exec(command, (error, stdout, stderr) => {
                    if (text != undefined) {
                        this._tmpFilesNotInUse.push(actFile);
                    }
                    if (statusRef[0]) {
                        this._alreadyRunning.delete(file);
                        resolve(this.parseDiagnostics(error, stdout, stderr, actFile));
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
        if (text == undefined) {
            return this._lintImmediate(file, text);
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
            });
        }
    }

    public parseDiagnostics(error: child.ExecException, stdout: string, stderr: string, file: string): Diagnostic[] {
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
                    let severity = this._getSeverity(terms[0]);
                    let message = terms.slice(2).join(' ')
                    let lineNum = parseInt(terms[1].trim()) - 1;

                    if (lineNum != NaN) {
                        //console.log(terms[1].trim() + ' ' + message);

                        diagnostics.push({
                            severity: severity,
                            range: Range.create(lineNum, 0, lineNum, Number.MAX_VALUE),
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
        let terms = line.split(':');

        for (var i = 0; i < terms.length; i++) {
            if (terms[i] == ' ') {
                terms.splice(i, 1);
                i--;
            }
            else {
                terms[i] = terms[i].trim();
            }
        }

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
        this._allTmpFiles.forEach(file => fsUnlinkSync(file));
        this._allTmpFiles = [];
    }
}
