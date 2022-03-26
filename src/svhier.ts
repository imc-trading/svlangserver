import {
    SystemVerilogIndexer,
} from './svindexer';

import {
    ConnectionLogger,
    fsWriteFileSync,
    pathToUri,
    tmpFileManager,
} from './genutils';

export class SystemVerilogHierarchyCalculator {
    private _indexer: SystemVerilogIndexer;
    private _fileName: string;

    constructor(indexer: SystemVerilogIndexer) {
        this._indexer = indexer;
        this._fileName = tmpFileManager.getTmpFilePath("hier", "rpt.json");
    }

    public calcHier(cntnrName: string): string {
        fsWriteFileSync(this._fileName, JSON.stringify(this._indexer.getHier(cntnrName), null, 2));
        return pathToUri(this._fileName);
    }
}
