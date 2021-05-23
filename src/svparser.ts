import { TextDocument, Location, Range, Position } from "vscode-languageserver";

import {
    ConnectionLogger,
    pathToUri,
    uriToPath
} from './genutils';

import {
    GrammarEngine,
    GrammarToken,
} from './grammar_engine';

import {
    svcompletion_grammar
} from './svcompletion_grammar';

import { 
    DefinitionLocations,
    SystemVerilogSymbol,
    SystemVerilogSymbolJSON
} from "./svsymbol";

import {
    MacroInfo,
    PreprocIncInfo,
    PreprocIncInfoJSON,
    PreprocInfo,
    SystemVerilogPreprocessor
} from "./svpreprocessor";

const DEBUG_MODE: number = 0;

class ParseToken {
    text: string;
    scopes: string[];
    startTokenIndex: number;
    endTokenIndex: number;
}

function _initFileSymbols(fileSymbolsInfo: SystemVerilogParser.SystemVerilogFileSymbolsInfo[], index: SystemVerilogParser.FileInfoIndex, entries?: SystemVerilogParser.SystemVerilogFileSymbolsInfo) {
    for (let i: number = fileSymbolsInfo.length; i < index; i++) {
        fileSymbolsInfo.push(undefined);
    }

    if (fileSymbolsInfo.length == index) {
        fileSymbolsInfo.push(entries == undefined ? [] : entries);
    }
    else {
        fileSymbolsInfo[index] = entries == undefined ? [] : entries;
    }
}

function _initContainerSymbols(containerSymbolsInfo: SystemVerilogParser.SystemVerilogContainerSymbolsInfo[], index: SystemVerilogParser.ContainerInfoIndex, entries?: SystemVerilogParser.SystemVerilogContainerSymbolsInfo) {
    for (let i: number = containerSymbolsInfo.length; i < index; i++) {
        containerSymbolsInfo.push(undefined);
    }

    if (containerSymbolsInfo.length == index) {
        containerSymbolsInfo.push(entries == undefined ? [] : entries);
    }
    else {
        containerSymbolsInfo[index] = entries == undefined ? [] : entries;
    }
}

function _jsonToContainerSymbolsInfo(file: string, jsonContainerSymbolsInfo: SystemVerilogParser.SystemVerilogContainerSymbolsInfoJSON[]): SystemVerilogParser.SystemVerilogContainerSymbolsInfo[] {
    let containerSymbolsInfo: SystemVerilogParser.SystemVerilogContainerSymbolsInfo[] = [];

    if (jsonContainerSymbolsInfo.length > SystemVerilogParser.ContainerInfoIndex.Symbols) {
        _initContainerSymbols(containerSymbolsInfo, SystemVerilogParser.ContainerInfoIndex.Symbols);
        if (jsonContainerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Symbols] == undefined) {
            containerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Symbols] = undefined;
        }
        else {
            for (let symbol of <SystemVerilogParser.SystemVerilogSymbolsInfoJSON>(jsonContainerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Symbols])) {
                (<SystemVerilogParser.SystemVerilogSymbolsInfo>(containerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Symbols])).push(SystemVerilogSymbol.fromJSON(file, symbol));
            }
        }
    }

    if (jsonContainerSymbolsInfo.length > SystemVerilogParser.ContainerInfoIndex.Imports) {
        _initContainerSymbols(containerSymbolsInfo, SystemVerilogParser.ContainerInfoIndex.Imports);
        containerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Imports] = <SystemVerilogParser.SystemVerilogImportsInfo>(jsonContainerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Imports]);
    }

    if (jsonContainerSymbolsInfo.length > SystemVerilogParser.ContainerInfoIndex.Containers) {
        _initContainerSymbols(containerSymbolsInfo, SystemVerilogParser.ContainerInfoIndex.Containers);
        if (jsonContainerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Containers] == undefined) {
            containerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Containers] = undefined;
        }
        else {
            for (let jsonContainerInfo of jsonContainerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Containers]) {
                (<SystemVerilogParser.SystemVerilogContainersInfo>(containerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Containers])).push([
                    SystemVerilogSymbol.fromJSON(file, <SystemVerilogSymbolJSON>(jsonContainerInfo[0])),
                    _jsonToContainerSymbolsInfo(file, <SystemVerilogParser.SystemVerilogContainerSymbolsInfoJSON[]>(jsonContainerInfo[1]))
                ]);
            }
        }
    }

    if (jsonContainerSymbolsInfo.length > SystemVerilogParser.ContainerInfoIndex.Exports) {
        _initContainerSymbols(containerSymbolsInfo, SystemVerilogParser.ContainerInfoIndex.Exports);
        containerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Exports] = <SystemVerilogParser.SystemVerilogExportsInfo>(jsonContainerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Exports]);
    }

    return containerSymbolsInfo;
}

type ImportExportMap = Map<string, [Boolean, Set<string>, number]>;

class ContainerStack {
    private _stack: [SystemVerilogParser.SystemVerilogFileSymbolsInfo[], SystemVerilogParser.SystemVerilogContainersInfo];
    private _symbolMap: Map<string, number>;
    private _importMap: ImportExportMap;
    private _exportMap: ImportExportMap;

    constructor(fileSymbolsInfo: SystemVerilogParser.SystemVerilogFileSymbolsInfo[]) {
        this._stack = [fileSymbolsInfo, []];
        this._symbolMap = new Map();
        this._importMap = new Map();
        this._exportMap = new Map();
    }

    push(symbol: SystemVerilogSymbol): SystemVerilogSymbol {
        let containerSymbols: SystemVerilogParser.SystemVerilogContainersInfo;
        if (this._stack[1].length <= 0) {
            if ((this._stack[0].length <= SystemVerilogParser.FileInfoIndex.Containers) ||
                (this._stack[0][SystemVerilogParser.FileInfoIndex.Containers] == undefined)) {
                _initFileSymbols(this._stack[0], SystemVerilogParser.FileInfoIndex.Containers);
            }
            containerSymbols = <SystemVerilogParser.SystemVerilogContainersInfo>(this._stack[0][SystemVerilogParser.FileInfoIndex.Containers]);
        }
        else {
            let containerSymbolsInfo: SystemVerilogParser.SystemVerilogContainerSymbolsInfo[] = this._stack[1][this._stack[1].length - 1][1];
            if ((containerSymbolsInfo.length <= SystemVerilogParser.ContainerInfoIndex.Containers) ||
                (containerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Containers] == undefined)) {
                _initContainerSymbols(containerSymbolsInfo, SystemVerilogParser.ContainerInfoIndex.Containers);
            }
            containerSymbols = <SystemVerilogParser.SystemVerilogContainersInfo>(containerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Containers]);
        }

        let containerInfo: SystemVerilogParser.SystemVerilogContainerInfo;
        let symbolStr: string = [symbol.name, ...symbol.type, ...this.toStringList()].join(' ');
        let resSymbol: SystemVerilogSymbol;
        if (this._symbolMap.has(symbolStr)) {
            containerInfo = containerSymbols[this._symbolMap.get(symbolStr)];
            containerInfo[0].overwrite(symbol);
            resSymbol = containerInfo[0];
        }
        else {
            this._symbolMap.set(symbolStr, containerSymbols.length);
            containerInfo = [symbol, []];
            containerSymbols.push(containerInfo);
            resSymbol = symbol;
        }

        this._stack[1].push(containerInfo);
        return resSymbol;
    }

    pushSymbol(symbol: SystemVerilogSymbol): SystemVerilogSymbol {
        let symbols: SystemVerilogParser.SystemVerilogSymbolsInfo;
        if (this._stack[1].length <= 0) {
            if ((this._stack[0].length <= SystemVerilogParser.FileInfoIndex.Symbols) ||
                (this._stack[0][SystemVerilogParser.FileInfoIndex.Symbols] == undefined)) {
                _initFileSymbols(this._stack[0], SystemVerilogParser.FileInfoIndex.Symbols);
            }
            symbols = <SystemVerilogParser.SystemVerilogSymbolsInfo>(this._stack[0][SystemVerilogParser.FileInfoIndex.Symbols]);
        }
        else {
            let containerSymbolsInfo: SystemVerilogParser.SystemVerilogContainerSymbolsInfo[] = this._stack[1][this._stack[1].length - 1][1];
            if ((containerSymbolsInfo.length <= SystemVerilogParser.ContainerInfoIndex.Symbols) ||
                (containerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Symbols] == undefined)) {
                _initContainerSymbols(containerSymbolsInfo, SystemVerilogParser.ContainerInfoIndex.Symbols);
            }
            symbols = <SystemVerilogParser.SystemVerilogSymbolsInfo>(containerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Symbols]);
        }

        let symbolStr: string = [symbol.name, ...symbol.type, ...this.toStringList()].join(' ');
        let resSymbol: SystemVerilogSymbol;
        if (this._symbolMap.has(symbolStr)) {
            symbols[this._symbolMap.get(symbolStr)].overwrite(symbol);
            resSymbol = symbols[this._symbolMap.get(symbolStr)];
        }
        else {
            this._symbolMap.set(symbolStr, symbols.length);
            symbols.push(symbol);
            resSymbol = symbol;
        }

        return resSymbol;
    }

    pop() {
        if (this._stack[1].length <= 0) {
            ConnectionLogger.error(`ContainerStack is already empty!`);
            return;
        }
        this._stack[1].pop();
    }

    toStringList(): string[] {
        return this._stack[1].map(e => e[0].name);
    }

    pushImportItem(importItemToken: ParseToken) {
        let importParts: string[] = importItemToken.text.split('::');
        let importHierPath: string = [importParts[0], ...this.toStringList()].join(' ');
        if (!this._importMap.has(importHierPath)) {
            this._importMap.set(importHierPath, [false, new Set(), undefined]);
        }

        let importInfo: [Boolean, Set<string>, number] = this._importMap.get(importHierPath);
        if (importInfo[0]) {
            return;
        }

        let importsInfo: SystemVerilogParser.SystemVerilogImportsInfo;
        if (this._stack[1].length <= 0) {
            if ((this._stack[0].length <= SystemVerilogParser.FileInfoIndex.Imports) ||
                (this._stack[0][SystemVerilogParser.FileInfoIndex.Imports] == undefined)) {
                _initFileSymbols(this._stack[0], SystemVerilogParser.FileInfoIndex.Imports);
            }
            importsInfo = <SystemVerilogParser.SystemVerilogImportsInfo>(this._stack[0][SystemVerilogParser.FileInfoIndex.Imports]);
        }
        else {
            let containerSymbolsInfo: SystemVerilogParser.SystemVerilogContainerSymbolsInfo[] = this._stack[1][this._stack[1].length - 1][1];
            if ((containerSymbolsInfo.length <= SystemVerilogParser.ContainerInfoIndex.Imports) ||
                (containerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Imports] == undefined)) {
                _initContainerSymbols(containerSymbolsInfo, SystemVerilogParser.ContainerInfoIndex.Imports);
            }
            importsInfo = <SystemVerilogParser.SystemVerilogImportsInfo>(containerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Imports]);
        }

        if (importInfo[2] == undefined) {
            importInfo[2] = importsInfo.length;
            importsInfo.push([importParts[0], []]);
        }

        if (importParts[1] == "*") {
            importInfo[0] = true;
            importInfo[1] = new Set(["*"]);
            importsInfo[importInfo[2]][1] = ["*"];
        }
        else {
            importsInfo[importInfo[2]][1].push(importParts[1]);
        }
    }

    pushExportItem(exportItemToken: ParseToken) {
        let exportParts: string[] = exportItemToken.text.split('::');
        let exportHierPath: string = [exportParts[0], ...this.toStringList()].join(' ');
        if (!this._exportMap.has(exportHierPath)) {
            this._exportMap.set(exportHierPath, [false, new Set(), undefined]);
        }

        if (exportParts[0] == "*") {
            return;
        }

        let exportInfo: [Boolean, Set<string>, number] = this._exportMap.get(exportHierPath);
        if (exportInfo[0]) {
            return;
        }

        let exportsInfo: SystemVerilogParser.SystemVerilogExportsInfo;
        if (this._stack[1].length <= 0) {
            if ((this._stack[0].length <= SystemVerilogParser.FileInfoIndex.Exports) ||
                (this._stack[0][SystemVerilogParser.FileInfoIndex.Exports] == undefined)) {
                _initFileSymbols(this._stack[0], SystemVerilogParser.FileInfoIndex.Exports);
            }
            exportsInfo = <SystemVerilogParser.SystemVerilogExportsInfo>(this._stack[0][SystemVerilogParser.FileInfoIndex.Exports]);
        }
        else {
            let containerSymbolsInfo: SystemVerilogParser.SystemVerilogContainerSymbolsInfo[] = this._stack[1][this._stack[1].length - 1][1];
            if ((containerSymbolsInfo.length <= SystemVerilogParser.ContainerInfoIndex.Exports) ||
                (containerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Exports] == undefined)) {
                _initContainerSymbols(containerSymbolsInfo, SystemVerilogParser.ContainerInfoIndex.Exports);
            }
            exportsInfo = <SystemVerilogParser.SystemVerilogExportsInfo>(containerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Exports]);
        }

        if (exportInfo[2] == undefined) {
            exportInfo[2] = exportsInfo.length;
            exportsInfo.push([exportParts[0], []]);
        }

        if (exportParts[1] == "*") {
            exportInfo[0] = true;
            exportInfo[1] = new Set(["*"]);
            exportsInfo[exportInfo[2]][1] = ["*"];
        }
        else {
            exportsInfo[exportInfo[2]][1].push(exportParts[1]);
        }
    }
}

export class SystemVerilogParser {
    private _completionGrammarEngine: GrammarEngine = new GrammarEngine(svcompletion_grammar, "meta.invalid.systemverilog");
    private _anonStructUnionCount: number = 0;
    private _anonEnumCount: number = 0;

