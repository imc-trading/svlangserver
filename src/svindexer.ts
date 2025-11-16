import {
    SymbolInformation,
} from 'vscode-languageserver/node';

import {
    Location,
    Position
} from 'vscode-languageserver-types';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';

import {
    SystemVerilogSymbol,
} from './svsymbol';

import {
    PreprocCacheEntry,
    PreprocIncInfo,
    SystemVerilogPreprocessor
} from './svpreprocessor';

import {
    SystemVerilogParser
} from './svparser';

import {
    SystemVerilogUtils
} from './svutils';

import {
    GrammarEngine,
    GrammarToken,
} from './grammar_engine';

import {
    svcompletion_grammar
} from './svcompletion_grammar';

import {
    childProcessStdoutRedir,
    childProcessStderrRedir,
    ConnectionLogger,
    fsWriteFile,
    fsWriteFileSync,
    isStringListEqual,
    pathToUri,
    resolvedPath,
    uriToPath
} from './genutils';

const { fork } = require('child_process');
const glob = require('glob');
const path = require('path');
const { performance } = require('perf_hooks');

const CACHED_INDEX_FILE_VERSION: string = "1.1.0";
const RETRY_DELAY_MS: number = 1000;
const MAX_RETRY_COUNT: number = 60;

enum IndexProgressType {
    None,
    Starting,
    Ongoing,
    Done,
    Halting,
    Halted,
}

type IndexFileInfo = {symbolsInfo: SystemVerilogParser.SystemVerilogFileSymbolsInfo, pkgdeps: string[], rank: number};
type Containers = {pkgs: string[], modules: string[], interfaces: string[]};
type UserDefineType = { name: string, def: string, tokens: GrammarToken[] };

export class SystemVerilogIndexer {
    private _rootPath: string | null;
    private _clientDir: string | null;
    private _srcFiles: string[];
    private _mustSrcFiles: Set<string> = new Set();
    private _libFiles: string[] = [];
    private _preprocCache: Map<string, PreprocCacheEntry> = new Map();
    private _indexedFilesInfo: Map<string, IndexFileInfo> = new Map();
    private _pkgToFiles: Map<string, Set<string>> = new Map();
    private _moduleToFiles: Map<string, Set<string>> = new Map();
    private _interfaceToFiles: Map<string, Set<string>> = new Map();
    private _fileToContainers: Map<string, Containers> = new Map();
    private _lastSavedFilesInfo: Map<string, IndexFileInfo> = new Map();
    private _indexProgress: IndexProgressType = IndexProgressType.None;
    private _cacheLoadingDone: boolean = false;
    private _indexIsSaveable: boolean = false;
    private _completionGrammarEngine: GrammarEngine = new GrammarEngine(svcompletion_grammar, "meta.invalid.systemverilog");
    private _filesCompletionInfo: Map<string, {tokens: GrammarToken[]}> = new Map();
    private _userDefines: UserDefineType[] = [];
    private _optionsFileContent: string[] = [];

    public NUM_FILES: number = 250;
    public mostRecentSymbols: SymbolInformation[] = [];

    constructor(aRootPath?: string) {
        this.setRoot(aRootPath);
    }

    setRoot(aRootPath?: string) {
        this._rootPath = aRootPath || null;
    }

    setClientDir(aClientDir?: string) {
        this._clientDir = aClientDir || ".vim";
    }

    getIndexFile(): string {
        return this._rootPath + "/" + this._clientDir + "/svlangserver/index.json";
    }

    getLinterOptionsFile() : string {
        return this._rootPath + "/" + this._clientDir + "/svlangserver/linter.vc";
    }

    setDefines(defines: string[]) {
        this._userDefines = defines.map(s => s.split("=", 2)).map(s => { return { name: s[0], def: s[1], tokens: s[1] == undefined ? [] : SystemVerilogPreprocessor.tokenize(s[1]) }; });
    }

    private _indexGlob(includes: string[], excludes: string[], globOptions, func) {
        const pattern = includes.length == 1 ? includes[0] : '{' + includes.join(",") + '}';
        return glob(pattern, !!globOptions ? globOptions : {cwd: this._rootPath, ignore: excludes, follow: true, realpath: true}, func);
    }

    setLibraries(libraries: string[], excludes: string[]) {
        this._indexGlob(libraries, excludes, undefined, (err, files) => {
            if (err) {
                ConnectionLogger.error(err);
            }
            else if (files.length > 0) {
                if (!isStringListEqual(files, this._libFiles)) {
                    this._libFiles = files;
                    this._generateVerilatorOptionsFile();
                }
            }
            else {
                ConnectionLogger.log("No library files found");
                this._libFiles = [];
            }
        });
    }

    _waitForHalt(retryCount: number = 0): Promise<void> {
        if (this._indexProgress == IndexProgressType.Halting) {
            return new Promise(resolve => {
                setTimeout(resolve, RETRY_DELAY_MS);
            }).then(() => {
                if (retryCount < MAX_RETRY_COUNT) {
                    return this._waitForHalt(retryCount + 1);
                }
                else {
                    throw 'Timeout trying to halt indexing';
                }
                return;
            });
        }
        return Promise.resolve();
    }

    index(includes: string[], mustIncludes: string[], excludes: string[]) {
        let _filesGlob = (callBack) => {
            let _incFiles: string[] = undefined;
            let _mustFiles: string[] = undefined;

            let _incGlob = this._indexGlob(includes, excludes, undefined, (err, files) => {
                if (err) {
                    callBack(err, [], []);
                    return;
                }

                _incFiles = files;
                if (_mustFiles != undefined) {
                    callBack(err, _incFiles, _mustFiles);
                }
            });

            this._indexGlob(mustIncludes, excludes, _incGlob.options, (err, files) => {
                if (err) {
                    callBack(err, [], []);
                    return;
                }

                _mustFiles = files;
                if (_incFiles != undefined) {
                    callBack(err, _incFiles, _mustFiles);
                }
            });
        };

        let _index = (srcFiles: string[]) => {
            this._indexProgress = IndexProgressType.Ongoing;
            this._srcFiles = srcFiles;
            if (!this._cacheLoadingDone) {
                this._loadCachedIndex();
            }
            this._buildIndex();
        };

        if (this._rootPath) {
            if (this._indexProgress == IndexProgressType.Starting) {
                this._indexProgress = IndexProgressType.Halting;
                this._waitForHalt().then(() => {
                    this.index(includes, mustIncludes, excludes);
                }).catch((err) => {
                    ConnectionLogger.error(err);
                });
                return;
            }
            else if (this._indexProgress == IndexProgressType.Ongoing) {
                _filesGlob((err, files, mustFiles) => {
                    if (err) {
                        ConnectionLogger.error(err);
                        return;
                    }

                    let newMustSrcFiles: Set<string> = new Set(mustFiles);
                    let allFiles: string[] = files.concat(mustFiles);
                    if (allFiles.length > 0) {
                        if (!isStringListEqual(allFiles, this._srcFiles)) {
                            this._indexProgress = IndexProgressType.Halting;
                            this._waitForHalt().then(() => {
                                this._mustSrcFiles = newMustSrcFiles;
                                _index(allFiles);
                            }).catch((err) => {
                                ConnectionLogger.error(err);
                            });
                        }
                        else if ([...newMustSrcFiles].sort().join() != [...this._mustSrcFiles].sort().join()) {
                            this._mustSrcFiles = newMustSrcFiles;
                            this._generateVerilatorOptionsFile();
                        }
                    }
                    else {
                        ConnectionLogger.log("No files to index");
                    }
                });
                return;
            }

            this._indexProgress = IndexProgressType.Starting;
            _filesGlob((err, files, mustFiles) => {
                if (this._indexProgress == IndexProgressType.Halting) {
                    this._indexProgress = IndexProgressType.Halted;
                    return;
                }

                if (err) {
                    this._indexProgress = IndexProgressType.Done;
                    ConnectionLogger.error(err);
                    this._mustSrcFiles = new Set();
                    this._srcFiles = [];
                    return;
                }

                let allFiles: string[] = files.concat(mustFiles);
                if (allFiles.length > 0) {
                    this._mustSrcFiles = new Set(mustFiles);
                    _index(allFiles);
                }
                else {
                    this._indexProgress = IndexProgressType.Done;
                    ConnectionLogger.log("No files to index");
                    this._srcFiles = [];
                }
            });
        }
    }

