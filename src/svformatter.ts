import {
    FormattingOptions,
    Range,
    TextEdit
} from 'vscode-languageserver';

import {
    TextDocument
} from 'vscode-languageserver-textdocument';

import {
    ConnectionLogger
} from './genutils';

import * as child from 'child_process';
export class SystemVerilogFormatter {
    private _command: string;

    constructor(command?: string) {
        this._command = command;
    }

    public setCommand(command: string) {
        this._command = command;
    }

    public format(document: TextDocument, range: Range, options: FormattingOptions): Promise<TextEdit[]> {
        if (!this._command) {
            return Promise.reject("Format command not provided");
        }

        return new Promise((resolve, reject) => {
            let stdout: string = '';
            let stderr: string = '';
            let rangeArg: string = !!range ? ` --lines=${range.start.line + 1}-${range.end.line + 1}` : "";
            let commandArgs: string[] = (this._command + rangeArg + " -").split(/\s+/);
            let command: string = commandArgs.shift();
            let formatProc = child.spawn(command, commandArgs);
            formatProc.stdout.on('data', (chunk) => {
                stdout += chunk;
            });
            formatProc.stderr.on('data', (chunk) => {
                stderr += chunk;
            });
            formatProc.on('error', (err) => {
                if (err && (<any>err).code === 'ENOENT') {
                    ConnectionLogger.error(`The format command "${this._command}" is not available.`);
                    reject(err);
                }
            });
            formatProc.on('close', (code) => {
                if (stderr.length !== 0) {
                    ConnectionLogger.error(`Formatting gave errors`);
                    reject(stderr);
                }

                if (code !== 0) {
                    reject(`Format command failed`);
                }

                resolve([{
                    range: Range.create(0, 0, document.lineCount - 1, 0),
                    newText: stdout
                }]);
            });
            formatProc.stdin.end(document.getText());
        });
    }
}