    private _document: TextDocument;
    private _documentPath: string;
    private _includeCache: Map<string, [string, PreprocIncInfo, TextDocument]>;
    private _fileSymbolsInfo: SystemVerilogParser.SystemVerilogFileSymbolsInfo[];
    private _svtokens: ParseToken[];
    private _tokenOrder: [string, number][];
    private _symbols: SystemVerilogSymbol[];
    private _containerStack: ContainerStack;
    private _currTokenNum: number;

    private _debugContainerInfo(containerInfo: SystemVerilogParser.SystemVerilogContainerSymbolsInfo[], symIndex: number) {
        if ((containerInfo.length <= symIndex) ||
            (containerInfo[symIndex] == undefined)) {
            return;
        }

        if (symIndex == SystemVerilogParser.ContainerInfoIndex.Symbols) {
            for (let symbol of <SystemVerilogParser.SystemVerilogSymbolsInfo>(containerInfo[SystemVerilogParser.ContainerInfoIndex.Symbols])) {
                ConnectionLogger.log(`DEBUG: symbol "${symbol.name}" of type ${symbol.type}`);
            }
        }
        else if (symIndex == SystemVerilogParser.ContainerInfoIndex.Imports) {
            for (let importItem of <SystemVerilogParser.SystemVerilogImportsInfo>(containerInfo[SystemVerilogParser.ContainerInfoIndex.Imports])) {
                ConnectionLogger.log(`DEBUG: imports from "${importItem[0]}" are ${importItem[1]}`);
            }
        }
        else if (symIndex == SystemVerilogParser.ContainerInfoIndex.Containers) {
            for (let childContainerInfo of <SystemVerilogParser.SystemVerilogContainersInfo>(containerInfo[SystemVerilogParser.ContainerInfoIndex.Containers])) {
                let symbol: SystemVerilogSymbol = childContainerInfo[0];
                ConnectionLogger.log(`DEBUG: container symbol "${symbol.name}" of type ${symbol.type}`);
                let containerSymbolsInfo: SystemVerilogParser.SystemVerilogContainerSymbolsInfo[] = childContainerInfo[1];
                for (let si: number = 0; si < containerSymbolsInfo.length; si++) {
                    this._debugContainerInfo(containerSymbolsInfo, si);
                }
            }
        }
        else if (symIndex == SystemVerilogParser.ContainerInfoIndex.Exports) {
            for (let exportItem of <SystemVerilogParser.SystemVerilogExportsInfo>(containerInfo[SystemVerilogParser.ContainerInfoIndex.Exports])) {
                ConnectionLogger.log(`DEBUG: exports from "${exportItem[0]}" are ${exportItem[1]}`);
            }
        }
        else {
            ConnectionLogger.error(`Unsupported SystemVerilogParser.ContainerInfoIndex ${symIndex}`);
        }
    }