    private _loadCachedIndex() {
        const forkedCachedIndexLoader = fork(resolvedPath('./cached_index_loader.js'), [], { silent: true })
        forkedCachedIndexLoader.on('message', (rawCachedFilesInfo) => {
            try {
                if (!rawCachedFilesInfo.version || (rawCachedFilesInfo.version != CACHED_INDEX_FILE_VERSION)) {
                    this._indexIsSaveable = true;
                    this._cacheLoadingDone = true;
                    return;
                }
                let cachedFilesInfo: Map<string, IndexFileInfo> = new Map(rawCachedFilesInfo.info.map(info => [
                    info[0], <IndexFileInfo>({
                        symbolsInfo: SystemVerilogParser.jsonToFileSymbolsInfo(info[0], info[1][0]),
                        pkgdeps: info[1][1],
                        rank: info[1][2]
                    })
                ]));
                let cacheFileCount: number = 0;
                for (let file of this._srcFiles) {
                    if (!this._indexedFilesInfo.has(file) && cachedFilesInfo.has(file)) {
                        let info = cachedFilesInfo.get(file);
                        this._updateFileInfo(file, info.symbolsInfo, info.pkgdeps);
                        cacheFileCount++;
                    }
                }
                ConnectionLogger.log(`INFO: Loaded cached index for ${cacheFileCount} files`);
                forkedCachedIndexLoader.send('done');
                this._cacheLoadingDone = true;
            } catch (error) {
                ConnectionLogger.error(error);
            }
        });
        forkedCachedIndexLoader.stdout.on('data', childProcessStdoutRedir);
        forkedCachedIndexLoader.stderr.on('data', childProcessStderrRedir);
        forkedCachedIndexLoader.send(this.getIndexFile());
    }

    private _setHeaderSymbols(file: string, preprocIncInfo: PreprocIncInfo) {
        if (this._indexedFilesInfo.has(file) && (this._indexedFilesInfo.get(file).pkgdeps != null)) {
            this._incrementalUpdateFileInfo(file, {}, []);
        }
        this._indexedFilesInfo.set(file, {symbolsInfo: SystemVerilogParser.preprocToFileSymbolsInfo(preprocIncInfo.symbols, preprocIncInfo.includes), pkgdeps: null, rank: 0});
    }

    private _buildIndex() {
        if (!this._srcFiles) {
            return;
        }
        ConnectionLogger.log(`INFO: Indexing ${this._srcFiles.length} files ...`);
        var startTime = performance.now();
        const forkedIndexBuilder = fork(resolvedPath('./svindex_builder.js'), [], { silent: true });
        let offset: number = 0;
        let waitPreprocCache: Boolean = false;
        forkedIndexBuilder.on('message', ([jsonFileSymbolsInfo, pkgdeps]) => {
            try {
                if (this._indexProgress == IndexProgressType.Halting) {
                    forkedIndexBuilder.send(['exit', '']);
                    this._indexProgress = IndexProgressType.Halted;
                    return;
                }

                if (waitPreprocCache) {
                    for (let [k, v] of SystemVerilogParser.preprocCacheFromJSON(jsonFileSymbolsInfo)) {
                        this._preprocCache.set(k, v);
                        this._setHeaderSymbols(v.file, v.info);
                    }
                    ConnectionLogger.log(`INFO: Done indexing ${this._srcFiles.length + this._preprocCache.size} files!!!`);
                    this._indexProgress = IndexProgressType.Done;
                    var endTime = performance.now();
                    ConnectionLogger.log(`INFO: Took ${endTime - startTime} milliseconds`);
                    forkedIndexBuilder.send(['exit', '']);
                    this._updatePkgFilesInfo();
                    this.saveIndex();
                    this._generateVerilatorOptionsFile();
                }
                else {
                    //DBG ConnectionLogger.log(`DEBUG: Received ${jsonFileSymbolsInfo.length} symbols and ${pkgdeps.length} pkgdeps for ${this._srcFiles[offset]}`);
                    let symbolsInfo: SystemVerilogParser.SystemVerilogFileSymbolsInfo = SystemVerilogParser.jsonToFileSymbolsInfo(pathToUri(this._srcFiles[offset]), jsonFileSymbolsInfo);
                    if (this._indexedFilesInfo.has(this._srcFiles[offset])) {
                        this._incrementalUpdateFileInfo(this._srcFiles[offset], symbolsInfo, pkgdeps);
                    }
                    else {
                        this._updateFileInfo(this._srcFiles[offset], symbolsInfo, pkgdeps);
                    }
                    this._indexIsSaveable = true;

                    if (offset == this._srcFiles.length - 1) {
                        waitPreprocCache = true;
                        forkedIndexBuilder.send(['done', '']);
                    }
                    else {
                        offset++;
                        forkedIndexBuilder.send(['index', this._srcFiles[offset]]);
                    }
                }
            } catch (error) {
                ConnectionLogger.error(error);
            }
        });
        forkedIndexBuilder.stdout.on('data', childProcessStdoutRedir);
        forkedIndexBuilder.stderr.on('data', childProcessStderrRedir);
        forkedIndexBuilder.send(['config', this._srcFiles, this._userDefines.map(d => [d.name, d.tokens])]);
        forkedIndexBuilder.send(['index', this._srcFiles[offset]]);
    }

    private _getContainers(symbolsInfo: SystemVerilogParser.SystemVerilogFileSymbolsInfo): Containers {
        let pkgs: string[] = [];
        let modules: string[] = [];
        let interfaces: string[] = [];
        for (let symbol of SystemVerilogParser.fileAllContainers(symbolsInfo)) {
            if (symbol.type[0] == "package") {
                pkgs.push(symbol.name);
            }
            else if (symbol.type[0] == "module") {
                modules.push(symbol.name);
            }
            else if (symbol.type[0] == "interface") {
                interfaces.push(symbol.name);
            }
        }
        return {pkgs: pkgs, modules: modules, interfaces: interfaces};
    }

    private _updateFileInfo(file: string, symbolsInfo: SystemVerilogParser.SystemVerilogFileSymbolsInfo, pkgdeps: string[]) {
        let cntnrs: Containers = this._getContainers(symbolsInfo);
        for (let pkg of cntnrs.pkgs) {
            if (!this._pkgToFiles.has(pkg)) {
                this._pkgToFiles.set(pkg, new Set<string>());
            }
            this._pkgToFiles.get(pkg).add(file);
        }
        for (let mod of cntnrs.modules) {
            if (!this._moduleToFiles.has(mod)) {
                this._moduleToFiles.set(mod, new Set<string>());
            }
            this._moduleToFiles.get(mod).add(file);
        }
        for (let intf of cntnrs.interfaces) {
            if (!this._interfaceToFiles.has(intf)) {
                this._interfaceToFiles.set(intf, new Set<string>());
            }
            this._interfaceToFiles.get(intf).add(file);
        }
        this._indexedFilesInfo.set(file, {symbolsInfo: symbolsInfo, pkgdeps: cntnrs.pkgs.length > 0 ? pkgdeps : null, rank: 0});
        this._fileToContainers.set(file, cntnrs);
    }

    private _updatePkgFilesInfo() {
        let fileDepsInfo: Map<string, Set<string>> = new Map();

        this._indexedFilesInfo.forEach((info, file) => {
            info.rank = 0;
            if (info.pkgdeps != null) {
                let fileDeps: Set<string> = new Set();
                for (let pkg of info.pkgdeps) {
                    if (this._pkgToFiles.has(pkg)) {
                        for (let fileDep of this._pkgToFiles.get(pkg)) {
                            if (fileDep == file) {
                                continue;
                            }
                            fileDeps.add(fileDep);
                        }
                    }
                }

                fileDepsInfo.set(file, fileDeps);
            }
        });

        this._indexedFilesInfo.forEach((info, file) => {
            if (info.pkgdeps != null) {
                let visitedFiles: string[] = [file];
                this._incDepsRank(file, visitedFiles, fileDepsInfo);
            }
        });
    }

