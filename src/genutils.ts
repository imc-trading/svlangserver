import {
    LogMessageNotification,
    MessageType
} from 'vscode-languageserver/node';

import {
    URI
} from 'vscode-uri';

import * as child from 'child_process';

const fs = require('fs');
const path = require('path');
const util = require('util');
const tmp = require('tmp');

const fsMkDir = util.promisify(fs.mkdir);
const _fsWriteFile = util.promisify(fs.writeFile);
export const fsReadFile = util.promisify(fs.readFile);
export const fsReadFileSync = fs.readFileSync;
export const fsExists = util.promisify(fs.exists);

export async function fsWriteFile(file: string, content: string) {
    try {
        return fsMkDir(path.dirname(file), {recursive: true})
            .then(() => { return _fsWriteFile(file, content); })
            .catch(error => { ConnectionLogger.error(error); });
    } catch (error) {
        ConnectionLogger.error(error);
    }
}

export function fsWriteFileSync(file: string, content: string): boolean {
    try {
        fs.mkdirSync(path.dirname(file), {recursive: true});
        fs.writeFileSync(file, content);
        return true;
    } catch (error) {
        ConnectionLogger.error(error);
        return false;
    }
}

export function fsUnlinkSync(file: string): boolean {
    try {
        fs.unlinkSync(file);
        return true;
    } catch (error) {
        ConnectionLogger.error(error);
        return false;
    }
}

export function uriToPath(uri: string): string {
    try {
        let fsPath: string = URI.parse(uri).fsPath;
        try {
            return fs.realpathSync(fsPath);
        } catch(error) {
            ConnectionLogger.error(error);
            return fsPath;
        }
    } catch (error) {
        ConnectionLogger.error(error);
        return undefined;
    }
};

export function pathToUri(path: string): string {
    try {
        return(URI.file(path).toString());
    } catch (error) {
        ConnectionLogger.error(error);
        return undefined;
    }
}

export function resolvedPath(file: string): string {
    try {
        return path.resolve(__dirname, file);
    } catch (error) {
        ConnectionLogger.error(error);
        return undefined;
    }
}

export function getTmpDirSync() {
    try {
        return tmp.dirSync({unsafeCleanup: true});
    } catch (error) {
        ConnectionLogger.error(error);
        return undefined;
    }
}

export function isStringListEqual(stringList1: string[], stringList2: string[]): boolean {
    try {
        if ((stringList1 == undefined) && (stringList2 == undefined)) {
            return true;
        }
        else if (stringList1 == undefined) {
            return false;
        }
        else if (stringList2 == undefined) {
            return false;
        }
        else if (stringList1.length != stringList2.length) {
            return false;
        }

        let sortedStringList1: string[] = stringList1.sort((one, two) => (one > two ? -1 : 1));
        let sortedStringList2: string[] = stringList1.sort((one, two) => (one > two ? -1 : 1));
        for (let i: number = 0; i < stringList1.length; i++) {
            if (sortedStringList1[i] != sortedStringList2[i]) {
                return false;
            }
        }

        return true;
    } catch (error) {
        ConnectionLogger.error(error);
        return false;
    }
}

export class ConnectionLogger {
    private static _connection = null;

    private static sendNotification(type: MessageType, message: string) {
        if (!ConnectionLogger._connection) {
            switch(type) {
                case MessageType.Error: {
                    console.error(message);
                    break;
                }

                default: {
                    console.log(message);
                    break;
                }
            }
        }
        else {
            try {
                ConnectionLogger._connection.sendNotification(LogMessageNotification.type, {type: type, message: message});
            } catch(error) {
                console.error(error);
            }
        }
    }

    public static setConnection(connection)
    {
        ConnectionLogger._connection = connection;
    }

    public static log(message: string, prefix: boolean = true) {
        ConnectionLogger.sendNotification(MessageType.Log, `${prefix ? "INFO: ": ""}${message}`);
    }