    private _debugFileInfo(symIndex: number) {
        if (symIndex == SystemVerilogParser.FileInfoIndex.Containers) {
            if ((this._fileSymbolsInfo.length <= SystemVerilogParser.FileInfoIndex.Containers) ||
                (this._fileSymbolsInfo[SystemVerilogParser.FileInfoIndex.Containers] == undefined)) {
                return;
            }
            for (let containerInfo of <SystemVerilogParser.SystemVerilogContainersInfo>(this._fileSymbolsInfo[SystemVerilogParser.FileInfoIndex.Containers])) {
                let symbol: SystemVerilogSymbol = containerInfo[0];
                ConnectionLogger.log(`DEBUG: container symbol "${symbol.name}" of type ${symbol.type}`);
                let containerSymbolsInfo: SystemVerilogParser.SystemVerilogContainerSymbolsInfo[] = containerInfo[1];
                for (let si: number = 0; si < containerSymbolsInfo.length; si++) {
                    this._debugContainerInfo(containerSymbolsInfo, si);
                }
            }
        }
        else if (symIndex == SystemVerilogParser.FileInfoIndex.Includes) {
            if ((this._fileSymbolsInfo.length <= SystemVerilogParser.FileInfoIndex.Includes) ||
                (this._fileSymbolsInfo[SystemVerilogParser.FileInfoIndex.Includes] == undefined) ||
                (this._fileSymbolsInfo[SystemVerilogParser.FileInfoIndex.Includes].length <= 0)) {
                ConnectionLogger.log(`DEBUG: no includes in ${this._documentPath}`);
                return;
            }
            for (let include of <SystemVerilogParser.SystemVerilogIncludesInfo>(this._fileSymbolsInfo[SystemVerilogParser.FileInfoIndex.Includes])) {
                ConnectionLogger.log(`DEBUG: ${include} included in ${this._documentPath}`);
            }
        }
        else if (symIndex == SystemVerilogParser.FileInfoIndex.Imports) {
            if ((this._fileSymbolsInfo.length <= SystemVerilogParser.FileInfoIndex.Imports) ||
                (this._fileSymbolsInfo[SystemVerilogParser.FileInfoIndex.Imports] == undefined) ||
                (this._fileSymbolsInfo[SystemVerilogParser.FileInfoIndex.Imports].length <= 0)) {
                ConnectionLogger.log(`DEBUG: no global imports in ${this._documentPath}`);
                return;
            }
            for (let importItem of <SystemVerilogParser.SystemVerilogImportsInfo>(this._fileSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Imports])) {
                ConnectionLogger.log(`DEBUG: global imports from "${importItem[0]}" are ${importItem[1]}`);
            }
        }
        else if (symIndex == SystemVerilogParser.FileInfoIndex.Exports) {
            if ((this._fileSymbolsInfo.length <= SystemVerilogParser.FileInfoIndex.Exports) ||
                (this._fileSymbolsInfo[SystemVerilogParser.FileInfoIndex.Exports] == undefined) ||
                (this._fileSymbolsInfo[SystemVerilogParser.FileInfoIndex.Exports].length <= 0)) {
                ConnectionLogger.log(`DEBUG: no global exports in ${this._documentPath}`);
                return;
            }
            for (let exportItem of <SystemVerilogParser.SystemVerilogExportsInfo>(this._fileSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Exports])) {
                ConnectionLogger.log(`DEBUG: global exports from "${exportItem[0]}" are ${exportItem[1]}`);
            }
        }
        else if (symIndex == SystemVerilogParser.FileInfoIndex.Symbols) {
            if ((this._fileSymbolsInfo.length <= SystemVerilogParser.FileInfoIndex.Symbols) ||
                (this._fileSymbolsInfo[SystemVerilogParser.FileInfoIndex.Symbols] == undefined)) {
                return;
            }
            for (let symbol of <SystemVerilogParser.SystemVerilogSymbolsInfo>(this._fileSymbolsInfo[SystemVerilogParser.FileInfoIndex.Symbols])) {
                ConnectionLogger.log(`DEBUG: symbol "${symbol.name}" of type ${symbol.type}`);
            }
        }
        else {
            ConnectionLogger.error(`Unsupported SystemVerilogParser.FileInfoIndex ${symIndex}`);
        }
    }

    public tokenize(text: string, includeFilePaths: string[], userDefinesMacroInfo: Map<string, MacroInfo>): [ParseToken[], [string, number][], SystemVerilogSymbol[]] {
        let preprocParser: SystemVerilogPreprocessor = new SystemVerilogPreprocessor();
        let preprocInfo: PreprocInfo = preprocParser.parse(this._document, includeFilePaths, this._includeCache, userDefinesMacroInfo);

        if (preprocInfo.includes.size > 0) {
            _initFileSymbols(this._fileSymbolsInfo, SystemVerilogParser.FileInfoIndex.Includes, [...preprocInfo.includes]);
        }

        let postText: string = preprocInfo.postTokens.map(tok => tok.text).join('');
        let tokens: GrammarToken[] = this._completionGrammarEngine.tokenize(postText);
        let parseTokens: ParseToken[] = tokens.map(token => { return {text: token.text, scopes: token.scopes, startTokenIndex: undefined, endTokenIndex: undefined}; });
        let tokenOrder: [string, number][] = [];
        let currParseToken: number = 0;
        let tokenText: string = "";
        let tokenOrderIndex: number = 0;
        let tokenOrderFile: string;
        for (let i: number = 0; i < preprocInfo.postTokens.length; i++) {
            if ((tokenOrderIndex < preprocInfo.tokenOrder.length) &&
                (preprocInfo.tokenOrder[tokenOrderIndex][1] == i)) {
                if ((tokenText != "") && (parseTokens[currParseToken].text.trim() != "")) {
                    ConnectionLogger.error(`assumption about tokens not split across files might be broken for ${this._documentPath} at ${preprocInfo.tokenOrder[tokenOrderIndex][1]}`);
                }
                tokenOrderFile = preprocInfo.tokenOrder[tokenOrderIndex][0];
                tokenOrderIndex++;
            }

            if (tokenText == "") {
                parseTokens[currParseToken].startTokenIndex = preprocInfo.postTokens[i].index;
                if (tokenOrderFile != undefined) {
                    tokenOrder.push([tokenOrderFile, currParseToken]);
                }
                tokenOrderFile = undefined;
            }

            tokenText += preprocInfo.postTokens[i].text;

            if (tokenText.length >= parseTokens[currParseToken].text.length) {
                if ((tokenText.length > parseTokens[currParseToken].text.length) || (tokenText != parseTokens[currParseToken].text)) {
                    ConnectionLogger.error(`Assumption made for token re-ranging broken for token "${parseTokens[currParseToken].text}"`);
                }
                parseTokens[currParseToken].endTokenIndex = preprocInfo.postTokens[i].endIndex;
                currParseToken++;
                tokenText = "";
            }
        }

        return [parseTokens, tokenOrder, preprocInfo.symbols];
    }

    private _getElem<T>(list: T[], index?: number): T {
        let _index: number = (index == undefined) ? list.length - 1: index;
        return (list.length > _index) && (_index >= 0) ? list[_index] : undefined;
    }

    private _getTokenOrderIndex(token: number): number {
        let tokenOrderIndex: number;
        for (let i: number = this._tokenOrder.length - 1; i >= 0; i--) {
            if (token >= this._tokenOrder[i][1]) {
                tokenOrderIndex = i;
                break;
            }
        }
        return tokenOrderIndex;
    }

    private _getDefLocations(startToken: number, endToken: number): DefinitionLocations {
        let tokenOrderIndex: number = this._getTokenOrderIndex(startToken);
        if (tokenOrderIndex == undefined) {
            ConnectionLogger.error(`Could not figure out the source file for the given range. Falling back to default`);
            return Range.create(
                this._document.positionAt(this._svtokens[startToken].startTokenIndex),
                this._document.positionAt(this._svtokens[endToken].endTokenIndex + 1)
            );
        }

        let tokenOrderIndices: number[] = [tokenOrderIndex];
        tokenOrderIndex++;
        while ((tokenOrderIndex < this._tokenOrder.length) && (endToken >= this._tokenOrder[tokenOrderIndex][1])) {
            tokenOrderIndices.push(tokenOrderIndex);
            tokenOrderIndex++;
        }

        let defLocations: DefinitionLocations = (this._documentPath == this._tokenOrder[tokenOrderIndices[0]][0]) ? [] : [pathToUri(this._tokenOrder[tokenOrderIndices[0]][0])];
        let currToken: number = startToken;
        for (let i: number = 1; i < tokenOrderIndices.length; i++) {
            defLocations.push(Range.create(
                this._document.positionAt(this._svtokens[currToken].startTokenIndex),
                this._document.positionAt(this._svtokens[this._tokenOrder[tokenOrderIndices[i]][1] - 1].endTokenIndex + 1)
            ));
            currToken = this._tokenOrder[tokenOrderIndices[i]][1];
        }
        defLocations.push(Range.create(
            this._document.positionAt(this._svtokens[currToken].startTokenIndex),
            this._document.positionAt(this._svtokens[endToken].endTokenIndex + 1)
        ));
        if (defLocations.length == 1) {
            defLocations = <Range>defLocations[0];
        }

        return defLocations;
    }

    private _getSymbolDocument(symToken: number) {
        let document: TextDocument;
        let tokenOrderIndex: number = this._getTokenOrderIndex(symToken);
        let file: string = this._documentPath;
        if (tokenOrderIndex == undefined) {
            ConnectionLogger.error(`Could not figure out the source file for the given range. Falling back to default`);
        }
        else {
            file = this._tokenOrder[tokenOrderIndex][0];
        }

        if (file == this._documentPath) {
            document = this._document;
        }
        else {
            let shortFile: string;
            for (let [sfile, fileInfo] of this._includeCache) {
                if (fileInfo[0] == file) {
                    shortFile = sfile;
                    break;
                }
            }
            if (shortFile) {
                document = this._includeCache.get(shortFile)[2];
            }
            else {
                ConnectionLogger.error(`Could not find include cache for ${file}`);
                return undefined;
            }
        }

        return document;
    }

    private _createSymbol(symToken: number, symbolType: string[], tokenRange?: [number, number], symbolText?: string): SystemVerilogSymbol {
        let document: TextDocument = this._getSymbolDocument(symToken);
        let symbolName: string = symbolText || this._svtokens[symToken].text;
        let symbolRange: Range = Range.create(
            document.positionAt(this._svtokens[symToken].startTokenIndex),
            document.positionAt(this._svtokens[symToken].endTokenIndex + 1)
        );
        return new SystemVerilogSymbol(
            symbolName,
            tokenRange ? this._getDefLocations(tokenRange[0], tokenRange[1]) : undefined,
            symbolRange,
            this._containerStack.toStringList(),
            symbolType
        );
    }

    private _pushSymbol(symToken: number, symbolType: string[], tokenRange?: [number, number], symbolText?: string): SystemVerilogSymbol {
        let symbol: SystemVerilogSymbol = this._createSymbol(symToken, symbolType, tokenRange, symbolText);
        symbol = this._containerStack.pushSymbol(symbol);
        return symbol;
    }

    private _pushContainerSymbol(symToken: number, symbolType: string[], tokenRange?: [number, number], symbolText?: string): SystemVerilogSymbol {
        let containerSymbol: SystemVerilogSymbol = this._createSymbol(symToken, symbolType, tokenRange, symbolText);
        containerSymbol = this._containerStack.push(containerSymbol);
        return containerSymbol;
    }

    private _notIgnorableScope(): boolean {
        let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes);
        return (scope != "comment.block.systemverilog") && (scope != "comment.line.systemverilog") && (scope != "meta.whitespace.systemverilog");
    }

    private _nextNonIgnorableScope(): number {
        this._currTokenNum++;
        for (; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            if (this._notIgnorableScope()) {
                return this._currTokenNum;
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
        }
        return undefined;
    }

    private _printDebugInfo(blockId: string) {
        if (DEBUG_MODE != 1) {
            return;
        }
        let pos: Position = this._document.positionAt(this._svtokens[this._currTokenNum].startTokenIndex);
        ConnectionLogger.log(`DEBUG: Found ${blockId} at ${pos.line}, ${pos.character}`);
    }

    private _processTypeReference(): string {
        let typeName: string = "#Unknown";
        let typeToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[typeToken].scopes.length - 1;
        this._nextNonIgnorableScope();

        let prevToken: number;
        let simpleIdExpression: boolean = false;
        for(; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            if ((this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth) != "parantheses.begin.systemverilog") &&
                (this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth) != "parantheses.block.systemverilog")) {
                this._currTokenNum--;
                break;
            }

            if (this._notIgnorableScope()) {
                let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth + 1);
                if (scope.startsWith("identifier.")) {
                    simpleIdExpression = (prevToken == undefined);
                    prevToken = this._currTokenNum;
                }
                else if ((scope != undefined) && (scope != "parantheses.end.systemverilog")) {
                    simpleIdExpression = false;
                    prevToken = this._currTokenNum;
                }
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
        }
        else if (simpleIdExpression) {
            typeName = this._svtokens[prevToken].text;
        }

        return typeName;
    }

    private _processGenericPortList(scopesList: string[], portType: string) {
        let genericPortSymbol: SystemVerilogSymbol;
        let scopeDepth: number = this._svtokens[this._currTokenNum].scopes.length - 1;
        this._currTokenNum++;
        let startToken: number;
        let endToken: number;
        let prevIdToken: number;
        let prevToken: number;
        let portDataType: string;
        let portDataTypeToken: number;
        for (; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            if (scopesList.indexOf(this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth)) < 0) {
                this._currTokenNum--;
                break;
            }

            let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth + 1);
            if (this._notIgnorableScope()) {
                if (startToken != undefined) {
                    if (endToken != undefined) {
                        if ((scope == "operator.comma.systemverilog") ||
                            (scope == "operator.close_parantheses.systemverilog")) {
                            genericPortSymbol.defLocations = this._getDefLocations(startToken, prevToken);
                            startToken = undefined;
                            endToken = undefined;
                            genericPortSymbol = undefined;
                        }
                    }
                    else {
                        if ((scope == "operator.equals.systemverilog") ||
                            (scope == "operator.comma.systemverilog") ||
                            (scope == "operator.close_parantheses.systemverilog")) {
                            let types: string[] = [portType].concat(portDataType || (portDataTypeToken == undefined ? [] : this._svtokens[portDataTypeToken].text));
                            genericPortSymbol = this._pushSymbol(prevIdToken, types, [startToken, prevToken]);
                            if (scope != "operator.equals.systemverilog") {
                                startToken = undefined;
                                endToken = undefined;
                                genericPortSymbol = undefined;
                                portDataType = undefined;
                                portDataTypeToken = undefined;
                            }
                            else {
                                endToken = prevToken;
                            }
                        }
                        else if (scope == "keyword.struct_union.systemverilog") {
                            portDataType = this._processStructUnionDeclaration();
                        }
                        else if (scope == "keyword.enum.systemverilog") {
                            portDataType = this._processEnumDeclaration();
                        }
                        else if (scope.startsWith("identifier.") && (this._svtokens[this._currTokenNum].text == "type")) {
                            portDataType = this._processTypeReference();
                        }
                    }
                }
                else {
                    startToken = this._currTokenNum;
                }

                if (scope.startsWith("identifier.")) {
                    portDataTypeToken = prevIdToken;
                    prevIdToken = this._currTokenNum;
                }
                prevToken = this._currTokenNum;
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
        }

        if (genericPortSymbol) {
            genericPortSymbol.defLocations = this._getDefLocations(startToken, prevToken);
        }
    }

    private _processParameterPortList() {
        this._processGenericPortList(["parameter.list.systemverilog", "parameter.expression.systemverilog"], "parameter-port");
    }

    private _processPortList() {
        this._processGenericPortList(["port.list.systemverilog", "port.expression.systemverilog"], "port");
    }

    private _processContainerHeader(): Boolean {
        //TBD Anonymous program?
        let containerSymbol: SystemVerilogSymbol;
        let containerTypeToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[this._currTokenNum].scopes.length - 1;
        if (this._svtokens[containerTypeToken].scopes[scopeDepth] != "keyword.container.systemverilog") {
            return false;
        }

        this._printDebugInfo("container header");
        this._currTokenNum++;
        let paramPortListProcessed: boolean = false;
        let portListProcessed: boolean = false;
        let prevToken: number;
        for (; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            if (this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth) != "container.header.systemverilog") {
                this._currTokenNum--;
                break;
            }

            let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth + 1);
            if (containerSymbol) {
                if ((scope == "keyword.import.systemverilog") && !paramPortListProcessed && !portListProcessed) {
                    this._processImportExport();
                }
                else if (scope == "operator.hash_open_parantheses.systemverilog" && !paramPortListProcessed && !portListProcessed) {
                    this._processParameterPortList();
                    paramPortListProcessed = true;
                }
                else if (scope == "operator.open_parantheses.systemverilog" && !portListProcessed) {
                    this._processPortList();
                    portListProcessed = true;
                }
            }
            else {
                if ((scope == "identifier.simple.systemverilog") || (scope == "identifier.escaped.systemverilog")) {
                    if ((this._svtokens[this._currTokenNum].text != "static") && (this._svtokens[this._currTokenNum].text != "automatic")) {
                        containerSymbol = this._pushContainerSymbol(this._currTokenNum, [this._svtokens[containerTypeToken].text]);
                    }
                }
            }

            if (this._notIgnorableScope()) {
                prevToken = this._currTokenNum;
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
        }

        if (containerSymbol) {
            containerSymbol.defLocations = this._getDefLocations(containerTypeToken, prevToken);
        }

        return true;
    }

    private _processPackageHeader(): Boolean {
        let packageSymbol: SystemVerilogSymbol;
        let packageKeywordToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[packageKeywordToken].scopes.length - 1;
        if (this._svtokens[packageKeywordToken].scopes[scopeDepth] != "keyword.package.systemverilog") {
            return false;
        }

        this._printDebugInfo("package header");
        this._currTokenNum++;
        let prevToken: number;
        for (; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            if (this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth) != "package.header.systemverilog") {
                this._currTokenNum--;
                break;
            }

            let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth + 1);
            if (((scope == "identifier.simple.systemverilog") || (scope == "identifier.escaped.systemverilog")) &&
                     (this._svtokens[this._currTokenNum].text != "static") && (this._svtokens[this._currTokenNum].text != "automatic")) {
                packageSymbol = this._pushContainerSymbol(this._currTokenNum, [this._svtokens[packageKeywordToken].text]);
            }

            if (this._notIgnorableScope()) {
                prevToken = this._currTokenNum;
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
        }

        if (packageSymbol) {
            packageSymbol.defLocations = this._getDefLocations(packageKeywordToken, prevToken);
        }

        return true;
    }

    private _processRoutineHeader() {
        let routineSymbol: SystemVerilogSymbol;
        let routineTypeToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[this._currTokenNum].scopes.length - 1;
        this._currTokenNum++;
        let portListProcessed: boolean = false;
        let prevIdToken: number;
        let prevToken: number;
        for (; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            if (this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth) != "routine.header.systemverilog") {
                this._currTokenNum--;
                break;
            }

            if (portListProcessed) {
                continue;
            }

            let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth + 1);
            if ((scope == "operator.open_parantheses.systemverilog") || (scope == "operator.semicolon.systemverilog")) {
                routineSymbol = this._pushContainerSymbol(prevIdToken, [this._svtokens[routineTypeToken].text]);

                if (scope == "operator.open_parantheses.systemverilog") {
                    this._processPortList();
                    portListProcessed = true;
                }
            }
            else if ((scope == "identifier.simple.systemverilog") || (scope == "identifier.escaped.systemverilog")) {
                prevIdToken = this._currTokenNum;
            }

            if (this._notIgnorableScope()) {
                prevToken = this._currTokenNum;
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
        }

        if (routineSymbol) {
            routineSymbol.defLocations = this._getDefLocations(routineTypeToken, prevToken);
        }
    }

    private _processEndIdentifier(): Boolean {
        let _currTokenNum: number = this._currTokenNum;
        this._currTokenNum--;
        let nextToken: number = this._nextNonIgnorableScope();
        let scopeDepth: number = (nextToken != undefined) ? this._svtokens[nextToken].scopes.length - 1 : 0;
        if ((nextToken != undefined) && (this._svtokens[nextToken].scopes[scopeDepth] == "operator.ternary.systemverilog") && (this._svtokens[nextToken].text == ":")) {
            nextToken = this._nextNonIgnorableScope();
            if ((nextToken == undefined) ||
                ((this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth) != "identifier.simple.systemverilog") &&
                 (this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth) != "identifier.escaped.systemverilog"))) {
                this._currTokenNum = _currTokenNum;
                return false;
            }
            return true;
        }
        else {
            this._currTokenNum = _currTokenNum;
            return false;
        }
    }

    private _processStartIdentifier(): Boolean {
        let _currTokenNum: number = this._currTokenNum;
        this._currTokenNum--;
        let startToken: number = this._nextNonIgnorableScope();
        if (startToken == undefined) {
            this._currTokenNum = _currTokenNum;
            return false;
        }

        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;
        if ((this._svtokens[startToken].scopes[scopeDepth] != "identifier.simple.systemverilog") &&
            (this._svtokens[startToken].scopes[scopeDepth] != "identifier.escaped.systemverilog")) {
            this._currTokenNum = _currTokenNum;
            return false;
        }

        let nextToken: number = this._nextNonIgnorableScope();
        if ((nextToken == undefined) || (this._getElem(this._svtokens[nextToken].scopes, scopeDepth) != "operator.ternary.systemverilog") || (this._svtokens[nextToken].text != ":")) {
            this._currTokenNum = _currTokenNum;
            return false;
        }

        nextToken = this._nextNonIgnorableScope();
        if (nextToken == undefined) {
            this._currTokenNum = _currTokenNum;
            return false;
        }

        return true;
    }

    private _processRoutine(): Boolean {
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;
        if (this._svtokens[startToken].scopes[scopeDepth] != "keyword.routine.systemverilog") {
            return false;
        }

        this._printDebugInfo("routine");
        this._processRoutineHeader();
        for(; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            let scope:string = this._getElem(this._svtokens[this._currTokenNum].scopes);
            if ((scope == "identifier.simple.systemverilog") &&
                ((this._svtokens[this._currTokenNum].text == "endfunction") || (this._svtokens[this._currTokenNum].text == "endtask"))) {
                this._containerStack.pop();
                break;
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
        }
        else {
            this._processEndIdentifier();
        }

        return true;
    }

    private _processParamDeclaration(): Boolean {
        let parameterTypeToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[parameterTypeToken].scopes.length - 1;
        if (this._svtokens[parameterTypeToken].scopes[scopeDepth] != "keyword.parameter.systemverilog") {
            return false;
        }

        this._printDebugInfo("param declaration");
        this._currTokenNum++;
        let parameterSymbol: SystemVerilogSymbol;
        let prevIdToken: number;
        let prevToken: number;
        let paramDataType: string;
        let paramDataTypeToken: number;
        for (; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            if ((this._svtokens[this._currTokenNum].scopes.length <= scopeDepth) ||
                ((this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth) != "parameter.declaration.systemverilog") &&
                 (this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth) != "parameter.expression.systemverilog"))) {
                this._currTokenNum--;
                break;
            }

            let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth + 1);
            if (this._notIgnorableScope()) {
                if (!parameterSymbol) {
                    if ((scope == "operator.equals.systemverilog") ||
                        (scope == "operator.semicolon.systemverilog")) {
                        let types: string[] = [this._svtokens[parameterTypeToken].text].concat(paramDataType || (paramDataTypeToken == undefined ? [] : this._svtokens[paramDataTypeToken].text));
                        parameterSymbol = this._pushSymbol(prevIdToken, types);
                    }
                    else if (scope == "keyword.struct_union.systemverilog") {
                        paramDataType = this._processStructUnionDeclaration();
                    }
                    else if (scope == "keyword.enum.systemverilog") {
                        paramDataType = this._processEnumDeclaration();
                    }
                    else if (scope.startsWith("identifier.") && (this._svtokens[this._currTokenNum].text == "type")) {
                        paramDataType = this._processTypeReference();
                    }
                    else if (scope.startsWith("identifier.")) {
                        paramDataTypeToken = prevIdToken;
                        prevIdToken = this._currTokenNum;
                    }
                }

                prevToken = this._currTokenNum;
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
        }

        if (parameterSymbol) {
            parameterSymbol.defLocations = this._getDefLocations(parameterTypeToken, prevToken);
        }

        return true;
    }

    private _processModPortDeclaration(): Boolean {
        let modportKeywordToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[modportKeywordToken].scopes.length - 1;
        if (this._svtokens[modportKeywordToken].scopes[scopeDepth] != "keyword.modport.systemverilog") {
            return false;
        }

        this._printDebugInfo("modport declaration");
        this._currTokenNum++;
        let modportToken: number;
        let modportSymbol: SystemVerilogSymbol;
        for (; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            if (this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth) != "modport.declaration.systemverilog") {
                this._currTokenNum--;
                break;
            }

            let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth + 1);
            if (this._notIgnorableScope()) {
                if ((scope == "operator.semicolon.systemverilog")) {
                    break;
                }
                else {
                    if (modportToken != undefined) {
                        if (scope == "operator.open_parantheses.systemverilog") {
                            this._processPortList(); //TBD handle import_export functions
                            this._containerStack.pop();
                            modportSymbol.defLocations = this._getDefLocations(modportToken, this._currTokenNum),
                            modportToken = undefined;
                        }
                    }
                    else {
                        if ((scope == "identifier.simple.systemverilog") || (scope == "identifier.escaped.systemverilog")) {
                            modportToken = this._currTokenNum;
                            modportSymbol = this._pushContainerSymbol(modportToken, [this._svtokens[modportKeywordToken].text]);
                        }
                    }
                }
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
        }

        if (modportToken != undefined) {
            this._containerStack.pop();
            modportSymbol.defLocations = this._getDefLocations(modportToken, this._currTokenNum);
        }

        return true;
    }

    private _processStructUnionMemberList() {
        let scopeDepth: number = this._svtokens[this._currTokenNum].scopes.length - 1 - 1;
        this._currTokenNum++;
        let startToken: number;
        let memberToken: number;
        let prevIdToken: number;
        let prevToken: number;
        let memberSymbol: SystemVerilogSymbol;
        for(; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            if ((this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth) != "struct_union_member_list.body.systemverilog") &&
                (this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth) != "struct_union_member.expression.systemverilog")) {
                this._currTokenNum--;
                break;
            }

            let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth + 1);
            if (this._notIgnorableScope()) {
                if (startToken == undefined) {
                    startToken = this._currTokenNum;

                    if (scope == "keyword.struct_union.systemverilog") {
                        let anonTypeName: string = this._processStructUnionDeclaration();
                        continue;
                    }
                    else if (scope == "keyword.enum.systemverilog") {
                        let anonTypeName: string = this._processEnumDeclaration();
                        continue;
                    }
                }

                if (scope == "operator.equals.systemverilog") {
                    memberSymbol = this._pushSymbol(prevIdToken, ["struct_union_member"]);
                    memberToken = prevIdToken;
                }
                else if (scope == "operator.semicolon.systemverilog") {
                    if (memberToken != undefined) {
                        memberSymbol.defLocations = this._getDefLocations(startToken, prevToken);
                        memberToken = undefined;
                    }
                    else {
                        memberSymbol = this._pushSymbol(prevIdToken, ["struct_union_member"], [startToken, prevToken]);
                    }
                    startToken = undefined;
                }
                else if ((scope == "identifier.simple.systemverilog") || (scope == "identifier.escaped.systemverilog")) {
                    prevIdToken = this._currTokenNum;
                }

                prevToken = this._currTokenNum;
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
        }

        if (memberToken != undefined) {
            memberSymbol.defLocations = this._getDefLocations(startToken, prevToken);
        }
    }

    private _processStructUnionDeclaration(): string {
        let structUnionTypeToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[structUnionTypeToken].scopes.length - 1;
        this._currTokenNum++;

        let structUnionName: string = `#AnonymousStructUnion${this._anonStructUnionCount}`
        let structSymbol: SystemVerilogSymbol = this._pushContainerSymbol(structUnionTypeToken, [this._svtokens[structUnionTypeToken].text], undefined, structUnionName);
        this._anonStructUnionCount++;

        for(; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            if (this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth) != "struct_union.declaration.systemverilog") {
                this._currTokenNum--;
                break;
            }

            let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth + 1);
            if (this._notIgnorableScope()) {
                if (scope == "struct_union_member_list.begin.systemverilog") {
                    this._processStructUnionMemberList();
                }
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
        }

        this._containerStack.pop();
        structSymbol.defLocations = this._getDefLocations(structUnionTypeToken, this._currTokenNum);

        return structUnionName;
    }

    private _processEnumList(enumName: string) {
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1 - 1;
        this._currTokenNum++;
        let memberToken: number;
        let prevToken: number;
        let memberSymbol: SystemVerilogSymbol;
        for(; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            if ((this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth) != "enum_list.body.systemverilog") &&
                (this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth) != "enum.expression.systemverilog")) {
                this._currTokenNum--;
                break;
            }

            let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth + 1);
            if (this._notIgnorableScope()) {
                if ((scope == "identifier.simple.systemverilog") || (scope == "identifier.escaped.systemverilog")) {
                    if (memberToken == undefined) {
                        memberToken = this._currTokenNum;
                        memberSymbol = this._pushSymbol(memberToken, ["enum_member", enumName]);
                    }
                }
                else if ((scope == "operator.comma.systemverilog") ||
                         (scope == "enum_list.end.systemverilog")) {
                    if (memberToken != undefined) {
                        memberSymbol.defLocations = this._getDefLocations(memberToken, prevToken),
                        memberToken = undefined;
                    }
                }

                prevToken = this._currTokenNum;
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
        }

        if (memberToken != undefined) {
            memberSymbol.defLocations = this._getDefLocations(memberToken, prevToken);
        }
    }

    private _processEnumDeclaration(): string {
        let enumKeywordToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[enumKeywordToken].scopes.length - 1;
        this._currTokenNum++;

        let enumName: string = `#AnonymousEnum${this._anonEnumCount}`
        this._anonEnumCount++;

        for(; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            if (this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth) != "enum.declaration.systemverilog") {
                this._currTokenNum--;
                break;
            }

            let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth + 1);
            if (this._notIgnorableScope()) {
                if (scope == "enum_list.begin.systemverilog") {
                    this._processEnumList(enumName);
                }
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
        }

        return enumName;
    }

    private _processTypeDef(): Boolean {
        let typedefKeywordToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[typedefKeywordToken].scopes.length - 1;
        if (this._svtokens[typedefKeywordToken].scopes[scopeDepth] != "keyword.typedef.systemverilog") {
            return false;
        }

        this._printDebugInfo("typedef");
        this._currTokenNum++;
        let prevIdToken: number;
        let prevToken: number;
        let typedefSymbol: SystemVerilogSymbol;
        let anonTypeName: string;
        let typeToken: number;
        for (; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            if (this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth) != "typedef.declaration.systemverilog") {
                this._currTokenNum--;
                break;
            }

            let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth + 1);
            if (this._notIgnorableScope()) {
                if (scope == "operator.semicolon.systemverilog") {
                    typedefSymbol = this._pushSymbol(prevIdToken, [this._svtokens[typedefKeywordToken].text].concat([anonTypeName || (typeToken == undefined ? "#Unknown" : this._svtokens[typeToken].text)]));
                }
                else if (scope == "keyword.struct_union.systemverilog") {
                    anonTypeName = this._processStructUnionDeclaration();
                }
                else if (scope == "keyword.enum.systemverilog") {
                    anonTypeName = this._processEnumDeclaration();
                }
                else if (scope.startsWith("identifier.") && (this._svtokens[this._currTokenNum].text == "type")) {
                    anonTypeName = this._processTypeReference();
                }
                else if (scope.startsWith("identifier.")) {
                    typeToken = prevIdToken;
                    prevIdToken = this._currTokenNum;
                }

                prevToken = this._currTokenNum;
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
        }

        if (typedefSymbol) {
            typedefSymbol.defLocations = this._getDefLocations(typedefKeywordToken, prevToken);
        }

        return true;
    }

    private _ignoreBlockStatement(validScopes: string[]) {
        let scopeDepth: number = this._svtokens[this._currTokenNum].scopes.length - 1;
        this._currTokenNum++;
        for (; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            //ConnectionLogger.log(`DEBUG: HERE with scopeDepth=${scopeDepth} with validScopes=[${validScopes.join(',')}] and for token "${this._svtokens[this._currTokenNum].text}" and scopes [${this._svtokens[this._currTokenNum].scopes.join(', ')}]`);
            if (validScopes.indexOf(this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth)) < 0) {
                this._currTokenNum--;
                break;
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
        }
    }

    private _ignoreParanthesizedExpression() {
        let scopeDepth: number = this._svtokens[this._currTokenNum].scopes.length - 1;
        this._currTokenNum++;
        for (; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth);
            if (scope == "parantheses.begin.systemverilog") {
                break;
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
            return;
        }

        this._currTokenNum++;
        for (; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth);
            if (scope != "parantheses.block.systemverilog") {
                this._currTokenNum--;
                break;
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
        }
    }

    private _ignoreTillSemiColon() {
        let scopeDepth: number = this._svtokens[this._currTokenNum].scopes.length - 1;
        this._currTokenNum++;
        for (; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth);
            if (scope == "operator.semicolon.systemverilog") {
                break;
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
        }
    }

    private _ignoreTillColon() {
        let scopeDepth: number = this._svtokens[this._currTokenNum].scopes.length - 1;
        this._currTokenNum++;
        for (; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth);
            if ((scope == "operator.ternary.systemverilog") && (this._svtokens[this._currTokenNum].text == ":")) {
                break;
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
        }
    }

    private _ignoreActionBlock() {
        let _currTokenNum: number = this._currTokenNum;
        let nextToken: number = this._nextNonIgnorableScope(); 
        if ((nextToken != undefined) && (this._getElem(this._svtokens[nextToken].scopes) == "identifier.simple.systemverilog") && (this._svtokens[nextToken].text == "else")) {
            this._ignoreStatement();
        }
        else {
            this._currTokenNum = _currTokenNum;
            this._ignoreStatement();
            
            _currTokenNum = this._currTokenNum;
            nextToken = this._nextNonIgnorableScope();
            if ((nextToken != undefined) && (this._getElem(this._svtokens[nextToken].scopes) == "identifier.simple.systemverilog") && (this._svtokens[nextToken].text == "else")) {
                this._ignoreStatement();
            }
            else {
                this._currTokenNum = _currTokenNum;
            }
        }
    }

    private _ignoreStatement() {
        this._currTokenNum++;
        this._processStartIdentifier();
        for (; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes);
            let tokenText: string = this._svtokens[this._currTokenNum].text;

            if (this._notIgnorableScope()) {
                if (scope == "keyword.case.systemverilog") {
                    this._ignoreBlockStatement(["case.body.systemverilog"]);
                    break;
                }
                else if ((scope == "identifier.simple.systemverilog") && (tokenText == "if")) {
                    this._ignoreParanthesizedExpression();
                    this._ignoreStatement();
                    let _currTokenNum: number = this._currTokenNum;
                    let nextToken: number = this._nextNonIgnorableScope();
                    if ((nextToken != undefined) && (this._getElem(this._svtokens[nextToken].scopes) == "identifier.simple.systemverilog") && (this._svtokens[nextToken].text == "else")) {
                        this._currTokenNum++;
                        this._ignoreStatement();
                    }
                    else {
                        this._currTokenNum = _currTokenNum;
                    }
                    break;
                }
                else if (scope == "keyword.disable.systemverilog") {
                    this._ignoreTillSemiColon();
                    break;
                }
                else if (scope == "operator.trigger.systemverilog") {
                    this._ignoreTillSemiColon();
                    break;
                }
                else if ((scope == "identifier.simple.systemverilog") && (tokenText == "forever")) {
                    this._ignoreStatement();
                    break;
                }
                else if ((scope == "identifier.simple.systemverilog") && (tokenText == "repeat")) {
                    this._ignoreParanthesizedExpression();
                    this._ignoreStatement();
                    break;
                }
                else if ((scope == "identifier.simple.systemverilog") && (tokenText == "while")) {
                    this._ignoreParanthesizedExpression();
                    this._ignoreStatement();
                    break;
                }
                else if ((scope == "identifier.simple.systemverilog") && (tokenText == "for")) {
                    this._ignoreParanthesizedExpression();
                    this._ignoreStatement();
                    break;
                }
                else if ((scope == "identifier.simple.systemverilog") && (tokenText == "do")) {
                    this._ignoreStatement();
                    this._ignoreStatement();
                    break;
                }
                else if ((scope == "identifier.simple.systemverilog") && (tokenText == "foreach")) {
                    this._ignoreParanthesizedExpression();
                    this._ignoreStatement();
                    break;
                }
                else if ((scope == "identifier.simple.systemverilog") &&
                         ((tokenText == "return") || (tokenText == "break") || (tokenText == "continue"))) {
                    this._ignoreTillSemiColon();
                    break;
                }
                else if (scope == "keyword.fork.systemverilog") {
                    this._ignoreBlockStatement(["fork.body.systemverilog"]);
                    break;
                }
                else if (scope == "keyword.begin.systemverilog") {
                    this._ignoreBlockStatement(["begin.block.systemverilog"]);
                    break;
                }
                else if ((scope == "identifier.simple.systemverilog") && (tokenText == "wait")) {
                    this._ignoreParanthesizedExpression();
                    this._ignoreStatement();
                    break;
                }
                else if ((scope == "identifier.simple.systemverilog") && (tokenText == "wait_order")) {
                    this._ignoreParanthesizedExpression();
                    this._ignoreActionBlock();
                    break;
                }
                else if ((scope == "identifier.simple.systemverilog") && (tokenText == "assert")) {
                    this._ignoreParanthesizedExpression();
                    this._ignoreActionBlock();
                    break;
                }
                else if ((scope == "identifier.simple.systemverilog") && (tokenText == "assume")) {
                    this._ignoreParanthesizedExpression();
                    this._ignoreActionBlock();
                    break;
                }
                else if ((scope == "identifier.simple.systemverilog") && (tokenText == "cover")) {
                    this._ignoreParanthesizedExpression();
                    this._ignoreActionBlock();
                    break;
                }
                else if ((scope == "identifier.simple.systemverilog") && (tokenText == "restrict")) {
                    this._ignoreParanthesizedExpression();
                    this._ignoreTillSemiColon();
                    break;
                }
                else if (scope == "keyword.randsequence.systemverilog") {
                    this._ignoreBlockStatement(["randsequence.body.systemverilog"]);
                    break;
                }
                else if ((scope == "identifier.simple.systemverilog") && (tokenText == "expect")) {
                    this._ignoreParanthesizedExpression();
                    this._ignoreActionBlock();
                    break;
                }
                else if (scope == "operator.semicolon.systemverilog") {
                    break;
                }
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
        }
    }

    private _processPreprocessor(): Boolean {
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;
        if ((this._svtokens[startToken].scopes[scopeDepth] != "macro.call.systemverilog") &&
            (this._svtokens[startToken].scopes[scopeDepth] != "macro.identifier.systemverilog")) {
            return false;
        }

        this._printDebugInfo("preprocessor");
        if (this._svtokens[startToken].scopes[scopeDepth] == "macro.identifier.systemverilog") {
            if (this._svtokens[startToken].text == "`include") {
                //TBD store include file
                let nextToken: number = this._nextNonIgnorableScope();
                if (nextToken != undefined) {
                    if (this._getElem(this._svtokens[nextToken].scopes, scopeDepth) == "operator.comparison.systemverilog") {
                        nextToken = this._nextNonIgnorableScope();
                        if (nextToken != undefined) {
                            this._nextNonIgnorableScope();
                        }
                    }
                }
            }
            else if ((this._svtokens[startToken].text == "`define") || (this._svtokens[startToken].text == "`pragma")) {
                // treating `pragma as single lined statements (otherwise ambiguous processing)
                //skip till end of line without "\"
                this._currTokenNum++;
                for (; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
                    let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth);
                    if ((scope == "meta.whitespace.systemverilog") && (/\n|\r/.exec(this._svtokens[this._currTokenNum].text))) {
                        break;
                    }
                    else if (scope == "operator.backslash.systemverilog") {
                        this._currTokenNum++;
                        if ((this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth) == "meta.whitespace.systemverilog") &&
                            ((this._svtokens[this._currTokenNum].text.startsWith("\n")) ||
                             (this._svtokens[this._currTokenNum].text.startsWith("\r")))) {
                            break;
                        }
                        else {
                            this._currTokenNum--;
                        }
                    }
                }
                if (this._currTokenNum == this._svtokens.length) {
                    this._currTokenNum--;
                }
            }
            else if (["`undef", "`ifdef", "`elsif", "`ifndef", "`default_nettype", "`unconnected_drive", "`begin_keywords"].indexOf(this._svtokens[startToken].text) >= 0) {
                this._nextNonIgnorableScope();
            }
            else if (this._svtokens[startToken].text == "`timescale") {
                this._currTokenNum++;
                let timePrecisionStart: Boolean = false;
                for (; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
                    let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth);
                    if (this._notIgnorableScope()) {
                        if (timePrecisionStart) {
                            if (scope == "identifier.simple.systemverilog") {
                                break;
                            }
                            else if (scope == "literal.time.systemverilog") {
                                break;
                            }
                        }
                        else {
                            if (scope == "operator.arithmetic.systemverilog") {
                                timePrecisionStart = true;
                            }
                        }
                    }
                }
                if (this._currTokenNum == this._svtokens.length) {
                    this._currTokenNum--;
                }
            }
            else if (this._svtokens[startToken].text == "`line") {
                for (let i = 0; i < 3; i++) {
                    let nextToken: number = this._nextNonIgnorableScope();
                    if (nextToken == undefined) {
                        break;
                    }
                }
            }
            // ignore `undefineall, `else, `endif, `nounconnected_drive, `celldefine, `endcelldefine, `__FILE__, `__LINE__, `end_keywords and user macros
        }

        return true;
    }

    private _processAttributeInstance(): Boolean {
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;
        if (this._svtokens[startToken].scopes[scopeDepth] != "attribute.begin.systemverilog") {
            return false;
        }

        this._printDebugInfo("attribute instance");
        this._currTokenNum++;
        for (; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            if ((this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth) != "attribute.inst.systemverilog") &&
                (this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth) != "attribute.expression.systemverilog")) {
                this._currTokenNum--;
                break;
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
        }

        return true;
    }

    private _processSimpleKeywords(): Boolean {
        let keywordToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[keywordToken].scopes.length - 1;
        if ((this._svtokens[keywordToken].scopes[scopeDepth] != "identifier.simple.systemverilog") ||
            (["endinterface", "endmodule", "endpackage", "endprogram"].indexOf(this._svtokens[keywordToken].text) < 0)) {
            return false;
        }

        this._printDebugInfo("simple keywords");
        if (["endinterface", "endmodule", "endpackage", "endprogram"].indexOf(this._svtokens[keywordToken].text) >= 0) {
            this._currTokenNum++;
            this._processEndIdentifier();
            this._containerStack.pop();
        }

        return true;
    }

    private _processPortDeclaration(): Boolean {
        let portTypeToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[portTypeToken].scopes.length - 1;
        if (this._svtokens[portTypeToken].scopes[scopeDepth] != "keyword.port_direction.systemverilog") {
            return false;
        }

        this._printDebugInfo("port declaration");
        this._currTokenNum++;
        let prevIdToken: number;
        let startToken: number;
        let prevToken: number;
        let portDataType: string;
        let portDataTypeToken: number;
        let portSymbol: SystemVerilogSymbol;
        let assignExprOn: Boolean = false;
        for (; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            if ((this._svtokens[this._currTokenNum].scopes.length <= scopeDepth) || 
                (!assignExprOn && (this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth) != "port_declaration.list.systemverilog")) ||
                (assignExprOn && (this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth) != "port_declaration.expression.systemverilog"))) {
                this._currTokenNum--;
                break;
            }

            let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth + 1);
            if (this._notIgnorableScope()) {
                //TBD: process port list
                if ((scope == "operator.comma.systemverilog") ||
                    (scope == "operator.semicolon.systemverilog")) {
                    if (assignExprOn) {
                        portSymbol.defLocations = this._getDefLocations(startToken, prevToken);
                        portSymbol = undefined;
                        assignExprOn = false;
                    }
                    else {
                        let types: string[] = ["port"].concat(portDataType || (portDataTypeToken == undefined ? [] : this._svtokens[portDataTypeToken].text));
                        this._pushSymbol(prevIdToken, types, [startToken, prevToken]);
                    }
                    startToken = undefined;
                }
                else if (scope == "operator.equals.systemverilog") {
                    let types: string[] = ["port"].concat(portDataType || (portDataTypeToken == undefined ? [] : this._svtokens[portDataTypeToken].text));
                    portSymbol = this._pushSymbol(prevIdToken, types);
                    assignExprOn = true;
                }
                else if (scope == "keyword.struct_union.systemverilog") {
                    portDataType = this._processStructUnionDeclaration();
                }
                else if (scope == "keyword.enum.systemverilog") {
                    portDataType = this._processEnumDeclaration();
                }
                else if (scope.startsWith("identifier.") && (this._svtokens[this._currTokenNum].text == "type")) {
                    portDataType = this._processTypeReference();
                }
                else if (scope.startsWith("identifier.")) {
                    portDataTypeToken = prevIdToken;
                    prevIdToken = this._currTokenNum;
                }
                prevToken = this._currTokenNum;
                if (startToken == undefined) {
                    startToken = this._currTokenNum;
                }
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
        }

        if (portSymbol) {
            portSymbol.defLocations = this._getDefLocations(portTypeToken, prevToken);
        }

        return true;
    }

    private _processParameterOverride(): Boolean {
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;
        if (this._svtokens[startToken].scopes[scopeDepth] != "keyword.defparam.systemverilog") {
            return false;
        }

        this._printDebugInfo("parameter override");
        this._ignoreBlockStatement(["defparam.statement.systemverilog"]);
        return true;
    }

    private _processCheckerDeclaration(): Boolean {
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;
        if (this._svtokens[startToken].scopes[scopeDepth] != "keyword.checker.systemverilog") {
            return false;
        }

        this._printDebugInfo("checker declaration");
        this._ignoreBlockStatement(["checker.declaration.systemverilog"]);
        this._processEndIdentifier();
        return true;
    }

    private _processImportExport(): Boolean {
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;
        if ((this._svtokens[startToken].scopes[scopeDepth] != "keyword.import.systemverilog") &&
            (this._svtokens[startToken].scopes[scopeDepth] != "keyword.export.systemverilog")) {
            return false;
        }

        this._printDebugInfo("import export");
        this._currTokenNum++;
        for (; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth + 1);
            if (scope == "identifier.scoped.systemverilog") {
                if (this._svtokens[startToken].scopes[scopeDepth] == "keyword.export.systemverilog") {
                    this._containerStack.pushExportItem(this._svtokens[this._currTokenNum]);
                }
                else {
                    this._containerStack.pushImportItem(this._svtokens[this._currTokenNum]);
                }
            }
            else if (scope == "operator.semicolon.systemverilog") {
                break;
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
        }

        return true;
    }

    private _processExternConstraintDeclaration(): Boolean {
        let _currTokenNum: number = this._currTokenNum;
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;

        if ((this._svtokens[startToken].scopes[scopeDepth] == "identifier.simple.systemverilog") && (this._svtokens[startToken].text == "static")) {
            let nextToken: number = this._nextNonIgnorableScope();
            if (nextToken != undefined) {
                startToken = nextToken;
                scopeDepth = this._svtokens[startToken].scopes.length - 1;
            }
            else {
                this._currTokenNum = _currTokenNum;
                return false;
            }
        }

        if (this._svtokens[startToken].scopes[scopeDepth] != "keyword.constraint.systemverilog") {
            this._currTokenNum = _currTokenNum;
            return false;
        }

        this._printDebugInfo("constraint declaration");
        this._ignoreBlockStatement(["constraint.declaration.systemverilog", "constraint.body.systemverilog"]);
        this._processEndIdentifier();
        return true;
    }

    private _processClassDeclaration() {
        let _currTokenNum: number = this._currTokenNum;
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;

        if ((this._svtokens[startToken].scopes[scopeDepth] == "identifier.simple.systemverilog") && (this._svtokens[startToken].text == "virtual")) {
            let nextToken: number = this._nextNonIgnorableScope();
            if (nextToken != undefined) {
                startToken = nextToken;
                scopeDepth = this._svtokens[startToken].scopes.length - 1;
            }
            else {
                this._currTokenNum = _currTokenNum;
                return false;
            }
        }

        if (this._svtokens[startToken].scopes[scopeDepth] != "keyword.class.systemverilog") {
            this._currTokenNum = _currTokenNum;
            return false;
        }

        this._printDebugInfo("class declaration");
        this._ignoreBlockStatement(["class.declaration.systemverilog"]);
        this._processEndIdentifier();
        return true;
    }

    private _processCoverGroupDeclaration(): Boolean {
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;
        if (this._svtokens[startToken].scopes[scopeDepth] != "keyword.covergroup.systemverilog") {
            return false;
        }

        this._printDebugInfo("covergroup declaration");
        this._ignoreBlockStatement(["covergroup.declaration.systemverilog"]);
        this._processEndIdentifier();
        return true;
    }

    private _processPropertyDeclaration(): Boolean {
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;
        if (this._svtokens[startToken].scopes[scopeDepth] != "keyword.property.systemverilog") {
            return false;
        }

        this._printDebugInfo("property declaration");
        this._ignoreBlockStatement(["property.declaration.systemverilog"]);
        this._processEndIdentifier();
        return true;
    }

    private _processSequenceDeclaration(): Boolean {
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;
        if (this._svtokens[startToken].scopes[scopeDepth] != "keyword.sequence.systemverilog") {
            return false;
        }

        this._printDebugInfo("sequence declaration");
        this._ignoreBlockStatement(["sequence.declaration.systemverilog"]);
        this._processEndIdentifier();
        return true;
    }

    private _processLetDeclaration(): Boolean {
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;
        if (this._svtokens[startToken].scopes[scopeDepth] != "keyword.let.systemverilog") {
            return false;
        }

        this._printDebugInfo("let declaration");
        this._ignoreBlockStatement(["let.statement.systemverilog"]);
        return true;
    }

    private _processClockingDeclaration(): Boolean {
        let _currTokenNum: number = this._currTokenNum;
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;

        if ((this._svtokens[startToken].scopes[scopeDepth] == "identifier.simple.systemverilog") &&
            ((this._svtokens[startToken].text == "default") || (this._svtokens[startToken].text == "global"))) {
            let nextToken: number = this._nextNonIgnorableScope();
            if (nextToken != undefined) {
                startToken = nextToken;
                scopeDepth = this._svtokens[startToken].scopes.length - 1;
            }
            else {
                this._currTokenNum = _currTokenNum;
                return false;
            }
        }

        if ((this._svtokens[startToken].scopes[scopeDepth] != "identifier.simple.systemverilog") || (this._svtokens[startToken].text != "clocking")) {
            this._currTokenNum = _currTokenNum;
            return false;
        }

        let nextToken: number = this._nextNonIgnorableScope();
        if (nextToken == undefined) {
            this._currTokenNum = _currTokenNum;
            return false;
        }
        else {
            startToken = nextToken;
            scopeDepth = this._svtokens[startToken].scopes.length - 1;
        }

        this._printDebugInfo("clocking declaration");
        let scope: string = this._getElem(this._svtokens[startToken].scopes, scopeDepth);
        if ((scope == "identifier.simple.systemverilog") || (scope == "identifier.escaped.systemverilog")) {
            nextToken = this._nextNonIgnorableScope();
            if (nextToken == undefined) {
                this._currTokenNum = _currTokenNum;
                return false;
            }
            else {
                startToken = nextToken;
                scopeDepth = this._svtokens[startToken].scopes.length - 1;
            }

            scope = this._getElem(this._svtokens[startToken].scopes, scopeDepth);
            if ((scope != "operator.other.systemverilog") || (this._svtokens[startToken].text != "@")) {
                this._currTokenNum--;
                this._ignoreTillSemiColon();
                return true;
            }
        }

        // clocking .. endclocking
        this._currTokenNum++;
        for (; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth);
            if ((scope == "identifier.simple.systemverilog") && (this._svtokens[this._currTokenNum].text == "endclocking")) {
                break;
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
        }

        this._processEndIdentifier();
        return true;
    }

    private _processDefaultDisableItem(): Boolean {
        let _currTokenNum: number = this._currTokenNum;
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;

        if ((this._svtokens[startToken].scopes[scopeDepth] != "identifier.simple.systemverilog") ||
            (this._svtokens[startToken].text != "default")) {
            return false;
        }
        else {
            let nextToken: number = this._nextNonIgnorableScope();
            if (nextToken != undefined) {
                startToken = nextToken;
                scopeDepth = this._svtokens[startToken].scopes.length - 1;
            }
            else {
                this._currTokenNum = _currTokenNum;
                return false;
            }
        }

        if ((this._svtokens[startToken].scopes[scopeDepth] != "identifier.simple.systemverilog") ||
            (this._svtokens[startToken].text != "disable")) {
            this._currTokenNum = _currTokenNum;
            return false;
        }

        this._printDebugInfo("default disable");
        this._ignoreTillSemiColon();
        return true;
    }

    private _processAssertionStatement(): Boolean {
        let _currTokenNum = this._currTokenNum;
        this._processStartIdentifier();

        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;
        let startTokenText = this._svtokens[startToken].text;
        if ((this._svtokens[startToken].scopes[scopeDepth] != "identifier.simple.systemverilog") ||
            ["assert", "assume", "cover", "restrict"].indexOf(startTokenText) < 0) {
            this._currTokenNum = _currTokenNum;
            return false;
        }

        this._printDebugInfo("assertion statement");
        this._ignoreParanthesizedExpression();

        if ((startTokenText == "assert") || (startTokenText == "assume")) {
            this._ignoreActionBlock();
        }
        else {
            this._ignoreStatement();
        }
        return true;
    }

    private _processBindDirective(): Boolean {
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;
        if ((this._svtokens[startToken].scopes[scopeDepth] != "identifier.simple.systemverilog") ||
            (this._svtokens[startToken].text != "bind")) {
            return false;
        }

        this._printDebugInfo("bind directive");
        this._ignoreTillSemiColon();
        return true;
    }

    private _processContinuousAssign(): Boolean {
        //TBD continuous assign lvalues extraction
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;
        if (this._svtokens[startToken].scopes[scopeDepth] != "keyword.assign.systemverilog") {
            return false;
        }

        this._printDebugInfo("continuous assignment");
        this._ignoreBlockStatement(["continuous.block.systemverilog", "continuous.expression.systemverilog"]);
        return true;
    }

    private _processAlias(): Boolean {
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;
        if ((this._svtokens[startToken].scopes[scopeDepth] != "identifier.simple.systemverilog") ||
            (this._svtokens[startToken].text != "alias")) {
            return false;
        }

        this._printDebugInfo("alias");
        this._ignoreTillSemiColon();
        return true;
    }

    private _processSequentialBlock(): Boolean {
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;
        if ((this._svtokens[startToken].scopes[scopeDepth] != "identifier.simple.systemverilog") ||
            (["always", "always_comb", "always_ff", "always_latch", "initial", "final"].indexOf(this._svtokens[startToken].text) < 0)) {
            return false;
        }

        this._printDebugInfo("sequential block");
        this._ignoreStatement();
        return true;
    }

    private _processGenerateBlock() {
        let _currTokenNum = this._currTokenNum;
        this._currTokenNum++;

        let startToken: number;
        if (this._processStartIdentifier()) {
            startToken = this._currTokenNum;
        }
        else {
            this._currTokenNum--;
            startToken = this._nextNonIgnorableScope();
            if (startToken == undefined) {
                return;
            }
        }

        let scopeDepth: number = this._svtokens[this._currTokenNum].scopes.length - 1;
        if (this._getElem(this._svtokens[startToken].scopes, scopeDepth) == "keyword.begin.systemverilog") {
            this._printDebugInfo("generate block");
            this._currTokenNum++;

            if (this._processEndIdentifier()) {
                this._currTokenNum++;
            }
            for (; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
                let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth + 1);
                if (this._notIgnorableScope()) {
                    if (scope == "keyword.end.systemverilog") {
                        this._currTokenNum++;
                        this._processEndIdentifier();
                        break;
                    }

                    if (this._processPreprocessor() ||
                        this._processAttributeInstance() ||
                        this._processGenerateItem() ||
                        this._processVarInstDeclaration()) {
                        continue;
                    }
                    //TBD Error on else?
                }
            }
            if (this._currTokenNum == this._svtokens.length) {
                this._currTokenNum--;
            }
        }
        else {
            this._printDebugInfo("generate statement");
            for (; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
                let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth);
                if (this._notIgnorableScope()) {
                    if (this._processPreprocessor() ||
                        this._processAttributeInstance()) {
                        continue;
                    }

                    if (this._processGenerateItem() ||
                        this._processVarInstDeclaration()) {
                    }
                    //TBD Error on else?
                    break;
                }
            }
            if (this._currTokenNum == this._svtokens.length) {
                this._currTokenNum--;
            }
        }
    }

    private _processLoopGenerateConstruct(): Boolean {
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;
        if ((this._svtokens[startToken].scopes[scopeDepth] != "identifier.simple.systemverilog") ||
            (this._svtokens[startToken].text != "for")) {
            return false;
        }
        this._printDebugInfo("for generate");

        this._ignoreParanthesizedExpression();
        this._processGenerateBlock();

        return true;
    }

    private _processIfGenerateConstruct(): Boolean {
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;
        if ((this._svtokens[startToken].scopes[scopeDepth] != "identifier.simple.systemverilog") ||
            (this._svtokens[startToken].text != "if")) {
            return false;
        }
        this._printDebugInfo("if generate");

        this._ignoreParanthesizedExpression();
        this._processGenerateBlock();

        let _currTokenNum = this._currTokenNum;
        let nextToken: number = this._nextNonIgnorableScope();
        if ((nextToken != undefined) && ((this._getElem(this._svtokens[nextToken].scopes, scopeDepth) == "identifier.simple.systemverilog") && (this._svtokens[nextToken].text == "else"))) {
            this._processGenerateBlock();
        }
        else {
            this._currTokenNum = _currTokenNum;
        }

        return true;
    }

    private _processCaseGenerateConstruct(): Boolean {
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;
        if (this._getElem(this._svtokens[startToken].scopes, scopeDepth) != "keyword.case.systemverilog") {
            return false;
        }

        this._printDebugInfo("case generate");
        this._currTokenNum++;
        for (; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth + 1);
            if (this._notIgnorableScope()) {
                if (scope == "keyword.endcase.systemverilog") {
                    break;
                }

                this._ignoreTillColon();
                this._processGenerateBlock();
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
        }

        return true;
    }

    private _processEmptyStatement(): Boolean {
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;
        if (this._svtokens[startToken].scopes[scopeDepth] != "operator.semicolon.systemverilog") {
            return false;
        }

        this._printDebugInfo("empty statement");
        this._currTokenNum++;
        return true;
    }

    private _processNonStandardBeginEndBlock(): Boolean {
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;
        if (this._svtokens[startToken].scopes[scopeDepth] != "keyword.begin.systemverilog") {
            return false;
        }

        this._printDebugInfo("non-standard begin-end block");
        this._currTokenNum++;

        if (this._processEndIdentifier()) {
            this._currTokenNum++;
        }
        for (; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth + 1);
            if (this._notIgnorableScope()) {
                if (scope == "keyword.end.systemverilog") {
                    this._currTokenNum++;
                    this._processEndIdentifier();
                    break;
                }

                if (this._processPreprocessor() ||
                    this._processAttributeInstance() ||
                    this._processGenerateItem() ||
                    this._processVarInstDeclaration()) {
                    continue;
                }
                //TBD Error on else?
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
        }

        return true;
    }

    private _processExternTFDeclaration(): Boolean {
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;
        if ((this._svtokens[startToken].scopes[scopeDepth] != "identifier.simple.systemverilog") ||
            (this._svtokens[startToken].text != "extern")) {
            return false;
        }

        this._printDebugInfo("extern tf declaration");
        let nextToken: number = this._nextNonIgnorableScope();
        while ((nextToken != undefined) && (this._getElem(this._svtokens[nextToken].scopes, scopeDepth) == "keyword.routine.systemverilog")) {
            nextToken = this._nextNonIgnorableScope();
        }

        if (nextToken != undefined) {
            this._ignoreBlockStatement(["routine.header.systemverilog"]);
        }

        return true;
    }

    private _printParsingFailedMessage() {
        let pos: Position = this._document.positionAt(this._svtokens[this._currTokenNum].startTokenIndex);
        ConnectionLogger.warn(`Parsing failed at token "${this._svtokens[this._currTokenNum].text}" (${pos.line}, ${pos.character}) with scopes [${this._svtokens[this._currTokenNum].scopes.join(",")}] in file ${this._documentPath}`);
    }

    private _processGenerateRegion(): Boolean {
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;
        if (this._svtokens[startToken].scopes[scopeDepth] != "keyword.generate.systemverilog") {
            return false;
        }
        this._printDebugInfo("generate region");

        this._currTokenNum++;
        for (; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth + 1);
            if (this._notIgnorableScope()) {
                if (this._svtokens[this._currTokenNum].scopes.length <= scopeDepth) {
                    break;
                }

                if (scope == "keyword.endgenerate.systemverilog") {
                    break;
                }

                if (this._processPreprocessor() ||
                    this._processAttributeInstance() ||
                    this._processGenerateItem() ||
                    this._processVarInstDeclaration()) {
                    continue;
                }
                else {
                    this._printParsingFailedMessage();
                }
            }
        }

        return true;
    }

    private _processElaborationSystemTask(): Boolean {
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;
        if ((this._svtokens[startToken].scopes[scopeDepth] != "system.identifier.systemverilog") &&
            (this._svtokens[startToken].scopes[scopeDepth] != "system.task.systemverilog")) {
            return false;
        }

        this._printDebugInfo("elab system task");
        this._ignoreTillSemiColon();
        return true;
    }

    private _isDriveStrength(): Boolean {
        let _startTokenNum = this._currTokenNum;
        let scopeDepth = this._svtokens[this._currTokenNum].scopes.length - 1;
        let nextToken: number = this._nextNonIgnorableScope();
        if ((nextToken == undefined) || (this._getElem(this._svtokens[nextToken].scopes, scopeDepth + 1) != "identifier.simple.systemverilog") ||
            (["supply0", "supply1", "strong0", "strong1", "pull0", "pull1", "weak0", "weak1", "highz0", "highz1"].indexOf(this._svtokens[nextToken].text) < 0)) {
            this._currTokenNum = _startTokenNum;
            return false;
        }

        nextToken = this._nextNonIgnorableScope();
        if ((nextToken == undefined) || (this._getElem(this._svtokens[nextToken].scopes, scopeDepth + 1) != "operator.comma.systemverilog")) {
            this._currTokenNum = _startTokenNum;
            return false;
        }

        nextToken = this._nextNonIgnorableScope();
        if ((nextToken == undefined) || (this._getElem(this._svtokens[nextToken].scopes, scopeDepth + 1) != "identifier.simple.systemverilog") ||
            (["supply0", "supply1", "strong0", "strong1", "pull0", "pull1", "weak0", "weak1", "highz0", "highz1"].indexOf(this._svtokens[nextToken].text) < 0)) {
            this._currTokenNum = _startTokenNum;
            return false;
        }

        nextToken = this._nextNonIgnorableScope();
        if ((nextToken == undefined) || (this._getElem(this._svtokens[nextToken].scopes, scopeDepth + 1) != "parantheses.end.systemverilog")) {
            this._currTokenNum = _startTokenNum;
            return false;
        }

        return true;
    }

    //TBD nettype

    private _isInstance(): [Boolean, string] {
        let _startTokenNum = this._currTokenNum;
        let scopeDepth = this._svtokens[this._currTokenNum].scopes.length - 1;

        // 1st token based decisions
        this._currTokenNum--;
        let startToken: number = this._nextNonIgnorableScope();
        if (startToken == undefined) {
            this._currTokenNum = _startTokenNum;
            return [undefined, undefined];
        }
        if (["supply0", "supply1", "tri", "triand", "trior", "trireg", "tri0", "tri1", "uwire", "wire", "wand", "wor",
             "interconnect", "const", "var", "static", "automatic", "rand", "genvar",
             "bit", "logic", "reg", "byte", "shortint", "int", "longint", "integer", "time",
             "shortreal", "real", "realtime", "struct", "union", "enum", "string", "chandle",
             "virtual", "interface", "event", "type"].indexOf(this._svtokens[startToken].text) >= 0) {
            this._currTokenNum = _startTokenNum;
            return [false, this._svtokens[startToken].text];
        }
        else if(["cmos", "rmos", "bufif0", "bufif1", "notif0", "notif1",
                 "nmos", "pmos", "rnmos", "rpmos", "and", "nand", "or", "nor", "xor", "xnor", "buf", "not",
                 "tranif0", "trainf1", "rtranif1", "rtranif0", "tran", "rtran", "pulldown", "pullup"].indexOf(this._svtokens[startToken].text) >= 0) {
            this._currTokenNum = _startTokenNum;
            return [true, this._svtokens[startToken].text];
        }

        let _currTokenNum: number = this._currTokenNum;
        let prevToken: number;
        for (; _currTokenNum < this._svtokens.length; _currTokenNum++) {
            let scope: string = this._getElem(this._svtokens[_currTokenNum].scopes, scopeDepth);
            if (this._notIgnorableScope()) {
                if ((prevToken != undefined) && (scope == "parantheses.begin.systemverilog") &&
                    ((this._getElem(this._svtokens[prevToken].scopes, scopeDepth) != "operator.other.systemverilog") ||
                     (this._svtokens[prevToken].text != "#"))) {
                    if (this._isDriveStrength()) {
                        this._currTokenNum = _startTokenNum;
                        return [true, this._svtokens[startToken].text];
                    }
                }
                else if ((scope == "operator.comma.systemverilog") || (scope == "operator.semicolon.systemverilog")) {
                    this._currTokenNum = _startTokenNum;
                    if ((prevToken != undefined) && this._getElem(this._svtokens[prevToken].scopes, scopeDepth) == "parantheses.block.systemverilog") {
                        return [true, this._svtokens[startToken].text];
                    }
                    else {
                        return [false, this._svtokens[startToken].text];
                    }
                }
                prevToken = _currTokenNum;
            }
        }

        this._currTokenNum == _startTokenNum;
        return [undefined, undefined];
    }

    private _processVarInstDeclaration() {
        let _currTokenNum = this._currTokenNum;
        let scopeDepth: number = this._svtokens[this._currTokenNum].scopes.length - 1;

        let [isInstance, type]: [Boolean, string] = this._isInstance();
        if (isInstance == undefined) {
            this._currTokenNum = _currTokenNum;
            return false;
        }

        this._printDebugInfo("var inst declaration");
        let symType: string = isInstance ? "instance" : "variable";
        let startToken: number;
        let prevToken: number;
        let prevIdToken: number;
        let anonTypeName: string;
        let dataTypeToken: number;
        let waitForEnd: Boolean = false;
        for (; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth);
            if (scope == undefined) {
                this._currTokenNum = _currTokenNum;
                return false;
            }

            if (this._notIgnorableScope()) {
                if (this._processPreprocessor() ||
                    this._processAttributeInstance()) {
                    continue;
                }

                if (startToken == undefined) {
                    startToken = this._currTokenNum;
                }

                if ((scope == "operator.comma.systemverilog") ||
                    (scope == "operator.semicolon.systemverilog")) {
                    if ((prevIdToken != undefined) && (startToken != undefined)) {
                        if (prevIdToken == startToken) {
                            //unnamed instantiation
                            return true;
                        }
                        else if (this._getElem(this._svtokens[prevToken].scopes, scopeDepth) == "parantheses.block.systemverilog") {
                            //TBD
                        }
                        else {
                            //TBD
                        }
                        let types: string[] = [symType, anonTypeName || (dataTypeToken == undefined ? this._svtokens[startToken].text : this._svtokens[dataTypeToken].text)];
                        this._pushSymbol(prevIdToken, types, [startToken, prevToken]); //TBD range
                    }
                    else {
                        this._currTokenNum = _currTokenNum;
                        return false;
                    }

                    prevToken = undefined;
                    if (scope == "operator.semicolon.systemverilog") {
                        break;
                    }
                }
                else if (!waitForEnd) {
                    if (scope == "operator.equals.systemverilog") {
                        waitForEnd = true;
                    }
                    else if (scope == "keyword.struct_union.systemverilog") {
                        anonTypeName = this._processStructUnionDeclaration();
                    }
                    else if (scope == "keyword.enum.systemverilog") {
                        anonTypeName = this._processEnumDeclaration();
                    }
                    else if (scope.startsWith("identifier.") && (this._svtokens[this._currTokenNum].text == "type")) {
                        anonTypeName = this._processTypeReference();
                    }
                    else if (scope.startsWith("identifier.")) {
                        dataTypeToken = prevIdToken;
                        prevIdToken = this._currTokenNum;
                    }

                    /*TBD if (!scope.startsWith("identifier.") &&
                        !scope.startsWith("literal.") &&
                        !scope.startsWith("operator.") &&
                        (scope != "keyword.struct_union.systemverilog") &&
                        (scope != "keyword.enum.systemverilog") &&
                        (scope != "dimension.expression.systemverilog") &&
                        (scope != "parantheses.begin.systemverilog") &&
                        (scope != "parantheses.block.systemverilog")) {
                        this._printDebugInfo(`${scope} error check`);
                        this._currTokenNum = _currTokenNum;
                        return false;
                    }*/
                }
                prevToken = this._currTokenNum;
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
        }

        return true;
    }

    private _processModuleCommonItem(): Boolean {
        if (this._processRoutine() ||
            this._processCheckerDeclaration() ||
            this._processImportExport() ||
            this._processExternConstraintDeclaration() ||
            this._processClassDeclaration() ||
            this._processParamDeclaration() ||
            this._processCoverGroupDeclaration() ||
            this._processPropertyDeclaration() ||
            this._processSequenceDeclaration() ||
            this._processLetDeclaration() ||
            this._processClockingDeclaration() ||
            this._processDefaultDisableItem() ||
            this._processAssertionStatement() ||
            this._processBindDirective() ||
            this._processContinuousAssign() ||
            this._processAlias() ||
            this._processSequentialBlock() ||
            this._processLoopGenerateConstruct() ||
            this._processIfGenerateConstruct() ||
            this._processCaseGenerateConstruct() ||
            this._processEmptyStatement() ||
            this._processNonStandardBeginEndBlock()
        ) {
            return true;
        }

        return false;
    }

    private _processGenerateItem(): Boolean {
        if (this._processParameterOverride() ||
            this._processModuleCommonItem() ||
            this._processExternTFDeclaration() ||
            this._processGenerateRegion() ||
            this._processElaborationSystemTask() ||
            this._processTypeDef()
        ) {
            return true;
        }

        return false;
    }

    private _processSpecifyBlock(): Boolean {
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;
        if (this._svtokens[startToken].scopes[scopeDepth] != "keyword.specify.systemverilog") {
            return false;
        }

        this._printDebugInfo("specify block");
        this._ignoreBlockStatement(["specify.declaration.systemverilog"]);
        return true;
    }

    private _processSpecparamDeclaration(): Boolean {
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;
        if (this._svtokens[startToken].scopes[scopeDepth] != "keyword.specparam.systemverilog") {
            return false;
        }

        this._printDebugInfo("specparam declaration");
        this._ignoreBlockStatement(["specparam.statement.systemverilog"]);
        return true;
    }

    private _processTimeunitsDeclaration(): Boolean {
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;
        if ((this._svtokens[startToken].scopes[scopeDepth] != "simple.identifier.systemverilog") ||
            ((this._svtokens[startToken].text != "timeunit") && (this._svtokens[startToken].text != "timeprecision"))) {
            return false;
        }

        this._printDebugInfo("timeunits declaration");
        this._ignoreTillSemiColon();
        return true;
    }

    public parse(document: TextDocument, includeFilePaths: string[], includeCache: Map<string, [string, PreprocIncInfo, TextDocument]>,
                 userDefinesMacroInfo: Map<string, MacroInfo>, precision: string="full", maxDepth: number=-1, text?: string): [SystemVerilogParser.SystemVerilogFileSymbolsInfo[], string[]] {
        this._document = document;
        this._documentPath = uriToPath(document.uri);
        this._includeCache = includeCache;
        this._fileSymbolsInfo = [];
        let preprocSymbols: SystemVerilogSymbol[];
        [this._svtokens, this._tokenOrder, preprocSymbols] = this.tokenize(text || this._document.getText(), includeFilePaths, userDefinesMacroInfo);
        if (preprocSymbols.length > 0) {
            _initFileSymbols(this._fileSymbolsInfo, SystemVerilogParser.FileInfoIndex.Symbols, preprocSymbols);
        }
        this._symbols = [];
        this._containerStack = new ContainerStack(this._fileSymbolsInfo);
        this._currTokenNum = 0;

        for (; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes);
            if (this._notIgnorableScope()) {
                this._printDebugInfo("token");
                if (this._processPreprocessor() ||
                    this._processAttributeInstance() ||
                    this._processSimpleKeywords() ||
                    this._processPortDeclaration() ||
                    this._processGenerateItem() ||
                    this._processSpecifyBlock() ||
                    this._processSpecparamDeclaration() ||
                    this._processContainerHeader() ||
                    this._processPackageHeader() ||
                    this._processTimeunitsDeclaration() ||
                    this._processModPortDeclaration() ||
                    this._processVarInstDeclaration()) {
                    continue;
                }
                else {
                    this._printParsingFailedMessage();
                }
            }
        }

        if (DEBUG_MODE == 1) {
            let symbols: SystemVerilogSymbol[] = SystemVerilogParser.fileAllSymbols(this._fileSymbolsInfo, false);
            for (let symbol of symbols) {
                ConnectionLogger.log(`DEBUG: found Symbol ${symbol.name} of type ${symbol.type} in document ${this._documentPath}`);
            }
        }

        let pkgdeps: Set<string> = new Set();
        for (let svtoken of this._svtokens) {
            let scope: string = this._getElem(svtoken.scopes);
            if (scope == "identifier.scoped.systemverilog") {
                let parts: string[] = svtoken.text.split('::');
                pkgdeps.add(parts[0]);
            }
        }
        if (DEBUG_MODE == 1) {
            if (pkgdeps) {
                ConnectionLogger.log(`DEBUG: found pkgdeps ${[...pkgdeps].join(', ')} in document ${this._documentPath}`);
            }
        }

        //TBD DEBUG
        //for (let si: number = 0; si < this._fileSymbolsInfo.length; si++) {
        //    this._debugFileInfo(si);
        //}
        //for (let cntrInfo of <SystemVerilogParser.SystemVerilogContainersInfo>(this._fileSymbolsInfo[SystemVerilogParser.FileInfoIndex.Containers])) {
        //    ConnectionLogger.log(`DEBUG: Processing ${cntrInfo[0].name} container from ${this._document.uri}`);
        //    this._debugContainerInfo(cntrInfo[1], SystemVerilogParser.ContainerInfoIndex.Imports);
        //    this._debugContainerInfo(cntrInfo[1], SystemVerilogParser.ContainerInfoIndex.Exports);
        //}

        return [this._fileSymbolsInfo, [...pkgdeps]];
    }

    public static includeCacheToJSON(includeCache: Map<string, [string, PreprocIncInfo, TextDocument]>) {
        return Array.from(includeCache.entries()).map(e => [e[0], [e[1][0], SystemVerilogPreprocessor.preprocIncInfoToJSON(e[1][1]), e[1][2]]]);
    }

    public static includeCacheFromJSON(includeCacheJSON): Map<string, [string, PreprocIncInfo, TextDocument]> {
        return new Map(includeCacheJSON.map(e => [e[0], [e[1][0], SystemVerilogPreprocessor.preprocIncInfoFromJSON(e[0], e[1][1]), TextDocument.create(e[1][2]._uri, e[1][2]._languageId, e[1][2]._version, e[1][2]._content)]]));
    }
}