    private _incDepsRank(file: string, visitedFiles: string[], fileDepsInfo: Map<string, Set<string>>, indent: number = 0): void {
        for (let fileDep of fileDepsInfo.get(file)) {
            if (visitedFiles.indexOf(fileDep) >= 0) {
                ConnectionLogger.error(`ERROR: Found cycle in ${visitedFiles}`);
                return;
            }
            let fileDepInfo = this._indexedFilesInfo.get(fileDep);
            let fileInfo = this._indexedFilesInfo.get(file);
            if (fileDepInfo.rank <= fileInfo.rank) {
                fileDepInfo.rank = fileInfo.rank + 1;
                //ConnectionLogger.log(`${' '.repeat(indent)} DEBUG: incrementing rank of ${fileDep} because of ${file}`);
                this._incDepsRank(fileDep, [fileDep].concat(visitedFiles), fileDepsInfo, indent + 1);
            }
        }
    }

    private _generateVerilatorOptionsFile() {
        this._optionsFileContent = [];
        for (let [file, rank] of [...[...this._indexedFilesInfo.entries()].filter(a => a[1].pkgdeps != null)].sort((a, b) => a[1].rank <= b[1].rank ? 1 : -1)) {
            if (this._mustSrcFiles.has(file)) {
                this._optionsFileContent.push(file);
            }
            else {
                this._optionsFileContent.push('-v ' + file);
            }
        }
        for (let libfile of [...new Set(this._libFiles.values())]) {
            this._optionsFileContent.push('-v ' + libfile);
        }
        for (let incdir of [...new Set(this._srcFiles.map(file => path.dirname(file)))]) {
            this._optionsFileContent.push('+incdir+' + incdir);
        }
        fsWriteFile(this.getLinterOptionsFile(), this._optionsFileContent.join('\n'))
            .catch(error => {
                ConnectionLogger.error(error);
            });
    }

    public getOptionsFileContent(): string[] {
        return this._optionsFileContent;
    }

    public fileHasPkg(file: string): boolean {
        return this._indexedFilesInfo.has(file) && (this._indexedFilesInfo.get(file).pkgdeps != null);
    }

    public isMustSrcFile(file: string): boolean {
        return this._mustSrcFiles.has(file);
    }

    public processDocumentChanges(document: TextDocument) {
        let text: string = document.getText();
        let tokens: GrammarToken[] = this._completionGrammarEngine.tokenize(text);
        let file: string = uriToPath(document.uri);
        this._filesCompletionInfo.set(file, {tokens: tokens});
    }

    public indexOpenDocument(document: TextDocument, retryCount: number = 0) {
        if (this._srcFiles == undefined) {
            if (retryCount < MAX_RETRY_COUNT) {
                setTimeout(() => {
                    try {
                        this.indexOpenDocument(document, retryCount + 1);
                    } catch(error) {
                        ConnectionLogger.error(error);
                    }
                }, RETRY_DELAY_MS);
            }
            else {
                ConnectionLogger.error(`Timeout trying to index document ${document.uri}`);
            }
            return;
        }

        let file: string = uriToPath(document.uri);
        if (this._preprocCache.has(file)) {
            return;
        }

        this.processDocumentChanges(document);

        if (!this._lastSavedFilesInfo.has(file) && this._indexedFilesInfo.has(file)) {
            this._lastSavedFilesInfo.set(file, this._indexedFilesInfo.get(file));
        }

        let fileSymbolsInfo: SystemVerilogParser.SystemVerilogFileSymbolsInfo;
        let pkgdeps: string[];
        let parser: SystemVerilogParser = new SystemVerilogParser();
        let userDefinesMacroInfo = new Map(this._userDefines.map(d => [d.name, { args: undefined, default: undefined, definition: d.tokens, symbol: undefined, file: "" }]));
        [fileSymbolsInfo, pkgdeps] = parser.parse(document, this._srcFiles, this._preprocCache, userDefinesMacroInfo, "full", undefined);

        let rank: number = this._indexedFilesInfo.has(file) ? this._indexedFilesInfo.get(file).rank : 0;
        let pkgs: string[] = this._getContainers(fileSymbolsInfo).pkgs;
        this._indexedFilesInfo.set(file, {symbolsInfo: fileSymbolsInfo, pkgdeps: pkgs.length > 0 ? pkgdeps : null, rank: rank});
        for (let entry of this._preprocCache.values()) {
            this._setHeaderSymbols(entry.file, entry.info);
        }
    }

    public updateFileInfoOnSave(document: TextDocument) {
        let file: string = uriToPath(document.uri);
        let info = this._indexedFilesInfo.get(file);
        let symbolsInfo: SystemVerilogParser.SystemVerilogFileSymbolsInfo = info.symbolsInfo;
        let pkgdeps: string[] = info.pkgdeps == null ? [] : info.pkgdeps;

        this._indexIsSaveable = true;
        if (this._lastSavedFilesInfo.has(file)) {
            this._indexedFilesInfo.set(file, this._lastSavedFilesInfo.get(file));
            this._lastSavedFilesInfo.delete(file);
        }
        this._incrementalUpdateFileInfo(file, symbolsInfo, pkgdeps);
        for (let entry of this._preprocCache.values()) {
            this._indexedFilesInfo.set(entry.file, {symbolsInfo: symbolsInfo, pkgdeps: null, rank: 0});
        }
    }

    private _incrementalUpdateFileInfo(file: string, symbolsInfo: SystemVerilogParser.SystemVerilogFileSymbolsInfo, pkgdeps: string[]) {
        let cntnrs: Containers = this._getContainers(symbolsInfo);
        let oldcntnrs: Containers = this._fileToContainers.has(file) ? this._fileToContainers.get(file) : {pkgs: [], modules: [], interfaces: []};
        let pkgs: string[] = cntnrs.pkgs;
        let oldpkgs: string[] = oldcntnrs.pkgs;

        let addedPkgs: string[] = [];
        for (let pkg of pkgs) {
            if (oldpkgs.indexOf(pkg) < 0) {
                addedPkgs.push(pkg);
            }
        }

        let deletedPkgs: string[] = [];
        for (let pkg of oldpkgs) {
            if (pkgs.indexOf(pkg) < 0) {
                deletedPkgs.push(pkg);
            }
        }

        let newpkgdeps: string[] | null = pkgs.length > 0 ? pkgdeps : null;
        let oldpkgdeps: string[] | null = this._indexedFilesInfo.has(file) ? this._indexedFilesInfo.get(file).pkgdeps : null;

        let _newpkgdeps: string[] = (newpkgdeps == null) ? [] : newpkgdeps;
        let _oldpkgdeps: string[] = (oldpkgdeps == null) ? [] : oldpkgdeps;

        let addedPkgDeps: string[] = [];
        for (let pkgdep of _newpkgdeps) {
            if (_oldpkgdeps.indexOf(pkgdep) < 0) {
                addedPkgDeps.push(pkgdep);
            }
        }

        let deletedPkgDeps: string[] = [];
        for (let pkgdep of _oldpkgdeps) {
            if (_newpkgdeps.indexOf(pkgdep) < 0) {
                deletedPkgDeps.push(pkgdep);
            }
        }

        this._fileToContainers.set(file, cntnrs);
        let rank: number = this._indexedFilesInfo.has(file) ? this._indexedFilesInfo.get(file).rank : 0;
        this._indexedFilesInfo.set(file, {symbolsInfo: symbolsInfo, pkgdeps: newpkgdeps, rank: rank});
        if (!!addedPkgs.length || !!deletedPkgs.length || !!addedPkgDeps.length || !!deletedPkgDeps.length) {
            for (let addedPkg of addedPkgs) {
                if (!this._pkgToFiles.has(addedPkg)) {
                    this._pkgToFiles.set(addedPkg, new Set<string>());
                }
                this._pkgToFiles.get(addedPkg).add(file);
            }

            for (let deletedPkg of deletedPkgs) {
                this._pkgToFiles.get(deletedPkg).delete(file);
                if (this._pkgToFiles.get(deletedPkg).size <= 0) {
                    this._pkgToFiles.delete(deletedPkg);
                }
            }

            this._updatePkgFilesInfo();
            this._generateVerilatorOptionsFile();
        }

        for (let mod of oldcntnrs.modules) {
            if (this._moduleToFiles.has(mod)) {
                this._moduleToFiles.get(mod).delete(file);
                if (this._moduleToFiles.get(mod).size <= 0) {
                    this._moduleToFiles.delete(mod);
                }
            }
        }
        for (let mod of cntnrs.modules) {
            if (!this._moduleToFiles.has(mod)) {
                this._moduleToFiles.set(mod, new Set<string>());
            }
            this._moduleToFiles.get(mod).add(file);
        }

        for (let intf of oldcntnrs.interfaces) {
            if (this._interfaceToFiles.has(intf)) {
                this._interfaceToFiles.get(intf).delete(file);
                if (this._interfaceToFiles.get(intf).size <= 0) {
                    this._interfaceToFiles.delete(intf);
                }
            }
        }
        for (let intf of cntnrs.interfaces) {
            if (!this._interfaceToFiles.has(intf)) {
                this._interfaceToFiles.set(intf, new Set<string>());
            }
            this._interfaceToFiles.get(intf).add(file);
        }
    }