    public static warn(message: string, prefix: boolean = true) {
        ConnectionLogger.sendNotification(MessageType.Warning, `${prefix ? "WARNING: ": ""}${message}`);
    }

    public static error(message: string, prefix: boolean = true) {
        ConnectionLogger.sendNotification(MessageType.Error,`${prefix ? "ERROR: ": ""}${message}`);
    }
}

export function childProcessStdoutRedir(data) {
    try {
        let message: string = data.toString();
        if (message.startsWith("WARNING: ")) {
            ConnectionLogger.warn(message, false);
        }
        else {
            ConnectionLogger.log(message, false);
        }
    } catch (error) {
        ConnectionLogger.error(error, false);
        return;
    }
}

export function childProcessStderrRedir(data) {
    try {
        let message: string = data.toString();
        ConnectionLogger.error(message, false);
    } catch (error) {
        ConnectionLogger.error(error, false);
        return;
    }
}

type TimerType = ReturnType<typeof setTimeout>;

export class DelayedCaller {
    private _callWaiting: Map<string, [TimerType, any]> = new Map();
    private _timeOut: number;

    constructor(timeOut: number = 1000) {
        this._timeOut = timeOut;
    }

    public run(callName: string, successCallback: (success: Boolean) => any, errorCallback: (error: string) => any) {
        if (this._callWaiting.has(callName)) {
            let [waitTimer, resolver] = this._callWaiting.get(callName);
            clearTimeout(waitTimer);
            resolver(false);
        }

        return new Promise(resolve => {
            this._callWaiting.set(callName, [setTimeout(resolve, this._timeOut, true), resolve]);
        }).then((success) => {
            if (!!success) {
                this._callWaiting.delete(callName);
            }
            return successCallback(!!success);
        }).catch(error => {
            return errorCallback(error);
        });
    }
}

export class ChildProcManager {
    private _alreadyRunning: Map<string, [child.ChildProcess, [Boolean]]> = new Map();

    public kill(key: string) {
        if (this._alreadyRunning.has(key)) {
            //ConnectionLogger.log(`DEBUG: Killing already running command to start a new one`);
            let [proc, statusRef] = this._alreadyRunning.get(key);
            statusRef[0] = false;
            proc.kill();
        }
    }

    public run(key: string, command: string, callBack: (status, error, stdout, stderr) => any) {
        let statusRef: [Boolean] = [true];
        this._alreadyRunning.set(key, [
            child.exec(command, (error, stdout, stderr) => {
                if (statusRef[0]) {
                    this._alreadyRunning.delete(key);
                }
                callBack(statusRef[0], error, stdout, stderr);
            }),
            statusRef
        ]);
    }
}

class TmpFileManager {
    private _tmpDir;
    private _freeTmpFileNums: Map<string, {total: number, nums: number[]}> = new Map();

    constructor() {
        this._tmpDir = getTmpDirSync();
    }

    public getTmpFilePath(...elems: string[]): string {
        return path.join(this._tmpDir.name, ...elems);
    }

    public cleanupTmpFiles() {
        this._tmpDir.removeCallback();
    }

    public getFreeTmpFileNum(key: string): number {
        if (!this._freeTmpFileNums.has(key)) {
            this._freeTmpFileNums.set(key, {total: 0, nums: []});
        }
        if (this._freeTmpFileNums.get(key).nums.length <= 0) {
            this._freeTmpFileNums.get(key).nums.push(this._freeTmpFileNums.get(key).total++);
        }
        return this._freeTmpFileNums.get(key).nums.shift();
    }

    public returnFreeTmpFileNum(key: string, tmpFileNum: number) {
        if (this._freeTmpFileNums.has(key)) {
            this._freeTmpFileNums.get(key).nums.push(tmpFileNum);
        }
        else {
            ConnectionLogger.error(`FreeTmpFileNums doesn't have the key ${key}`);
        }
    }
}

export let tmpFileManager = new TmpFileManager();