export namespace SystemVerilogParser {
    export enum ContainerInfoIndex {
        Symbols,
        Imports,
        Containers,
        Exports
    }

    export enum FileInfoIndex {
        Containers,
        Includes,
        Imports,
        Exports,
        Symbols
    }

    export type SystemVerilogSymbolInfo = SystemVerilogSymbol;
    export type SystemVerilogImportInfo = [string, string[]];
    export type SystemVerilogExportInfo = [string, string[]];
    export type SystemVerilogIncludeInfo = string;
    export type SystemVerilogSymbolsInfo = SystemVerilogSymbolInfo[];
    export type SystemVerilogImportsInfo = SystemVerilogImportInfo[];
    export type SystemVerilogExportsInfo = SystemVerilogExportInfo[];
    export type SystemVerilogContainerSymbolsInfo = SystemVerilogSymbolsInfo|SystemVerilogImportsInfo|SystemVerilogContainersInfo|SystemVerilogExportsInfo;
    export type SystemVerilogContainerInfo = [SystemVerilogSymbol, SystemVerilogContainerSymbolsInfo[]];
    export type SystemVerilogContainersInfo = SystemVerilogContainerInfo[];
    export type SystemVerilogIncludesInfo = SystemVerilogIncludeInfo[];
    export type SystemVerilogFileSymbolsInfo = SystemVerilogContainersInfo|SystemVerilogIncludesInfo|SystemVerilogSymbolsInfo|SystemVerilogImportsInfo|SystemVerilogExportsInfo;