    private _indexToCache(): string {
        return JSON.stringify({
            version: CACHED_INDEX_FILE_VERSION,
            info: Array.from(this._indexedFilesInfo, info => [info[0], [SystemVerilogParser.fileSymbolsInfoToJson(info[1].symbolsInfo), info[1].pkgdeps, info[1].rank]])
        });
    }

    saveIndex(): Promise<void> {
        if (!this._indexIsSaveable) {
            return;
        }
        return fsWriteFile(this.getIndexFile(), this._indexToCache())
                .then(() => {
                    this._indexIsSaveable = false;
                })
                .catch(error => {
                    ConnectionLogger.error(error);
                });
    }

    saveIndexOnExit(): void {
        if (!this._indexIsSaveable || !this._cacheLoadingDone) {
            return;
        }
        this._indexIsSaveable = false;
        fsWriteFileSync(this.getIndexFile(), this._indexToCache());
    }

    getDocumentSystemVerilogSymbols(documentUri: string, strict: Boolean = true) : SystemVerilogSymbol[] {
        if (!this._indexedFilesInfo.has(uriToPath(documentUri))) {
            return [];
        }
        return SystemVerilogParser.fileAllSymbols(this._indexedFilesInfo.get(uriToPath(documentUri)).symbolsInfo, strict);
    }

    getDocumentSymbols(document: TextDocument, retryCount: number = 0) : Promise<SymbolInformation[]> {
        if (!this._indexedFilesInfo.has(uriToPath(document.uri))) {
            return new Promise(resolve => {
                setTimeout(resolve, RETRY_DELAY_MS);
            }).then(() => {
                if (retryCount < MAX_RETRY_COUNT) {
                    return this.getDocumentSymbols(document, retryCount + 1);
                }
                else {
                    ConnectionLogger.error(`Timeout trying to get document symbols for ${document.uri}`);
                }
                return [];
            }).catch(error => {
                ConnectionLogger.error(error);
                return [];
            });
        }
        return Promise.resolve(this.getDocumentSystemVerilogSymbols(document.uri).map(symbol => symbol.toSymbolInformation(document.uri)));
    }

    private _getWorkspaceSymbols(query: string, svtype: Boolean): Array<SystemVerilogSymbol|SymbolInformation> {
        const pattern = new RegExp(".*" + query.replace(" ", "").split("").map((c) => c).join(".*") + ".*", 'i');
        let results = new Array<SystemVerilogSymbol|SymbolInformation>();
        let exactMatch: Boolean = false;
        if (query.startsWith("¤")) {
            exactMatch = true
            query = query.substr(1)
        }
        this._indexedFilesInfo.forEach((info, file) => {
            let symbols: SystemVerilogSymbol[] = SystemVerilogParser.fileAllSymbols(info.symbolsInfo);
            symbols.forEach(symbol => {
                if (exactMatch === true) {
                    if (symbol.name == query) {
                        if (svtype) {
                            results.push(symbol);
                        }
                        else {
                            results.push(symbol.toSymbolInformation(pathToUri(file)));
                        }
                    }
                }
                else if (symbol.name.match(pattern)) {
                    if (svtype) {
                        results.push(symbol);
                    }
                    else {
                        results.push(symbol.toSymbolInformation(pathToUri(file)));
                    }
                }
            });
        });
        return results;
    }

    getWorkspaceSystemVerilogSymbols(query: string): Promise<SystemVerilogSymbol[]> {
        return new Promise((resolve, reject) => {
            if (query==undefined || query.length === 0) {
                ConnectionLogger.error(`getWorkspaceSystemVerilogSymbols does not accept empty/undefined query`);
                resolve([]);
            }
            else {
                resolve(<SystemVerilogSymbol[]>(this._getWorkspaceSymbols(query, true)));
            }
        });
    }

    getWorkspaceSymbols(query: string): Promise<SymbolInformation[]> {
        return new Promise<SymbolInformation[]>((resolve, reject) => {
            if (query==undefined || query.length === 0) {
                resolve(this.mostRecentSymbols);
            } else {
                let results: SymbolInformation[] = <SymbolInformation[]>(this._getWorkspaceSymbols(query, false));
                this.updateMostRecentSymbols(results.slice(0)); //pass a shallow copy of the array
                resolve(results);
            }
        }).catch(error => {
            ConnectionLogger.error(error);
            return [];
        });
    }

    /**
        Updates `mostRecentSymbols` with the most recently used symbols
        When `mostRecentSymbols` is undefined, add the top `this.NUM_FILES` symbol from `this._indexedFilesInfo`
        When `mostRecentSymbols` is defined, add the symbols in `recentSymbols` one by one to the top of the array

        @param recentSymbols the recent symbols
    */
    updateMostRecentSymbols(recentSymbols: SymbolInformation[]): void {
        if (this.mostRecentSymbols) {
            if (!recentSymbols) {
                return;
            }

            while (recentSymbols.length > 0) {
                let currentSymbol = recentSymbols.pop();

                //if symbol already exists, remove it
                for (let i = 0; i < this.mostRecentSymbols.length; i++) {
                    let symbol = this.mostRecentSymbols[i];
                    if (symbol == currentSymbol) {
                        this.mostRecentSymbols.splice(i, 1);
                        break;
                    }
                }

                //if the array has reached maximum capacity, remove the last element
                if (this.mostRecentSymbols.length >= this.NUM_FILES) {
                    this.mostRecentSymbols.pop();
                }

                //add the symbol to the top of the array
                this.mostRecentSymbols.unshift(currentSymbol);
            }
        }
        else {
            let maxSymbols: SymbolInformation[] = [];

            //collect the top symbols in `this.symbols`
            for (var list of this._indexedFilesInfo.entries()) {
                let symbols: SystemVerilogSymbol[] = SystemVerilogParser.fileAllSymbols(list[1].symbolsInfo);
                if (maxSymbols.length + symbols.length >= this.NUM_FILES) {
                    let limit = this.NUM_FILES - maxSymbols.length;
                    maxSymbols = maxSymbols.concat(symbols.slice(-1 * limit).map(symbol => symbol.toSymbolInformation(pathToUri(list[0]))));
                    break;
                }
                else {
                    maxSymbols = maxSymbols.concat(symbols.map(symbol => symbol.toSymbolInformation(pathToUri(list[0]))));
                }
            }

            this.mostRecentSymbols = maxSymbols;
        }
    }

    public getSystemVerilogCompletionTokens(uri: string): GrammarToken[] {
        return this._filesCompletionInfo.get(uriToPath(uri)).tokens || [];
    }