    export type SystemVerilogSymbolInfoJSON = SystemVerilogSymbolJSON;
    export type SystemVerilogSymbolsInfoJSON = SystemVerilogSymbolInfoJSON[];
    export type SystemVerilogContainerSymbolsInfoJSON = SystemVerilogSymbolsInfoJSON|SystemVerilogImportsInfo|SystemVerilogContainersInfoJSON|SystemVerilogExportsInfo;
    export type SystemVerilogContainerInfoJSON = [SystemVerilogSymbolJSON, SystemVerilogContainerSymbolsInfoJSON[]];
    export type SystemVerilogContainersInfoJSON = SystemVerilogContainerInfoJSON[];
    export type SystemVerilogFileSymbolsInfoJSON = SystemVerilogContainersInfoJSON|SystemVerilogIncludesInfo|SystemVerilogSymbolsInfoJSON|SystemVerilogImportsInfo|SystemVerilogExportsInfo;

    export function fileAllSymbols(fileSymbolsInfo: SystemVerilogFileSymbolsInfo[], strict: Boolean = true): SystemVerilogSymbol[] {
        let symbols: SystemVerilogSymbol[] = [];

        if ((fileSymbolsInfo.length > FileInfoIndex.Symbols) &&
            (fileSymbolsInfo[FileInfoIndex.Symbols] != undefined) &&
            (fileSymbolsInfo[FileInfoIndex.Symbols].length > 0)) {
            let topSymbols: SystemVerilogSymbolsInfo = (<SystemVerilogSymbolsInfo>(fileSymbolsInfo[FileInfoIndex.Symbols])).filter(sym => { return !sym.name.startsWith('#'); });
            if (strict) {
                symbols = symbols.concat(topSymbols.filter(sym => { return Range.is(sym.symLocation); }));
            }
            else {
                symbols = symbols.concat(topSymbols);
            }
        }

        if ((fileSymbolsInfo.length > FileInfoIndex.Containers) &&
            (fileSymbolsInfo[FileInfoIndex.Containers] != undefined) &&
            (fileSymbolsInfo[FileInfoIndex.Containers].length > 0)) {
            for (let containerInfo of <SystemVerilogContainersInfo>(fileSymbolsInfo[FileInfoIndex.Containers])) {
                let cntnrSymbols: SystemVerilogSymbolsInfo = containerAllSymbols(containerInfo);
                if (strict) {
                    symbols = symbols.concat(cntnrSymbols.filter(sym => { return Range.is(sym.symLocation); }));
                }
                else {
                    symbols = symbols.concat(cntnrSymbols);
                }
            }
        }

        return symbols;
    }