    private leftExtendHierToken(tokenNum: number, tokens: GrammarToken[]): number {
        let extTokenNum: number = tokenNum;

        let scope: string = tokens[tokenNum].scopes[tokens[tokenNum].scopes.length - 1];
        if ((!scope.startsWith("identifier.")) || (scope.startsWith("identifier.scoped"))) {
            return extTokenNum;
        }

        let lookingForSeparator: boolean = true;
        for (let i: number = tokenNum - 1; i >= 0; i--) {
            if (lookingForSeparator) {
                if (tokens[i].text == ".") {
                    lookingForSeparator = false;
                }
                else {
                    break;
                }
            }
            else {
                let scopeDepth: number = tokens[i].scopes.length - 1;
                scope = tokens[i].scopes[scopeDepth];
                if (scope == "meta.whitespace.systemverilog") {
                    continue;
                }
                let j: number = i;
                if ((!scope.startsWith("identifier.")) && (tokens[i].text == "]")) {
                    for (j = i-1; j >= 0; j--) {
                        if (scopeDepth == tokens[j].scopes.length) {
                            break;
                        }
                    }
                    j--;
                    if (j < 0) {
                        break;
                    }
                    scope = tokens[j].scopes[tokens[j].scopes.length - 1];
                }
                if (scope.startsWith("identifier.") && (!scope.startsWith("identifier.scoped."))) {
                    extTokenNum = j;
                }
                else {
                    break;
                }
                lookingForSeparator = true;
            }
        }

        return extTokenNum;
    }

    public getSystemVerilogCompletionTokenNumber(document: TextDocument, line: number, character: number): [number, number] {
        let file = uriToPath(document.uri);
        let svtokennum: number = -1;
        const svtokens: GrammarToken[] = this._filesCompletionInfo.get(file).tokens || [];
        if ((svtokens.length > 0) && (character > 0)) {
            //const offset: number = fileCompletionInfo.offsets[line] + character - 1;
            const offset: number = document.offsetAt(Position.create(line, character - 1)); 
            let firstToken: number = 0;
            let lastToken: number = svtokens.length - 1;
            //ConnectionLogger.log(`DEBUG: Trying to find token at ${offset} with ${firstToken}:${svtokens[firstToken].index} - ${lastToken}:${svtokens[lastToken].index + svtokens[lastToken].text.length}`);
            while ((offset >= svtokens[firstToken].index) && (offset < (svtokens[lastToken].index + svtokens[lastToken].text.length))) {
                let prevFirstToken = firstToken;
                let prevLastToken = lastToken;
                let midToken = ~~((firstToken + lastToken)/2);
                //ConnectionLogger.log(`DEBUG: Trying ${midToken} at ${svtokens[midToken].index} - ${svtokens[midToken].index + svtokens[midToken].text.length}`);
                if (offset < svtokens[midToken].index) {
                    lastToken = midToken;
                }
                else if (offset >= (svtokens[midToken].index + svtokens[midToken].text.length)) {
                    firstToken = midToken;
                }
                else {
                    //ConnectionLogger.log(`DEBUG: Found ${midToken} at ${svtokens[midToken].index} with text "${svtokens[midToken].text}"`);
                    svtokennum = midToken;
                    break;
                }

                if ((prevFirstToken == firstToken) && (prevLastToken == lastToken)) {
                    ConnectionLogger.error(`Tokenization might be incorrect as token search ran into infinite loop at ${firstToken} - ${lastToken}`);
                    break;
                }
            }
        }
        else if (svtokens.length > 0) {
            // DEBUG
            //for (let i = 0; i < svtokens.length; i++) {
            //    const token = svtokens[i];
            //    const text = svtokens[i].text;
            //    ConnectionLogger.log(` - token ${i} at ${token.index} (${text}) with scopes ${token.scopes.join(', ')}`
            //    );
            //}
        }

        return [this.leftExtendHierToken(svtokennum, svtokens), svtokennum];
    }

    public getPackages(): string[] {
        return Array.from(this._pkgToFiles.keys());
    }

    public getInstFilePath(instType: string): string {
        if (this._moduleToFiles.has(instType)) {
            return [...this._moduleToFiles.get(instType)][0];
        }
        else if (this._interfaceToFiles.has(instType)) {
            return [...this._interfaceToFiles.get(instType)][0];
        }
        return undefined;
    }

    private _getContainerSymbols(cntnrToFiles: Map<string, Set<string>>, cntnrName: string, filter: (symbol: SystemVerilogSymbol) => Boolean, firstMatch: Boolean = false): SystemVerilogSymbol[] {
        let syms: SystemVerilogSymbol[] = [];
        if (cntnrToFiles.has(cntnrName)) {
            for (let file of cntnrToFiles.get(cntnrName)) {
                if (!this._indexedFilesInfo.has(file)) {
                    continue;
                }
                //TBD (implementing temp solution)
                let symbols: SystemVerilogSymbol[] = SystemVerilogParser.fileAllSymbols(this._indexedFilesInfo.get(file).symbolsInfo, false);
                for (let symbol of symbols) {
                    if ((symbol.containers.indexOf(cntnrName) >= 0) && filter(symbol)) {
                        syms.push(symbol);
                    }
                }
                if (firstMatch) {
                    break;
                }
            }
        }
        return syms;
    }

    public getPackageSymbols(pkg: string): SystemVerilogSymbol[] {
        return this._getContainerSymbols(this._pkgToFiles, pkg, (symbol: SystemVerilogSymbol): boolean => { return true; });
    }

    public getInstParams(instType: string, firstMatch: Boolean = false): SystemVerilogSymbol[] {
        let result: SystemVerilogSymbol[] = [];
        result = result.concat(this._getContainerSymbols(this._moduleToFiles, instType, (symbol: SystemVerilogSymbol): boolean => { return symbol.type[0] == "parameter-port"; }));
        if ((result.length == 0) || (!firstMatch)) {
            result = result.concat(this._getContainerSymbols(this._interfaceToFiles, instType, (symbol: SystemVerilogSymbol): boolean => { return symbol.type[0] == "parameter-port"; }));
        }
        return result;
    }

    public getInstPorts(instType: string, firstMatch: Boolean = false): SystemVerilogSymbol[] {
        let result: SystemVerilogSymbol[] = [];
        result = result.concat(this._getContainerSymbols(this._moduleToFiles, instType, (symbol: SystemVerilogSymbol): boolean => { return symbol.type[0] == "port"; }));
        if ((result.length == 0) || (!firstMatch)) {
            result = result.concat(this._getContainerSymbols(this._interfaceToFiles, instType, (symbol: SystemVerilogSymbol): boolean => { return symbol.type[0] == "port"; }));
        }
        return result;
    }

    private _getContainerSymbol(cntnrToFiles: Map<string, Set<string>>, cntnrName: string): [string, SystemVerilogSymbol] {
        if (cntnrToFiles.has(cntnrName)) {
            for (let file of cntnrToFiles.get(cntnrName)) {
                if (!this._indexedFilesInfo.has(file)) {
                    continue;
                }

                for (let symbol of SystemVerilogParser.fileAllContainers(this._indexedFilesInfo.get(file).symbolsInfo)) {
                    if (symbol.name == cntnrName) {
                        return [file, symbol];
                    }
                }
            }
        }
        return [undefined, undefined];
    }

    public getContainerSymbol(cntnrName: string): SystemVerilogSymbol {
        let result: SystemVerilogSymbol = this._getContainerSymbol(this._moduleToFiles, cntnrName)[1];
        if (result == undefined) {
            result = this._getContainerSymbol(this._interfaceToFiles, cntnrName)[1];
        }
        return result;
    }

    public getPackageSymbol(pkgName: string): [string, SystemVerilogSymbol] {
        let sym: SystemVerilogSymbol;
        let filePath: string;
        [filePath, sym] = this._getContainerSymbol(this._pkgToFiles, pkgName);
        return [filePath == undefined ? filePath : pathToUri(filePath), sym];
    }