    export function containerSymbols(containerSymbolsInfo: SystemVerilogContainerSymbolsInfo[]): SystemVerilogSymbol[] {
        let symbols: SystemVerilogSymbol[] = [];

        if ((containerSymbolsInfo.length > ContainerInfoIndex.Containers) &&
            (containerSymbolsInfo[ContainerInfoIndex.Containers] != undefined)) {
            for (let container of <SystemVerilogContainersInfo>(containerSymbolsInfo[ContainerInfoIndex.Containers])) {
                if (!container[0].name.startsWith('#')) {
                    symbols.push(container[0]);
                }
                symbols = symbols.concat(containerSymbols(container[1]));
            }
        }

        return symbols;
    }

    export function containerAllSymbols(containerInfo: SystemVerilogContainerInfo, topOnly: boolean = false): SystemVerilogSymbol[] {
        let symbols: SystemVerilogSymbol[] = [];

        if (!containerInfo[0].name.startsWith('#') && !topOnly) {
            symbols.push(containerInfo[0]);
        }

        if ((containerInfo[1].length > ContainerInfoIndex.Symbols) &&
            (containerInfo[1][ContainerInfoIndex.Symbols] != undefined) &&
            (containerInfo[1][ContainerInfoIndex.Symbols].length > 0)) {
            let cntnrSymbols: SystemVerilogSymbol[] = <SystemVerilogSymbolsInfo>(containerInfo[1][ContainerInfoIndex.Symbols]);
            symbols = symbols.concat(cntnrSymbols.filter(sym => { return !sym.name.startsWith('#'); }));
        }

        if ((containerInfo[1].length > ContainerInfoIndex.Containers) &&
            (containerInfo[1][ContainerInfoIndex.Containers] != undefined) &&
            (containerInfo[1][ContainerInfoIndex.Containers].length > 0)) {
            for (let childContainerInfo of <SystemVerilogContainersInfo>(containerInfo[1][ContainerInfoIndex.Containers])) {
                if (topOnly) {
                    symbols.push(childContainerInfo[0]);
                }
                else {
                    symbols = symbols.concat(containerAllSymbols(childContainerInfo));
                }
            }
        }

        return symbols;
    }

    export function fileContainerSymbols(fileSymbolsInfo: SystemVerilogFileSymbolsInfo[]): SystemVerilogSymbol[] {
        let symbols: SystemVerilogSymbol[] = [];

        if ((fileSymbolsInfo.length > FileInfoIndex.Containers) &&
            (fileSymbolsInfo[FileInfoIndex.Containers] != undefined)) {
            for (let container of <SystemVerilogContainersInfo>(fileSymbolsInfo[FileInfoIndex.Containers])) {
                if (!container[0].name.startsWith('#')) {
                    symbols.push(container[0]);
                }
                symbols = symbols.concat(containerSymbols(container[1]));
            }
        }

        return symbols;
    }

    export function findContainerSymbol(containerSymbolsInfo: SystemVerilogContainerSymbolsInfo[], symbolName: string, findContainer: Boolean): SystemVerilogSymbol | SystemVerilogContainerInfo {
        if (!findContainer &&
            (containerSymbolsInfo.length > ContainerInfoIndex.Symbols) &&
            (containerSymbolsInfo[ContainerInfoIndex.Symbols] != undefined)) {
            let symbol: SystemVerilogSymbol = (<SystemVerilogSymbol[]>(containerSymbolsInfo[ContainerInfoIndex.Symbols])).find(sym => { return sym.name == symbolName; });
            if (symbol != undefined) {
                return symbol;
            }
        }

        if ((containerSymbolsInfo.length > ContainerInfoIndex.Containers) &&
            (containerSymbolsInfo[ContainerInfoIndex.Containers] != undefined)) {
            for (let container of <SystemVerilogContainersInfo>(containerSymbolsInfo[ContainerInfoIndex.Containers])) {
                if (container[0].name == symbolName) {
                    if (findContainer) {
                        return container;
                    }
                    else {
                        return container[0];
                    }
                }

                if (findContainer) {
                    let subContainerInfo: SystemVerilogContainerInfo = <SystemVerilogContainerInfo>(findContainerSymbol(container[1], symbolName, findContainer));
                    if (subContainerInfo[0] != undefined) {
                        return subContainerInfo;
                    }
                }
                else {
                    let symbol: SystemVerilogSymbol = <SystemVerilogSymbol>(findContainerSymbol(container[1], symbolName, findContainer));
                    if (symbol != undefined) {
                        return symbol;
                    }
                }
            }
        }

        if (findContainer) {
            return [undefined, []];
        }
        else {
            return undefined;
        }
    }