    private _findPackageSymbol(pkgName: string, unscopedSymbolName: string, findContainer: Boolean): [string, SystemVerilogSymbol, SystemVerilogParser.SystemVerilogContainerSymbolsInfo] {
        // given package and symbol name, get container info
        //   find through all symbols
        //   otherwise find through all exports
        let pkgQ: string[] = [pkgName];
        while (pkgQ.length > 0) {
            let pkgItem: string = pkgQ.shift();
            if (this._pkgToFiles.has(pkgItem)) {
                for (let pkgFilePath of this._pkgToFiles.get(pkgItem)) {
                    if (this._indexedFilesInfo.has(pkgFilePath)) {
                        let pkgFileSymbolsInfo: SystemVerilogParser.SystemVerilogFileSymbolsInfo = this._indexedFilesInfo.get(pkgFilePath).symbolsInfo;
                        let pkgContainer: SystemVerilogParser.SystemVerilogContainerInfo;
                        if (pkgFileSymbolsInfo.containersInfo != undefined) {
                            for (let cntnr of pkgFileSymbolsInfo.containersInfo) {
                                if ((cntnr.symbol.name == pkgItem) && (cntnr.symbol.type[0] == "package")) {
                                    pkgContainer = cntnr;
                                    break;
                                }
                            }
                        }
                        if (pkgContainer != undefined) {
                            if (!findContainer &&
                                (pkgContainer.info.symbolsInfo != undefined)) {
                                let symbol: SystemVerilogSymbol = pkgContainer.info.symbolsInfo.find(sym => {
                                    return sym.name == unscopedSymbolName;
                                });
                                if (symbol != undefined) {
                                    return [pathToUri(pkgFilePath), symbol, {}];
                                }
                            }

                            if (pkgContainer.info.containersInfo != undefined) {
                                let cntnrInfo: SystemVerilogParser.SystemVerilogContainerInfo = pkgContainer.info.containersInfo.find(cntnr => {
                                    return cntnr.symbol.name == unscopedSymbolName;
                                });
                                if (cntnrInfo != undefined) {
                                    return [pathToUri(pkgFilePath), cntnrInfo.symbol, cntnrInfo.info];
                                }
                            }

                            let containerExportsInfo: SystemVerilogParser.SystemVerilogExportsInfo = SystemVerilogParser.containerExports(pkgContainer.info);
                            for (let exportItem of containerExportsInfo) {
                                if (exportItem.pkg == "*") {
                                    for (let pkgImport of SystemVerilogParser.containerImports(pkgContainer.info)) {
                                        if ((pkgImport.symbolsText.length == 1) && (pkgImport.symbolsText[0] == "*")) {
                                            pkgQ.unshift(pkgImport.pkg);
                                        }
                                        else if (pkgImport.symbolsText.includes(unscopedSymbolName)) {
                                            pkgQ.unshift(pkgImport.pkg);
                                        }
                                    }
                                }
                                else if ((exportItem.symbolsText.length == 1) &&
                                         (exportItem.symbolsText[0] == "*")) {
                                    pkgQ.unshift(exportItem.pkg);
                                }
                                else if (exportItem.symbolsText.includes(unscopedSymbolName)) {
                                    pkgQ.unshift(exportItem.pkg);
                                }
                            }
                        }
                    }
                }
            }
        }

        return [undefined, undefined, {}];
    }

    private _findSymbol(uri: string, symbolName: string, findContainer: Boolean): [string, SystemVerilogSymbol, SystemVerilogParser.SystemVerilogContainerSymbolsInfo] {
        let scopedParts: string[] = symbolName.split('::');
        if (scopedParts.length == 1) {
            let filePath: string = uriToPath(uri);
            if (!this._indexedFilesInfo.has(filePath)) {
                return [undefined, undefined, {}];
            }

            let symbolsInfo: SystemVerilogParser.SystemVerilogFileSymbolsInfo = this._indexedFilesInfo.get(filePath).symbolsInfo;
            if (findContainer) {
                let containerInfo: SystemVerilogParser.SystemVerilogContainerInfo = <SystemVerilogParser.SystemVerilogContainerInfo>(SystemVerilogParser.findSymbol(symbolsInfo, symbolName, true));
                if (containerInfo.symbol != undefined) {
                    return [uri, containerInfo.symbol, containerInfo.info];
                }
            }
            else {
                let symbol: SystemVerilogSymbol = <SystemVerilogSymbol>(SystemVerilogParser.findSymbol(symbolsInfo, symbolName, false));
                if (symbol != undefined) {
                    return [uri, symbol, {}];
                }
            }
        }

        let pkgName: string;
        let unscopedSymbolName: string;
        if (scopedParts.length > 1) {
            pkgName = scopedParts[0];
            unscopedSymbolName = scopedParts[1];
        }
        else {
            let fileImports: [string, string[]][] = this.getFileImports(uri);
            for (let fileImport of fileImports) {
                if (fileImport[1].includes(symbolName)) {
                    pkgName = fileImport[0];
                    unscopedSymbolName = symbolName;
                    break;
                }
            }
        }
        if ((pkgName == undefined) || (unscopedSymbolName == undefined)) {
            return [undefined, undefined, {}];
        }

        return this._findPackageSymbol(pkgName, unscopedSymbolName, findContainer);
    }

    public getContainerInfo(uri: string, containerName: string): [string, SystemVerilogSymbol, SystemVerilogParser.SystemVerilogContainerSymbolsInfo] {
        return this._findSymbol(uri, containerName, true);
    }

    public findSymbol(uri: string, symbolName: string): [string, SystemVerilogSymbol] {
        return <[string, SystemVerilogSymbol]>(this._findSymbol(uri, symbolName, false).slice(0, 2));
    }

    public findScopedSymbol(uri: string, symbolName: string, position: Position): [string, SystemVerilogSymbol] {
        let _isBefore = (pos1: Position, pos2: Position): boolean => {
            return ((pos1.line < pos2.line) ||
                ((pos1.line == pos2.line) && (pos1.character <= pos2.character)));
        };

        let _getScopedSymbolBeforePosition = (symbols: SystemVerilogSymbol[]): [string, SystemVerilogSymbol] => {
            let scopedSymbol: SystemVerilogSymbol;
            let scopedLocation: Position;
            symbols.forEach(sym => {
                if (sym.name == symbolName) {
                    let symLocation: Location = sym.getSymbolLocation(uri);
                    if ((symLocation.uri == uri) && _isBefore(symLocation.range.start, position)) {
                        if (scopedLocation == undefined) {
                            scopedSymbol = sym;
                            scopedLocation = symLocation.range.start;
                        }
                        else if (_isBefore(scopedLocation, symLocation.range.start)) {
                            scopedSymbol = sym;
                            scopedLocation = symLocation.range.start;
                        }
                    }
                    else if (scopedSymbol == undefined) {
                        scopedSymbol = sym;
                    }
                }
            });
            return [scopedSymbol == undefined ? undefined : uri, scopedSymbol];
        };

        let _getScopedSymbolInContainerContainingPosition = (containersInfo: SystemVerilogParser.SystemVerilogContainersInfo): [string, SystemVerilogSymbol] => {
            let scopedFile: string;
            let scopedSymbol: SystemVerilogSymbol;
            for (let cntnrInfo of containersInfo) {
                let cntnrStart: Location = cntnrInfo.symbol.getSymbolLocation(uri);
                let cntnrEnd: Position = cntnrInfo.position.file == undefined ? Position.create(cntnrInfo.position.line, cntnrInfo.position.character) : undefined;
                if ((cntnrStart.uri == uri) && _isBefore(cntnrStart.range.start, position) &&
                    (cntnrEnd !== undefined) && _isBefore(position, cntnrEnd)) {
                    let cntnrs: SystemVerilogParser.SystemVerilogContainersInfo = SystemVerilogParser.containerContainers(cntnrInfo);
                    [scopedFile, scopedSymbol] = _getScopedSymbolInContainerContainingPosition(cntnrs);

                    if ((scopedFile == undefined) || (scopedSymbol == undefined)) {
                        [scopedFile, scopedSymbol] = _getScopedSymbolBeforePosition(cntnrs.map(cntnr => cntnr.symbol).concat(SystemVerilogParser.containerTopSymbols(cntnrInfo)));
                    }

                    if (scopedSymbol == undefined) {
                        //imported symbols
                        let cntnrImports: SystemVerilogParser.SystemVerilogImportsInfo = SystemVerilogParser.containerImports(cntnrInfo.info, true);
                        let resolvedPkgSymNames: [string, string[]][] = this._resolveImportsIntoSymbolNames(cntnrImports);
                        for (let pkgSymNames of resolvedPkgSymNames) {
                            let symIndx: number = pkgSymNames[1].indexOf(symbolName);
                            if (symIndx >= 0) {
                                [scopedFile, scopedSymbol] = this._findPackageSymbol(pkgSymNames[0], symbolName, false);
                                break;
                            }
                        }
                    }

                    if ((scopedFile != undefined) && (scopedSymbol != undefined)) {
                        break;
                    }
                }
            }
            return [scopedFile, scopedSymbol];
        };

        let filePath: string = uriToPath(uri);
        if (!this._indexedFilesInfo.has(filePath)) {
            return [undefined, undefined];
        }

        let symbolsInfo: SystemVerilogParser.SystemVerilogFileSymbolsInfo = this._indexedFilesInfo.get(filePath).symbolsInfo;
        let containerScopedFile: string;
        let containerScopedSymbol: SystemVerilogSymbol;
        [containerScopedFile, containerScopedSymbol] = _getScopedSymbolInContainerContainingPosition(SystemVerilogParser.fileContainers(symbolsInfo));

        if ((containerScopedFile == undefined) || (containerScopedSymbol == undefined)) {
            let scopedFile: string;
            let scopedSymbol: SystemVerilogSymbol;
            let fileTopSymbols: SystemVerilogSymbol[] = SystemVerilogParser.fileTopSymbols(symbolsInfo);
            if (fileTopSymbols != undefined) {
                [scopedFile, scopedSymbol] = _getScopedSymbolBeforePosition(fileTopSymbols);
            }
            return [scopedFile, scopedSymbol];
        }

        return [containerScopedFile, containerScopedSymbol];
    }

    public getMacros(fileUri: string, macroName?: string): [string, SystemVerilogSymbol[]][] {
        let result: [string, SystemVerilogSymbol[]][] = [];
        let filePath: string = uriToPath(fileUri);
        if (this._indexedFilesInfo.has(filePath)) {
            let symbols: SystemVerilogSymbol[] = [];
            let fileSymbolsInfo: SystemVerilogParser.SystemVerilogFileSymbolsInfo = this._indexedFilesInfo.get(filePath).symbolsInfo;
            if (fileSymbolsInfo.symbolsInfo != undefined) {
                if (macroName == undefined) {
                    symbols = symbols.concat(fileSymbolsInfo.symbolsInfo.filter(sym => { return sym.type[0] == "macro"; }));
                }
                else {
                    symbols = fileSymbolsInfo.symbolsInfo.filter(sym => { return (sym.name == macroName) && (sym.type[0] == "macro"); });
                    if (symbols.length > 0) {
                        return [[fileUri, symbols]];
                    }
                }
            }
            if (symbols.length > 0) {
                result.push([fileUri, symbols]);
            }

            if (fileSymbolsInfo.includesInfo != undefined) {
                for (let include of fileSymbolsInfo.includesInfo) {
                    result = result.concat(this.getMacros(include, macroName));
                    if ((macroName != undefined) && (result.length > 0)) {
                        return result;
                    }
                }
            }
        }
        return result;
    }

    private _getActualDataType(fileUri: string, dataType: string): [string, string] {
        let currFile: string = fileUri;
        let currDataType: string = dataType;
        for (let i: number = 0; i < 100; i++) { // Cannot have more than 100 levels of aliases
            let dataTypeSymbol: SystemVerilogSymbol;
            // Resolve type
            //      hierarchical_identifier
            if (currDataType.indexOf(".") >= 0) {
                [currFile, dataTypeSymbol] = this.getHierarchicalSymbol(currFile, this.getHierParts(currDataType));
            }
            // Resolve type
            //      identifier -> typedef
            //      struct_union
            //      type-reference
            else {
                [currFile, dataTypeSymbol] = this.findSymbol(currFile, currDataType);
            }

            if ((currFile == undefined) || (dataTypeSymbol == undefined)) {
                return [undefined, undefined];
            }

            if (dataTypeSymbol.type[0] == "type") {
                if ((dataTypeSymbol.type.length < 2) || (dataTypeSymbol.type[1] == "#Unknown")) {
                    return [undefined, undefined];
                }
                //TBD
                return [undefined, undefined];
            }
            else if (dataTypeSymbol.type[0] == "typedef") {
                if ((dataTypeSymbol.type.length < 2) || (dataTypeSymbol.type[1] == "#Unknown")) {
                    return [undefined, undefined];
                }
                currDataType = dataTypeSymbol.type[1];
            }
            else if (SystemVerilogUtils.keywordsList.has(dataTypeSymbol.type[0])) {
                return [currFile, dataTypeSymbol.name];
            }
            else {
                return [undefined, undefined];
            }
        }
    }

    public getHierParts(symbolPath: string, idTokens?: GrammarToken[], length?: number): string[] {
        if (idTokens == undefined) {
            let nextPartOffset: number = symbolPath.indexOf(".", length);
            let truncSymPath: string = symbolPath.slice(0, (length != undefined) && (nextPartOffset >= 0) ? nextPartOffset : symbolPath.length);
            return truncSymPath.split(/\./);
        }

        let parts: string[] = [];
        let scopeDepth: number = idTokens[0].scopes.length - 1;
        let currLength: number = 0;
        for (let token of idTokens) {
            if (token.scopes[scopeDepth] == "identifier.hierarchical.systemverilog") {
                let allParts: string[] = token.text.split(/\./);
                for (let part of allParts) {
                    parts.push(part)
                    currLength += part.length + 1;
                    if ((length != undefined) && (currLength > length)) {
                        break;
                    }
                }
            }
            else if (token.scopes[scopeDepth].startsWith("identifier.")) {
                parts.push(token.text);
                currLength += token.text.length + 1;
            }
            if ((length != undefined) && (currLength > length)) {
                break;
            }
        }

        return parts;
    }

    public getSymbolTypeContainerInfo(fileUri: string, symbol: SystemVerilogSymbol, containerSymbolsInfo?: SystemVerilogParser.SystemVerilogContainerSymbolsInfo)
        : [string, SystemVerilogSymbol, SystemVerilogParser.SystemVerilogContainerSymbolsInfo] {
        if ((symbol.type[0] == "module") || (symbol.type[0] == "macromodule") || (symbol.type[0] == "interface")) {
            if (containerSymbolsInfo == undefined) {
                return this.getContainerInfo(fileUri, symbol.name);
            }
            else {
                return [fileUri, symbol, containerSymbolsInfo];
            }
        }
        else if (symbol.type[0] == "instance") {
            if (symbol.type.length < 2) {
                return [undefined, undefined, {}];
            }

            let filePath: string = this.getInstFilePath(symbol.type[1]);
            if (filePath == undefined) {
                return [undefined, undefined, {}];
            }

            return this.getContainerInfo(pathToUri(filePath), symbol.type[1]);
        }
        else if ((symbol.type[0] == "variable") ||
                 (symbol.type[0] == "port") ||
                 (symbol.type[0] == "parameter-port") ||
                 (symbol.type[0] == "parameter") ||
                 (symbol.type[0] == "localparam")) {
            if (symbol.type.length < 2) {
                return [undefined, undefined, {}];
            }

            let currFile: string;
            let dataType: string;
            if ((symbol.type[1] == "struct") || (symbol.type[1] == "union")) {
                if (symbol.type.length < 3) {
                    return [undefined, undefined, {}];
                }
                dataType = symbol.type[2];
            }
            else if (symbol.type[1] == "type") {
                if ((symbol.type.length < 3) || (symbol.type[2] == "#Unknown")) {
                    return [undefined, undefined, {}];
                }
                //TBD
                return [undefined, undefined, {}];
            }
            else if (SystemVerilogUtils.keywordsList.has(symbol.type[1])) {
                return [undefined, undefined, {}];
            }
            else {
                [currFile, dataType] = this._getActualDataType(fileUri, symbol.type[1]);
                if ((currFile == undefined) || (dataType == undefined) || SystemVerilogUtils.keywordsList.has(dataType)) {
                    return [undefined, undefined, {}];
                }
            }

            return this.getContainerInfo(currFile, dataType);
        }
        else {
            return [undefined, undefined, {}];
        }
    }