    export function findSymbol(fileSymbolsInfo: SystemVerilogFileSymbolsInfo[], symbolName: string, findContainer: Boolean): SystemVerilogSymbol | SystemVerilogContainerInfo {
        if (!findContainer &&
            (fileSymbolsInfo.length > FileInfoIndex.Symbols) &&
            (fileSymbolsInfo[FileInfoIndex.Symbols] != undefined)) {
            let symbol: SystemVerilogSymbol = (<SystemVerilogSymbol[]>(fileSymbolsInfo[FileInfoIndex.Symbols])).find(sym => { return sym.name == symbolName; });
            if (symbol != undefined) {
                return symbol;
            }
        }

        if ((fileSymbolsInfo.length > FileInfoIndex.Containers) &&
            (fileSymbolsInfo[FileInfoIndex.Containers] != undefined)) {
            for (let container of <SystemVerilogContainersInfo>(fileSymbolsInfo[FileInfoIndex.Containers])) {
                if (container[0].name == symbolName) {
                    if (findContainer) {
                        return container;
                    }
                    else {
                        return container[0];
                    }
                }

                if (findContainer) {
                    let subContainerInfo: SystemVerilogContainerInfo = <SystemVerilogContainerInfo>(findContainerSymbol(container[1], symbolName, findContainer));
                    if (subContainerInfo[0] != undefined) {
                        return subContainerInfo;
                    }
                }
                else {
                    let symbol: SystemVerilogSymbol = <SystemVerilogSymbol>(findContainerSymbol(container[1], symbolName, findContainer));
                    if (symbol != undefined) {
                        return symbol;
                    }
                }
            }
        }

        if (findContainer) {
            return [undefined, []];
        }
        else {
            return undefined;
        }
    }

    export function jsonToFileSymbolsInfo(file: string, jsonFileSymbolsInfo: SystemVerilogParser.SystemVerilogFileSymbolsInfoJSON[]): SystemVerilogFileSymbolsInfo[] {
        let fileSymbolsInfo: SystemVerilogFileSymbolsInfo[] = [];

        if (jsonFileSymbolsInfo.length > FileInfoIndex.Containers) {
            _initFileSymbols(fileSymbolsInfo, FileInfoIndex.Containers);
            if (jsonFileSymbolsInfo[FileInfoIndex.Containers] == undefined) {
                fileSymbolsInfo[FileInfoIndex.Containers] = undefined;
            }
            else {
                for (let jsonContainerInfo of jsonFileSymbolsInfo[FileInfoIndex.Containers]) {
                    (<SystemVerilogContainersInfo>fileSymbolsInfo[FileInfoIndex.Containers]).push([
                        SystemVerilogSymbol.fromJSON(file, <SystemVerilogSymbolJSON>(jsonContainerInfo[0])),
                        _jsonToContainerSymbolsInfo(file, <SystemVerilogContainerSymbolsInfoJSON[]>(jsonContainerInfo[1]))
                    ]);
                }
            }
        }

        if (jsonFileSymbolsInfo.length > FileInfoIndex.Includes) {
            _initFileSymbols(fileSymbolsInfo, FileInfoIndex.Includes);
            fileSymbolsInfo[FileInfoIndex.Includes] = <SystemVerilogIncludesInfo>(jsonFileSymbolsInfo[FileInfoIndex.Includes]);
        }

        if (jsonFileSymbolsInfo.length > FileInfoIndex.Imports) {
            _initFileSymbols(fileSymbolsInfo, FileInfoIndex.Imports);
            fileSymbolsInfo[FileInfoIndex.Imports] = <SystemVerilogImportsInfo>(jsonFileSymbolsInfo[FileInfoIndex.Imports]);
        }

        if (jsonFileSymbolsInfo.length > FileInfoIndex.Exports) {
            _initFileSymbols(fileSymbolsInfo, FileInfoIndex.Exports);
            fileSymbolsInfo[FileInfoIndex.Exports] = <SystemVerilogImportsInfo>(jsonFileSymbolsInfo[FileInfoIndex.Exports]);
        }

        if (jsonFileSymbolsInfo.length > FileInfoIndex.Symbols) {
            _initFileSymbols(fileSymbolsInfo, FileInfoIndex.Symbols);
            if (jsonFileSymbolsInfo[FileInfoIndex.Symbols] == undefined) {
                fileSymbolsInfo[FileInfoIndex.Symbols] = undefined;
            }
            else {
                for (let symbol of <SystemVerilogSymbolsInfoJSON>(jsonFileSymbolsInfo[FileInfoIndex.Symbols])) {
                    (<SystemVerilogSymbolsInfo>(fileSymbolsInfo[FileInfoIndex.Symbols])).push(SystemVerilogSymbol.fromJSON(file, symbol));
                }
            }
        }

        return fileSymbolsInfo;
    }

    export function preprocToFileSymbolsInfo(symbols: SystemVerilogSymbol[], includes?: Set<string>): SystemVerilogFileSymbolsInfo[] {
        let fileSymbolsInfo: SystemVerilogFileSymbolsInfo[] = [];
        _initFileSymbols(fileSymbolsInfo, FileInfoIndex.Symbols, symbols);
        _initFileSymbols(fileSymbolsInfo, FileInfoIndex.Includes, [...includes]);
        if (includes == undefined) {
            fileSymbolsInfo[FileInfoIndex.Includes] = undefined;
        }
        return fileSymbolsInfo;
    }

    export function containerImports(containerSymbolsInfo: SystemVerilogContainerSymbolsInfo[]): SystemVerilogImportsInfo {
        let containerImportsInfo: SystemVerilogImportsInfo = [];

        if ((containerSymbolsInfo.length > ContainerInfoIndex.Imports) &&
            (containerSymbolsInfo[ContainerInfoIndex.Imports] != undefined)) {
            containerImportsInfo = <SystemVerilogImportsInfo>(containerSymbolsInfo[ContainerInfoIndex.Imports]);
        }

        if ((containerSymbolsInfo.length > ContainerInfoIndex.Containers) &&
            (containerSymbolsInfo[ContainerInfoIndex.Containers] != undefined)) {
            for (let cntnrInfo of <SystemVerilogContainersInfo>(containerSymbolsInfo[ContainerInfoIndex.Containers])) {
                containerImportsInfo = containerImportsInfo.concat(containerImports(cntnrInfo[1]));
            }
        }

        return containerImportsInfo;
    }

    export function fileAllImports(fileSymbolsInfo: SystemVerilogFileSymbolsInfo[]): SystemVerilogImportsInfo {
        let fileImportsInfo: SystemVerilogImportsInfo = [];

        if ((fileSymbolsInfo.length > FileInfoIndex.Imports) &&
            (fileSymbolsInfo[FileInfoIndex.Imports] != undefined)) {
            fileImportsInfo = <SystemVerilogImportsInfo>(fileSymbolsInfo[FileInfoIndex.Imports]);
        }

        if ((fileSymbolsInfo.length > FileInfoIndex.Containers) &&
            (fileSymbolsInfo[FileInfoIndex.Containers] != undefined)) {
            for (let cntnrInfo of <SystemVerilogContainersInfo>(fileSymbolsInfo[FileInfoIndex.Containers])) {
                fileImportsInfo = fileImportsInfo.concat(containerImports(cntnrInfo[1]));
            }
        }

        return fileImportsInfo;
    }

    export function containerExports(containerSymbolsInfo: SystemVerilogContainerSymbolsInfo[]): SystemVerilogExportsInfo {
        let containerExportsInfo: SystemVerilogExportsInfo = [];

        if ((containerSymbolsInfo.length > ContainerInfoIndex.Exports) &&
            (containerSymbolsInfo[ContainerInfoIndex.Exports] != undefined)) {
            containerExportsInfo = <SystemVerilogExportsInfo>(containerSymbolsInfo[ContainerInfoIndex.Exports]);
        }

        if ((containerSymbolsInfo.length > ContainerInfoIndex.Containers) &&
            (containerSymbolsInfo[ContainerInfoIndex.Containers] != undefined)) {
            for (let cntnrInfo of <SystemVerilogContainersInfo>(containerSymbolsInfo[ContainerInfoIndex.Containers])) {
                containerExportsInfo = containerExportsInfo.concat(containerExports(cntnrInfo[1]));
            }
        }

        return containerExportsInfo;
    }
}