    public getHierarchicalSymbol(fileUri: string, symbolParts: string[]): [string, SystemVerilogSymbol] {
        // split parts
        // currFile = fileUri
        // for each part of parts:
        //     if currContainer == undefined:
        //         find symbol in currFile such that symbol.name == part
        //         if symbol not found:
        //             get file path for module|interface named part
        //             if file path not found:
        //                 return undefined
        //             else:
        //                 currFile = file path
        //                 currContainer = get module|interface container in currFile
        //                 symbol = currContainer[0]
        //     else:
        //         find symbol in currContainer such that symbol.name == part
        //
        //     if last part:
        //         return [currFile, symbol]
        //
        //     if symbol.type == instance:
        //         get instance type
        //         currFile = get file for instance type
        //         currContainer = get instance type container in currFile
        //     elif symbol.type == variable:
        //         get struct type
        //         find struct type symbol in currFile
        //         currFile = get file for struct type
        //         currContainer = get struct type container in currFile
        //     elif symbol.type == port:
        //         //TBD
        //     elif symbol.type == parameter-port:
        //         //TBD
        //     elif symbol.type != module|macromodule|interface:
        //         return undefined

        // Does not handle arrays (i.e. a[0].blah) and multiple layers of typedefs

        let currFile: string = fileUri;
        let currContainer: SystemVerilogParser.SystemVerilogContainerInfo = { symbol: undefined, position: undefined, info: {} };
        for (let i: number = 0; i < symbolParts.length; i++) {
            let symbolPart: string = symbolParts[i];
            if (currContainer.symbol == undefined) {
                [currFile, currContainer.symbol] = this.findSymbol(currFile, symbolPart);
                if (currContainer.symbol == undefined) {
                    let filePath: string = this.getInstFilePath(symbolPart);
                    if (filePath == undefined) {
                        return [undefined, undefined];
                    }
                    [currFile, currContainer.symbol, currContainer.info] = this.getContainerInfo(pathToUri(filePath), symbolPart);
                }
            }
            else {
                currContainer.symbol = <SystemVerilogSymbol>(SystemVerilogParser.findContainerSymbol(currContainer.info, symbolPart, false));
            }

            if (i == (symbolParts.length - 1)) {
                return [currFile, currContainer.symbol];
            }

            [currFile, currContainer.symbol, currContainer.info] = this.getSymbolTypeContainerInfo(currFile, currContainer.symbol, currContainer.info);
            if ((currFile == undefined) || (currContainer.symbol == undefined) || (currContainer.info == undefined)) {
                return [undefined, undefined];
            }
        }

        return [undefined, undefined];
    }

    private _resolveImportsIntoSymbolNames(importsInfo: SystemVerilogParser.SystemVerilogImportsInfo): [string, string[]][] {
        // get all imports into importsQ
        // iterate on importsQ with import
        //   if import is *
        //      get all symbols from the container and append into result
        //      get all exports from the container into exports
        //      iterate on exports with export
        //          if export is *::*
        //              get all imports from the container
        //              append all the imports to importsQ
        //          else if export is *
        //              append the export to importsQ
        //          else
        //              append the export to result
        //   else
        //      append the import to result
        let symbolNames: [string, string[]][] = [];
        let _importsInfo: SystemVerilogParser.SystemVerilogImportsInfo = [...importsInfo];
        while (_importsInfo.length > 0) {
            let importItem: SystemVerilogParser.SystemVerilogImportInfo = _importsInfo.shift();
            if ((importItem.symbolsText.length == 1) &&
                (importItem.symbolsText[0] == "*")) {
                if (this._pkgToFiles.has(importItem.pkg)) {
                    for (let pkgFilePath of this._pkgToFiles.get(importItem.pkg)) {
                        if (this._indexedFilesInfo.has(pkgFilePath)) {
                            let pkgFileSymbolsInfo: SystemVerilogParser.SystemVerilogFileSymbolsInfo = this._indexedFilesInfo.get(pkgFilePath).symbolsInfo;
                            let pkgContainer: SystemVerilogParser.SystemVerilogContainerInfo;
                            if (pkgFileSymbolsInfo.containersInfo != undefined) {
                                for (let cntnr of pkgFileSymbolsInfo.containersInfo) {
                                    if ((cntnr.symbol.name == importItem.pkg) && (cntnr.symbol.type[0] == "package")) {
                                        pkgContainer = cntnr;
                                        break;
                                    }
                                }
                            }
                            if (pkgContainer != undefined) {
                                if (pkgContainer.info.symbolsInfo != undefined) {
                                    symbolNames.push([importItem.pkg, pkgContainer.info.symbolsInfo.map(sym => {
                                        return sym.name;
                                    })]);
                                }

                                if (pkgContainer.info.containersInfo != undefined) {
                                    symbolNames.push([importItem.pkg, pkgContainer.info.containersInfo.map(cntnrInfo => {
                                        return cntnrInfo.symbol.name;
                                    })]);
                                }

                                let containerExportsInfo: SystemVerilogParser.SystemVerilogExportsInfo = SystemVerilogParser.containerExports(pkgContainer.info);
                                for (let exportItem of containerExportsInfo) {
                                    if (exportItem.pkg == "*") {
                                        _importsInfo.unshift(...SystemVerilogParser.containerImports(pkgContainer.info));
                                    }
                                    else if ((exportItem.symbolsText.length == 1) &&
                                             (exportItem.symbolsText[0] == "*")) {
                                        _importsInfo.unshift(exportItem);
                                    }
                                    else {
                                        symbolNames.push([exportItem.pkg, exportItem.symbolsText]);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            else {
                symbolNames.push([importItem.pkg, importItem.symbolsText]);
            }
        }
        return symbolNames;
    }

    public getFileImports(fileUri: string): [string, string[]][] {
        let symbolNames: [string, string[]][] = [];
        let filePath: string = uriToPath(fileUri);
        if (this._indexedFilesInfo.has(filePath)) {
            let fileImportsInfo: SystemVerilogParser.SystemVerilogImportsInfo = SystemVerilogParser.fileAllImports(this._indexedFilesInfo.get(filePath).symbolsInfo);
            return this._resolveImportsIntoSymbolNames(fileImportsInfo);
        }
        return symbolNames;
    }

    public findUserDefine(defText: string): number {
        return this._userDefines.findIndex(d => d.name == defText);
    }

    public getUserDefine(defNum: number): string {
        return [this._userDefines[defNum].name, this._userDefines[defNum].def].join('=');
    }

    public getIncFilePathAndSymbol(filePath: string): [string, SystemVerilogSymbol] {
        if (this._preprocCache.has(filePath)) {
            let entry: PreprocCacheEntry = this._preprocCache.get(filePath);
            let symbol: SystemVerilogSymbol = entry.info.symbols.find(s => s.type.indexOf("includefile") >= 0);
            if (symbol) {
                return [pathToUri(entry.file), symbol];
            }
        }
        return [undefined, undefined];
    }

    public getHier(cntnrName: string) {
        let cntnrHier = {};
        let cntnrType: string;
        let cntnrFilePath: string;
        if (this._moduleToFiles.has(cntnrName)) {
            cntnrType = "module";
            cntnrFilePath = [...this._moduleToFiles.get(cntnrName)][0];
        }
        else if (this._interfaceToFiles.has(cntnrName)) {
            cntnrType = "interface";
            cntnrFilePath = [...this._interfaceToFiles.get(cntnrName)][0];
        }
        if (!!cntnrType && !!cntnrFilePath && this._indexedFilesInfo.has(cntnrFilePath)) {
            cntnrHier[cntnrType] = cntnrName;
            cntnrHier["file"] = cntnrFilePath;
            let cntnrInfo: SystemVerilogParser.SystemVerilogContainerInfo = SystemVerilogParser.findFileContainer(this._indexedFilesInfo.get(cntnrFilePath).symbolsInfo, cntnrName);
            let cntnrInstances: SystemVerilogSymbol[] = SystemVerilogParser.getInstSymbolsInContainer(cntnrInfo.info);
            if (cntnrInstances.length > 0) {
                cntnrHier["instances"] = {};
            }
            for (let symbol of cntnrInstances) {
                cntnrHier["instances"][symbol.name] = this.getHier(symbol.type[1]);
            }
        }
        return cntnrHier;
    }
}
