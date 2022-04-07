import { TextDocument, Range, Position } from "vscode-languageserver/node";

import {
    ConnectionLogger,
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

function _jsonToContainerSymbolsInfo(file: string, jsonContainerSymbolsInfo: SystemVerilogParser.SystemVerilogContainerSymbolsInfoJSON): SystemVerilogParser.SystemVerilogContainerSymbolsInfo {
    let containerSymbolsInfo: SystemVerilogParser.SystemVerilogContainerSymbolsInfo = {};

    if (jsonContainerSymbolsInfo.length > SystemVerilogParser.ContainerInfoIndex.Symbols) {
        if (jsonContainerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Symbols] != undefined) {
            containerSymbolsInfo.symbolsInfo = [];
            for (let symbol of <SystemVerilogParser.SystemVerilogSymbolsInfoJSON>(jsonContainerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Symbols])) {
                containerSymbolsInfo.symbolsInfo.push(SystemVerilogSymbol.fromJSON(file, symbol));
            }
        }
    }

    if (jsonContainerSymbolsInfo.length > SystemVerilogParser.ContainerInfoIndex.Imports) {
        containerSymbolsInfo.importsInfo = <SystemVerilogParser.SystemVerilogImportsInfo>(jsonContainerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Imports]);
    }

    if (jsonContainerSymbolsInfo.length > SystemVerilogParser.ContainerInfoIndex.Containers) {
        if (jsonContainerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Containers] != undefined) {
            containerSymbolsInfo.containersInfo = [];
            for (let jsonContainerInfo of (<SystemVerilogParser.SystemVerilogContainersInfoJSON>(jsonContainerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Containers]))) {
                containerSymbolsInfo.containersInfo.push({
                    symbol: SystemVerilogSymbol.fromJSON(file, jsonContainerInfo[0][0]),
                    position: SystemVerilogParser.jsonToPosition(jsonContainerInfo[0][1]),
                    info: _jsonToContainerSymbolsInfo(file, jsonContainerInfo[1])
                });
            }
        }
    }

    if (jsonContainerSymbolsInfo.length > SystemVerilogParser.ContainerInfoIndex.Exports) {
        containerSymbolsInfo.exportsInfo = <SystemVerilogParser.SystemVerilogExportsInfo>(jsonContainerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Exports]);
    }

    return containerSymbolsInfo;
}

type ImportExportMap = Map<string, [Boolean, Set<string>, number]>;

class ContainerStack {
    private _stack: [SystemVerilogParser.SystemVerilogFileSymbolsInfo, SystemVerilogParser.SystemVerilogContainersInfo];
    private _symbolMap: Map<string, number>;
    private _importMap: ImportExportMap;
    private _exportMap: ImportExportMap;

    constructor(fileSymbolsInfo: SystemVerilogParser.SystemVerilogFileSymbolsInfo) {
        this._stack = [fileSymbolsInfo, []];
        this._symbolMap = new Map();
        this._importMap = new Map();
        this._exportMap = new Map();
    }

    push(symbol: SystemVerilogSymbol): SystemVerilogSymbol {
        let containerSymbols: SystemVerilogParser.SystemVerilogContainersInfo;
        if (this._stack[1].length <= 0) {
            if (this._stack[0].containersInfo == undefined) {
                this._stack[0].containersInfo = [];
            }
            containerSymbols = this._stack[0].containersInfo;
        }
        else {
            let containerSymbolsInfo: SystemVerilogParser.SystemVerilogContainerSymbolsInfo = this._stack[1][this._stack[1].length - 1].info;
            if (containerSymbolsInfo.containersInfo == undefined) {
                containerSymbolsInfo.containersInfo = [];
            }
            containerSymbols = containerSymbolsInfo.containersInfo;
        }

        let containerInfo: SystemVerilogParser.SystemVerilogContainerInfo;
        let symbolStr: string = [symbol.name, ...symbol.type, ...this.toStringList()].join(' ');
        let resSymbol: SystemVerilogSymbol;
        if (this._symbolMap.has(symbolStr)) {
            containerInfo = containerSymbols[this._symbolMap.get(symbolStr)];
            containerInfo.symbol.overwrite(symbol);
            resSymbol = containerInfo.symbol;
        }
        else {
            this._symbolMap.set(symbolStr, containerSymbols.length);
            containerInfo = { symbol: symbol, position: undefined, info: {} };
            containerSymbols.push(containerInfo);
            resSymbol = symbol;
        }

        this._stack[1].push(containerInfo);
        return resSymbol;
    }

    pushSymbol(symbol: SystemVerilogSymbol): SystemVerilogSymbol {
        let symbols: SystemVerilogParser.SystemVerilogSymbolsInfo;
        if (this._stack[1].length <= 0) {
            if (this._stack[0].symbolsInfo == undefined) {
                this._stack[0].symbolsInfo = [];
            }
            symbols = this._stack[0].symbolsInfo;
        }
        else {
            let containerSymbolsInfo: SystemVerilogParser.SystemVerilogContainerSymbolsInfo = this._stack[1][this._stack[1].length - 1].info;
            if (containerSymbolsInfo.symbolsInfo == undefined) {
                containerSymbolsInfo.symbolsInfo = [];
            }
            symbols = containerSymbolsInfo.symbolsInfo;
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

    getContainerDocumentPath(uri: string): string {
        if (this._stack[1].length <= 0) {
            return undefined;
        }
        return this._stack[1][this._stack[1].length - 1].symbol.getSymbolDocumentPath(uri);
    }

    pop(endPosition?: SystemVerilogParser.SystemVerilogPosition) {
        if (this._stack[1].length <= 0) {
            ConnectionLogger.error(`ContainerStack is already empty!`);
            return;
        }
        this._stack[1][this._stack[1].length - 1].position = endPosition;
        this._stack[1].pop();
    }

    toStringList(): string[] {
        return this._stack[1].map(e => e.symbol.name);
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
            if (this._stack[0].importsInfo == undefined) {
                this._stack[0].importsInfo = [];
            }
            importsInfo = this._stack[0].importsInfo;
        }
        else {
            let containerSymbolsInfo: SystemVerilogParser.SystemVerilogContainerSymbolsInfo = this._stack[1][this._stack[1].length - 1].info;
            if (containerSymbolsInfo.importsInfo == undefined) {
                containerSymbolsInfo.importsInfo = [];
            }
            importsInfo = containerSymbolsInfo.importsInfo;
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
            if (this._stack[0].exportsInfo == undefined) {
                this._stack[0].exportsInfo = [];
            }
            exportsInfo = this._stack[0].exportsInfo;
        }
        else {
            let containerSymbolsInfo: SystemVerilogParser.SystemVerilogContainerSymbolsInfo = this._stack[1][this._stack[1].length - 1].info;
            if (containerSymbolsInfo.exportsInfo == undefined) {
                containerSymbolsInfo.exportsInfo = [];
            }
            exportsInfo = containerSymbolsInfo.exportsInfo;
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
    private _fileSymbolsInfo: SystemVerilogParser.SystemVerilogFileSymbolsInfo;
    private _svtokens: ParseToken[];
    private _tokenOrder: [string, number][];
    private _containerStack: ContainerStack;
    private _currTokenNum: number;

    private _debugContainerInfo(containerInfo: SystemVerilogParser.SystemVerilogContainerSymbolsInfo, symIndex: number) {
        if (symIndex == SystemVerilogParser.ContainerInfoIndex.Symbols) {
            if (containerInfo.symbolsInfo == undefined) {
                return;
            }
            for (let symbol of containerInfo.symbolsInfo) {
                ConnectionLogger.log(`DEBUG: symbol "${symbol.name}" of type ${symbol.type}`);
            }
        }
        else if (symIndex == SystemVerilogParser.ContainerInfoIndex.Imports) {
            if (containerInfo.importsInfo == undefined) {
                return;
            }
            for (let importItem of containerInfo.importsInfo) {
                ConnectionLogger.log(`DEBUG: imports from "${importItem[0]}" are ${importItem[1]}`);
            }
        }
        else if (symIndex == SystemVerilogParser.ContainerInfoIndex.Containers) {
            if (containerInfo.containersInfo == undefined) {
                return;
            }
            for (let childContainerInfo of containerInfo.containersInfo) {
                let symbol: SystemVerilogSymbol = childContainerInfo.symbol;
                ConnectionLogger.log(`DEBUG: container symbol "${symbol.name}" of type ${symbol.type}`);
                let containerSymbolsInfo: SystemVerilogParser.SystemVerilogContainerSymbolsInfo = childContainerInfo.info;
                for (let si: number = 0; si < Object.entries(SystemVerilogParser.ContainerInfoIndex).length; si++) {
                    this._debugContainerInfo(containerSymbolsInfo, si);
                }
            }
        }
        else if (symIndex == SystemVerilogParser.ContainerInfoIndex.Exports) {
            if (containerInfo.exportsInfo == undefined) {
                return;
            }
            for (let exportItem of containerInfo.exportsInfo) {
                ConnectionLogger.log(`DEBUG: exports from "${exportItem[0]}" are ${exportItem[1]}`);
            }
        }
        else {
            ConnectionLogger.error(`Unsupported SystemVerilogParser.ContainerInfoIndex ${symIndex}`);
        }
    }

    private _debugFileInfo(symIndex: number) {
        if (symIndex == SystemVerilogParser.FileInfoIndex.Containers) {
            if (this._fileSymbolsInfo.containersInfo == undefined) {
                return;
            }
            for (let containerInfo of this._fileSymbolsInfo.containersInfo) {
                let symbol: SystemVerilogSymbol = containerInfo.symbol;
                ConnectionLogger.log(`DEBUG: container symbol "${symbol.name}" of type ${symbol.type}`);
                let containerSymbolsInfo: SystemVerilogParser.SystemVerilogContainerSymbolsInfo = containerInfo.info;
                for (let si: number = 0; si < Object.entries(SystemVerilogParser.ContainerInfoIndex).length; si++) {
                    this._debugContainerInfo(containerSymbolsInfo, si);
                }
            }
        }
        else if (symIndex == SystemVerilogParser.FileInfoIndex.Includes) {
            if ((this._fileSymbolsInfo.includesInfo == undefined) ||
                (this._fileSymbolsInfo.includesInfo.length <= 0)) {
                ConnectionLogger.log(`DEBUG: no includes in ${this._documentPath}`);
                return;
            }
            for (let include of this._fileSymbolsInfo.includesInfo) {
                ConnectionLogger.log(`DEBUG: ${include} included in ${this._documentPath}`);
            }
        }
        else if (symIndex == SystemVerilogParser.FileInfoIndex.Imports) {
            if ((this._fileSymbolsInfo.importsInfo == undefined) ||
                (this._fileSymbolsInfo.importsInfo.length <= 0)) {
                ConnectionLogger.log(`DEBUG: no global imports in ${this._documentPath}`);
                return;
            }
            for (let importItem of this._fileSymbolsInfo.importsInfo) {
                ConnectionLogger.log(`DEBUG: global imports from "${importItem[0]}" are ${importItem[1]}`);
            }
        }
        else if (symIndex == SystemVerilogParser.FileInfoIndex.Exports) {
            if ((this._fileSymbolsInfo.exportsInfo == undefined) ||
                (this._fileSymbolsInfo.exportsInfo.length <= 0)) {
                ConnectionLogger.log(`DEBUG: no global exports in ${this._documentPath}`);
                return;
            }
            for (let exportItem of this._fileSymbolsInfo.exportsInfo) {
                ConnectionLogger.log(`DEBUG: global exports from "${exportItem[0]}" are ${exportItem[1]}`);
            }
        }
        else if (symIndex == SystemVerilogParser.FileInfoIndex.Symbols) {
            if (this._fileSymbolsInfo.symbolsInfo == undefined) {
                return;
            }
            for (let symbol of this._fileSymbolsInfo.symbolsInfo) {
                ConnectionLogger.log(`DEBUG: symbol "${symbol.name}" of type ${symbol.type}`);
            }
        }
        else {
            ConnectionLogger.error(`Unsupported SystemVerilogParser.FileInfoIndex ${symIndex}`);
        }
    }

    public tokenize(_text: string, includeFilePaths: string[], userDefinesMacroInfo: Map<string, MacroInfo>): [ParseToken[], [string, number][], SystemVerilogSymbol[]] {
        try {
            let preprocParser: SystemVerilogPreprocessor = new SystemVerilogPreprocessor();
            let preprocInfo: PreprocInfo = preprocParser.parse(this._document, includeFilePaths, this._includeCache, userDefinesMacroInfo);

            if (preprocInfo.includes.size > 0) {
                this._fileSymbolsInfo.includesInfo = [...preprocInfo.includes];
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
        } catch(error) {
            ConnectionLogger.error(error);
            return [[], [], []];
        }
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

    private _getEndPosition(token?: number): SystemVerilogParser.SystemVerilogPosition {
        let _token: number = token == undefined ? this._currTokenNum : token;
        let tokenOrderIndex: number = this._getTokenOrderIndex(_token);
        if (tokenOrderIndex == undefined) {
            ConnectionLogger.error(`Could not figure out the source file for the given token. Falling back to default`);
            let endPos: Position = this._document.positionAt(this._svtokens[_token].endTokenIndex);
            return { line: endPos.line, character: endPos.character };
        }

        let document: TextDocument = this._getDocumentFromTokenOrderIndex(tokenOrderIndex);
        if (document == undefined) {
            ConnectionLogger.error(`Could not figure out the source file for the given token. Falling back to default`);
            let endPos: Position = this._document.positionAt(this._svtokens[_token].endTokenIndex);
            return { line: endPos.line, character: endPos.character };
        }

        let refDocumentPath: string = this._containerStack.getContainerDocumentPath(document.uri);
        let endPos: Position = (this._document.uri == refDocumentPath)
                             ? this._document.positionAt(this._svtokens[_token].endTokenIndex)
                             : document.positionAt(this._svtokens[_token].endTokenIndex);
        return (this._document.uri == refDocumentPath) ? { line: endPos.line, character: endPos.character } : { file: refDocumentPath, line: endPos.line, character: endPos.character };
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

        let document: TextDocument = this._getDocumentFromTokenOrderIndex(tokenOrderIndices[0]);
        if (document == undefined) {
            ConnectionLogger.error(`Could not find the document for the given range. Falling back to default`);
            return Range.create(
                this._document.positionAt(this._svtokens[startToken].startTokenIndex),
                this._document.positionAt(this._svtokens[endToken].endTokenIndex + 1)
            );
        }
        let defLocations: DefinitionLocations = (this._document.uri == document.uri) ? [] : [document.uri];
        let currToken: number = startToken;
        for (let i: number = 1; i < tokenOrderIndices.length; i++) {
            defLocations.push(Range.create(
                document.positionAt(this._svtokens[currToken].startTokenIndex),
                document.positionAt(this._svtokens[this._tokenOrder[tokenOrderIndices[i]][1] - 1].endTokenIndex + 1)
            ));
            currToken = this._tokenOrder[tokenOrderIndices[i]][1];
        }
        defLocations.push(Range.create(
            document.positionAt(this._svtokens[currToken].startTokenIndex),
            document.positionAt(this._svtokens[endToken].endTokenIndex + 1)
        ));
        if (defLocations.length == 1) {
            defLocations = <Range>defLocations[0];
        }

        return defLocations;
    }

    private _getDocumentFromTokenOrderIndex(tokenOrderIndex: number): TextDocument {
        let document: TextDocument;
        let file: string = this._documentPath;
        if (tokenOrderIndex == undefined) {
            ConnectionLogger.error(`Could not figure out the source file for the given range. Falling back to default`);
            return undefined;
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
        let document: TextDocument = this._getDocumentFromTokenOrderIndex(this._getTokenOrderIndex(symToken));
        if (document == undefined) {
            return;
        }
        let symbolName: string = symbolText || this._svtokens[symToken].text;
        let symbolRange: Range = Range.create(
            document.positionAt(this._svtokens[symToken].startTokenIndex),
            document.positionAt(this._svtokens[symToken].endTokenIndex + 1)
        );
        return new SystemVerilogSymbol(
            symbolName,
            tokenRange ? this._getDefLocations(tokenRange[0], tokenRange[1]) : undefined,
            document.uri == this._document.uri ? symbolRange : [document.uri, symbolRange],
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
                //ConnectionLogger.log(`DEBUG: Processing routine ${this._svtokens[prevIdToken].text}`);
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

    private _processDimension(): Boolean {
        let _currTokenNum: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[this._currTokenNum].scopes.length - 1;

        this._currTokenNum++;
        for (; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth);
            if (scope == undefined) {
                this._currTokenNum = _currTokenNum;
                return false;
            }
            else if (scope != "dimension.expression.systemverilog") {
                this._currTokenNum--;
                break;
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
        }

        return true;
    }

    private _processParamPortDeclaration(): Boolean {
        let _currTokenNum: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[this._currTokenNum].scopes.length - 1;

        this._currTokenNum++;
        let nextToken: number = this._nextNonIgnorableScope();
        if ((nextToken == undefined) || (this._getElem(this._svtokens[nextToken].scopes, scopeDepth) != "parantheses.begin.systemverilog")) {
            this._currTokenNum = _currTokenNum;
            return false;
        }

        this._currTokenNum++;
        for (; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth);
            if (scope == undefined) {
                this._currTokenNum = _currTokenNum;
                return false;
            }
            else if (scope != "parantheses.block.systemverilog") {
                this._currTokenNum--;
                break;
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
        }

        return true;
    }
/*
= ["const"] ["var"] ["static"|"automatic"] integer_vector_type ["signed"|"unsigned"] {packed_dimension} {list_of_variable_decl_assignments} ";"
| ["const"] ["var"] ["static"|"automatic"] integer_atom_type ["signed"|unsigned"] {list_of_variable_decl_assignments} ";"
| ["const"] ["var"] ["static"|"automatic"] non_integer_type {list_of_variable_decl_assignments} ";"
| ["const"] ["var"] ["static"|"automatic"] struct_union ["packed"] ["signed"|"unsigned"] "{" struct_union_member {"," struct_union_member} "}" {packed_dimension} {list_of_variable_decl_assignments} ";"
| ["const"] ["var"] ["static"|"automatic"] "string"|"chandle" {list_of_variable_decl_assignments} ";"
| ["const"] ["var"] ["static"|"automatic"] "virtual" ["interface"] interface_identifier [parameter_value_assignment] ["." modport_identifier] {list_of_variable_decl_assignments} ";"
| ["const"] ["var"] ["static"|"automatic"] [class_scope|package_scope] type_identifier {packed_dimension} {list_of_variable_decl_assignments} ";"
| ["const"] ["var"] ["static"|"automatic"] ps_class_identifier [parameter_value_assignment] {"::" class_identifier [parameter_value_asisgnment]} {list_of_variable_decl_assignments} ";"
| ["const"] ["var"] ["static"|"automatic"] "event" {list_of_variable_decl_assignments} ";"
| ["const"] ["var"] ["static"|"automatic"] ps_covergroup_identifier {list_of_variable_decl_assignments} ";"
| ["const"] ["var"] ["static"|"automatic"] "type" "("...")" {list_of_variable_decl_assignments} ";"
| ["const"] ["var"] ["static"|"automatic"] ["signed"|"unsigned"] {packed_dimension} {list_of_variable_decl_assignments} ";"
| "typedef" ...
| "nettype" ...
*/
    private _processRoutineVarDeclaration() {
        let _currTokenNum = this._currTokenNum;
        let scopeDepth: number = this._svtokens[this._currTokenNum].scopes.length - 1;

        this._printDebugInfo("var declaration");
        let startToken: number;
        let prevToken: number;
        let prevIdToken: number;
        let anonTypeName: string;
        let dataTypeToken: number;
        let waitForEnd: Boolean = false;
        let symbolPushed: Boolean = false;
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
                    if (["assign", "unique", "unique0", "priority", "case", "casex", "casez", "if", "void", "disable",
                         "forever", "repeat", "while", "for", "do", "foreach", "return", "break", "continue", "fork",
                         "begin", "wait", "wait_order", "assert", "assume", "cover", "restrict", "randcase", "randsequence",
                         "expect"].indexOf(this._svtokens[startToken].text) >= 0) {
                        this._currTokenNum = _currTokenNum;
                        return false;
                    }
                }

                if ((scope == "operator.comma.systemverilog") ||
                    (scope == "operator.semicolon.systemverilog")) {
                    waitForEnd = false;
                    if ((prevIdToken != undefined) && (startToken != undefined)) {
                        if (prevIdToken == startToken) {
                            this._currTokenNum = _currTokenNum;
                            return false;
                        }
                        let types: string[] = ["variable", anonTypeName || (dataTypeToken == undefined ? this._svtokens[startToken].text : this._svtokens[dataTypeToken].text)];
                        this._pushSymbol(prevIdToken, types, [startToken, prevToken]); //TBD range
                        symbolPushed = true;
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
                    else if (scope == "operator.open_bracket.systemverilog") {
                        if (!this._processDimension()) {
                            this._currTokenNum = _currTokenNum;
                            return false;
                        }
                    }
                    else if ((scope == "operator.other.systemverilog") && (this._svtokens[this._currTokenNum].text == "#")) {
                        if (!this._processParamPortDeclaration()) {
                            this._currTokenNum = _currTokenNum;
                            return false;
                        }
                    }
                    else if (symbolPushed) {
                        this._ignoreTillSemiColon();
                        return true;
                    }
                    else {
                        this._currTokenNum = _currTokenNum;
                        return false;
                    }
                }
                prevToken = this._currTokenNum;
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
        }

        return true;
    }

    private _processRoutineBody() {
        this._currTokenNum++;
        for(; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
            let scope:string = this._getElem(this._svtokens[this._currTokenNum].scopes);
            if (this._notIgnorableScope()) {
                //ConnectionLogger.log(`DEBUG: Routine body parsing at ${this._svtokens[this._currTokenNum].text}`);
                if ((scope == "identifier.simple.systemverilog") &&
                    ((this._svtokens[this._currTokenNum].text == "endfunction") || (this._svtokens[this._currTokenNum].text == "endtask"))) {
                    this._containerStack.pop(this._getEndPosition());
                    break;
                }

                if (!this._processRoutineVarDeclaration() &&
                    !this._processParamDeclaration()) {
                    //ConnectionLogger.log(`DEBUG: Routine ignoring statement at ${this._svtokens[this._currTokenNum].text}`);
                    this._currTokenNum--;
                    this._ignoreStatement();
                    continue;
                }
            }
        }
        if (this._currTokenNum == this._svtokens.length) {
            this._currTokenNum--;
        }
        else {
            this._processEndIdentifier();
        }
    }

    private _processRoutine(): Boolean {
        let startToken: number = this._currTokenNum;
        let scopeDepth: number = this._svtokens[startToken].scopes.length - 1;
        if (this._svtokens[startToken].scopes[scopeDepth] != "keyword.routine.systemverilog") {
            return false;
        }

        this._printDebugInfo("routine");
        this._processRoutineHeader();
        this._processRoutineBody();

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
                            this._containerStack.pop(this._getEndPosition());
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
            this._containerStack.pop(this._getEndPosition());
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
                        //let anonTypeName: string = this._processStructUnionDeclaration();
                        this._processStructUnionDeclaration();
                        continue;
                    }
                    else if (scope == "keyword.enum.systemverilog") {
                        //let anonTypeName: string = this._processEnumDeclaration();
                        this._processEnumDeclaration();
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

        this._containerStack.pop(this._getEndPosition());
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
            if (this._currTokenNum == this._svtokens.length) {
                this._currTokenNum--;
            }
            this._containerStack.pop(this._getEndPosition());
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
        //let _currTokenNum = this._currTokenNum;
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
                //let scope: string = this._getElem(this._svtokens[this._currTokenNum].scopes, scopeDepth);
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

        //let [isInstance, type]: [Boolean, string] = this._isInstance();
        let isInstance: Boolean = this._isInstance()[0];
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
                    waitForEnd = false;
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
                 userDefinesMacroInfo: Map<string, MacroInfo>, _precision: string="full", _maxDepth: number=-1, text?: string): [SystemVerilogParser.SystemVerilogFileSymbolsInfo, string[]] {
        try {
            this._document = document;
            this._documentPath = uriToPath(document.uri);
            this._includeCache = includeCache;
            this._fileSymbolsInfo = {};
            let preprocSymbols: SystemVerilogSymbol[];
            [this._svtokens, this._tokenOrder, preprocSymbols] = this.tokenize(text || this._document.getText(), includeFilePaths, userDefinesMacroInfo);
            if (preprocSymbols.length > 0) {
                this._fileSymbolsInfo.symbolsInfo = preprocSymbols;
            }
            this._containerStack = new ContainerStack(this._fileSymbolsInfo);
            this._currTokenNum = 0;

            for (; this._currTokenNum < this._svtokens.length; this._currTokenNum++) {
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
        } catch(error) {
            ConnectionLogger.error(error);
            return [{}, []];
        }
    }

    public static includeCacheToJSON(includeCache: Map<string, [string, PreprocIncInfo, TextDocument]>) {
        try {
            return Array.from(includeCache.entries()).map(e => [e[0], [e[1][0], SystemVerilogPreprocessor.preprocIncInfoToJSON(e[1][1]), e[1][2]]]);
        } catch (error) {
            ConnectionLogger.error(error);
            return new Map();
        }
    }

    public static includeCacheFromJSON(includeCacheJSON): Map<string, [string, PreprocIncInfo, TextDocument]> {
        try {
            return new Map(includeCacheJSON.map(e => [e[0], [e[1][0], SystemVerilogPreprocessor.preprocIncInfoFromJSON(e[0], e[1][1]), TextDocument.create(e[1][2]._uri, e[1][2]._languageId, e[1][2]._version, e[1][2]._content)]]));
        } catch(error) {
            ConnectionLogger.error(error);
            return new Map();
        }
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

    export type SystemVerilogPosition = { file?: string, line: number, character: number };
    export type SystemVerilogSymbolInfo = SystemVerilogSymbol;
    export type SystemVerilogImportInfo = [string, string[]];
    export type SystemVerilogExportInfo = [string, string[]];
    export type SystemVerilogIncludeInfo = string;
    export type SystemVerilogSymbolsInfo = SystemVerilogSymbolInfo[];
    export type SystemVerilogImportsInfo = SystemVerilogImportInfo[];
    export type SystemVerilogExportsInfo = SystemVerilogExportInfo[];
    export type SystemVerilogContainerSymbolsInfo = {
        symbolsInfo?: SystemVerilogSymbolsInfo,
        importsInfo?: SystemVerilogImportsInfo,
        containersInfo?: SystemVerilogContainersInfo,
        exportsInfo?: SystemVerilogExportsInfo
    };
    export type SystemVerilogContainerInfo = { symbol: SystemVerilogSymbol, position: SystemVerilogPosition, info: SystemVerilogContainerSymbolsInfo};
    export type SystemVerilogContainersInfo = SystemVerilogContainerInfo[];
    export type SystemVerilogIncludesInfo = SystemVerilogIncludeInfo[];
    export type SystemVerilogFileSymbolsInfo = {
        containersInfo?: SystemVerilogContainersInfo,
        includesInfo?: SystemVerilogIncludesInfo,
        symbolsInfo?: SystemVerilogSymbolsInfo,
        importsInfo?: SystemVerilogImportsInfo,
        exportsInfo?: SystemVerilogExportsInfo
    };

    export type SystemVerilogPositionJSON = [number, number]|[string, [number, number]];
    export type SystemVerilogSymbolInfoJSON = SystemVerilogSymbolJSON;
    export type SystemVerilogSymbolsInfoJSON = SystemVerilogSymbolInfoJSON[];
    export type SystemVerilogContainerSymbolsInfoJSON = (SystemVerilogSymbolsInfoJSON|SystemVerilogImportsInfo|SystemVerilogContainersInfoJSON|SystemVerilogExportsInfo)[];
    export type SystemVerilogContainerInfoJSON = [[SystemVerilogSymbolJSON, SystemVerilogPositionJSON], SystemVerilogContainerSymbolsInfoJSON];
    export type SystemVerilogContainersInfoJSON = SystemVerilogContainerInfoJSON[];
    export type SystemVerilogFileSymbolsInfoJSON = (SystemVerilogContainersInfoJSON|SystemVerilogIncludesInfo|SystemVerilogSymbolsInfoJSON|SystemVerilogImportsInfo|SystemVerilogExportsInfo)[];

    export function fileTopSymbols(fileSymbolsInfo: SystemVerilogFileSymbolsInfo, strict: Boolean = false): SystemVerilogSymbol[] {
        try {
            let symbols: SystemVerilogSymbol[] = [];

            if ((fileSymbolsInfo.symbolsInfo != undefined) &&
                (fileSymbolsInfo.symbolsInfo.length > 0)) {
                let topSymbols: SystemVerilogSymbolsInfo = fileSymbolsInfo.symbolsInfo.filter(sym => { return !sym.name.startsWith('#'); });
                if (strict) {
                    symbols = symbols.concat(topSymbols.filter(sym => { return Range.is(sym.symLocation); }));
                }
                else {
                    symbols = symbols.concat(topSymbols);
                }
            }

            return symbols;
        } catch(error) {
            ConnectionLogger.error(error);
            return [];
        }
    }

    export function fileContainers(fileSymbolsInfo: SystemVerilogFileSymbolsInfo): SystemVerilogContainersInfo {
        try {
            if ((fileSymbolsInfo.containersInfo != undefined) &&
                (fileSymbolsInfo.containersInfo.length > 0)) {
                return fileSymbolsInfo.containersInfo;
            }
            return [];
        } catch(error) {
            ConnectionLogger.error(error);
            return [];
        }
    }

    export function fileAllSymbols(fileSymbolsInfo: SystemVerilogFileSymbolsInfo, strict: Boolean = true): SystemVerilogSymbol[] {
        try {
            let symbols: SystemVerilogSymbol[] = fileTopSymbols(fileSymbolsInfo, strict);

            if ((fileSymbolsInfo.containersInfo != undefined) &&
                (fileSymbolsInfo.containersInfo.length > 0)) {
                for (let containerInfo of fileSymbolsInfo.containersInfo) {
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
        } catch(error) {
            ConnectionLogger.error(error);
            return [];
        }
    }

    export function containerAllContainers(containerSymbolsInfo: SystemVerilogContainerSymbolsInfo): SystemVerilogSymbol[] {
        try {
            let symbols: SystemVerilogSymbol[] = [];

            if (containerSymbolsInfo.containersInfo != undefined) {
                for (let container of containerSymbolsInfo.containersInfo) {
                    if (!container.symbol.name.startsWith('#')) {
                        symbols.push(container.symbol);
                    }
                    symbols = symbols.concat(containerAllContainers(container.info));
                }
            }

            return symbols;
        } catch(error) {
            ConnectionLogger.error(error);
            return [];
        }
    }

    export function containerContainers(containerInfo: SystemVerilogContainerInfo): SystemVerilogContainersInfo {
        try {
            if ((containerInfo.info.containersInfo != undefined) &&
                (containerInfo.info.containersInfo.length > 0)) {
                return containerInfo.info.containersInfo;
            }
            return [];
        } catch(error) {
            ConnectionLogger.error(error);
            return [];
        }
    }

    export function containerTopSymbols(containerInfo: SystemVerilogContainerInfo): SystemVerilogSymbol[] {
        try {
            let symbols: SystemVerilogSymbol[] = [containerInfo.symbol];
            if ((containerInfo.info.symbolsInfo != undefined) &&
                (containerInfo.info.symbolsInfo.length > 0)) {
                symbols = symbols.concat(containerInfo.info.symbolsInfo);
            }
            return symbols;
        } catch(error) {
            ConnectionLogger.error(error);
            return [];
        }
    }

    export function containerAllSymbols(containerInfo: SystemVerilogContainerInfo, topOnly: boolean = false): SystemVerilogSymbol[] {
        try {
            let symbols: SystemVerilogSymbol[] = [];

            if (!containerInfo.symbol.name.startsWith('#') && !topOnly) {
                symbols.push(containerInfo.symbol);
            }

            if ((containerInfo.info.symbolsInfo != undefined) &&
                (containerInfo.info.symbolsInfo.length > 0)) {
                let cntnrSymbols: SystemVerilogSymbol[] = containerInfo.info.symbolsInfo;
                symbols = symbols.concat(cntnrSymbols.filter(sym => { return !sym.name.startsWith('#'); }));
            }

            if ((containerInfo.info.containersInfo != undefined) &&
                (containerInfo.info.containersInfo.length > 0)) {
                for (let childContainerInfo of containerInfo.info.containersInfo) {
                    if (topOnly) {
                        symbols.push(childContainerInfo.symbol);
                    }
                    else {
                        symbols = symbols.concat(containerAllSymbols(childContainerInfo));
                    }
                }
            }

            return symbols;
        } catch(error) {
            ConnectionLogger.error(error);
            return [];
        }
    }

    export function fileAllContainers(fileSymbolsInfo: SystemVerilogFileSymbolsInfo): SystemVerilogSymbol[] {
        try {
            let symbols: SystemVerilogSymbol[] = [];

            if (fileSymbolsInfo.containersInfo != undefined) {
                for (let container of fileSymbolsInfo.containersInfo) {
                    if (!container.symbol.name.startsWith('#')) {
                        symbols.push(container.symbol);
                    }
                    symbols = symbols.concat(containerAllContainers(container.info));
                }
            }

            return symbols;
        } catch(error) {
            ConnectionLogger.error(error);
            return [];
        }
    }

    export function findFileContainer(fileSymbolsInfo: SystemVerilogFileSymbolsInfo, cntnrName: string): SystemVerilogContainerInfo {
        try {
            if (fileSymbolsInfo.containersInfo != undefined) {
                return fileSymbolsInfo.containersInfo.find(cntnr => { return cntnr.symbol.name == cntnrName; });
            }
            return undefined;
        } catch(error) {
            ConnectionLogger.error(error);
            return undefined;
        }
    }

    export function findContainerSymbol(containerSymbolsInfo: SystemVerilogContainerSymbolsInfo, symbolName: string, findContainer: Boolean): SystemVerilogSymbol | SystemVerilogContainerInfo {
        try {
            if (!findContainer &&
                (containerSymbolsInfo.symbolsInfo != undefined)) {
                let symbol: SystemVerilogSymbol = containerSymbolsInfo.symbolsInfo.find(sym => { return sym.name == symbolName; });
                if (symbol != undefined) {
                    return symbol;
                }
            }

            if (containerSymbolsInfo.containersInfo != undefined) {
                for (let container of containerSymbolsInfo.containersInfo) {
                    if (container.symbol.name == symbolName) {
                        if (findContainer) {
                            return container;
                        }
                        else {
                            return container.symbol;
                        }
                    }

                    if (findContainer) {
                        let subContainerInfo: SystemVerilogContainerInfo = <SystemVerilogContainerInfo>(findContainerSymbol(container.info, symbolName, findContainer));
                        if (subContainerInfo.symbol != undefined) {
                            return subContainerInfo;
                        }
                    }
                    else {
                        let symbol: SystemVerilogSymbol = <SystemVerilogSymbol>(findContainerSymbol(container.info, symbolName, findContainer));
                        if (symbol != undefined) {
                            return symbol;
                        }
                    }
                }
            }

            if (findContainer) {
                return { symbol: undefined, position: undefined, info: {} };
            }
            else {
                return undefined;
            }
        } catch(error) {
            ConnectionLogger.error(error);
            return undefined;
        }
    }

    export function getInstSymbolsInContainer(containerSymbolsInfo: SystemVerilogContainerSymbolsInfo): SystemVerilogSymbol[] {
        try {
            let instSymbols: SystemVerilogSymbol[] = [];
            if (containerSymbolsInfo.symbolsInfo != undefined) {
                instSymbols = containerSymbolsInfo.symbolsInfo.filter(sym => sym.type[0] == "instance");
            }
            return instSymbols;
        } catch(error) {
            ConnectionLogger.error(error);
            return [];
        }
    }

    export function findSymbol(fileSymbolsInfo: SystemVerilogFileSymbolsInfo, symbolName: string, findContainer: Boolean): SystemVerilogSymbol | SystemVerilogContainerInfo {
        try {
            if (!findContainer &&
                (fileSymbolsInfo.symbolsInfo != undefined)) {
                let symbol: SystemVerilogSymbol = fileSymbolsInfo.symbolsInfo.find(sym => { return sym.name == symbolName; });
                if (symbol != undefined) {
                    return symbol;
                }
            }

            if (fileSymbolsInfo.containersInfo != undefined) {
                for (let container of fileSymbolsInfo.containersInfo) {
                    if (container.symbol.name == symbolName) {
                        if (findContainer) {
                            return container;
                        }
                        else {
                            return container.symbol;
                        }
                    }

                    if (findContainer) {
                        let subContainerInfo: SystemVerilogContainerInfo = <SystemVerilogContainerInfo>(findContainerSymbol(container.info, symbolName, findContainer));
                        if (subContainerInfo.symbol != undefined) {
                            return subContainerInfo;
                        }
                    }
                    else {
                        let symbol: SystemVerilogSymbol = <SystemVerilogSymbol>(findContainerSymbol(container.info, symbolName, findContainer));
                        if (symbol != undefined) {
                            return symbol;
                        }
                    }
                }
            }

            if (findContainer) {
                return { symbol: undefined, position: undefined, info: {} };
            }
            else {
                return undefined;
            }
        } catch(error) {
            ConnectionLogger.error(error);
            return undefined;
        }
    }

    export function jsonToPosition(jsonPosition: SystemVerilogParser.SystemVerilogPositionJSON): SystemVerilogPosition {
        let result: SystemVerilogPosition;
        if (typeof jsonPosition[0] === "number") {
            result = { line: jsonPosition[0], character: <number>(jsonPosition[1]) };
        }
        else {
            result = { file: <string>(jsonPosition[0]), line: <number>(jsonPosition[1][0]), character: <number>(jsonPosition[1][1]) };
        }
        return result;
    }

    export function jsonToFileSymbolsInfo(file: string, jsonFileSymbolsInfo: SystemVerilogParser.SystemVerilogFileSymbolsInfoJSON): SystemVerilogFileSymbolsInfo {
        try {
            let fileSymbolsInfo: SystemVerilogFileSymbolsInfo = {};

            if (jsonFileSymbolsInfo.length > FileInfoIndex.Containers) {
                if (jsonFileSymbolsInfo[FileInfoIndex.Containers] != undefined) {
                    fileSymbolsInfo.containersInfo = [];
                    for (let jsonContainerInfo of jsonFileSymbolsInfo[FileInfoIndex.Containers]) {
                        fileSymbolsInfo.containersInfo.push({
                            symbol: SystemVerilogSymbol.fromJSON(file, <SystemVerilogSymbolJSON>(jsonContainerInfo[0][0])),
                            position: jsonToPosition(<SystemVerilogPositionJSON>(jsonContainerInfo[0][1])),
                            info: _jsonToContainerSymbolsInfo(file, <SystemVerilogContainerSymbolsInfoJSON>(jsonContainerInfo[1]))
                        });
                    }
                }
            }

            if (jsonFileSymbolsInfo.length > FileInfoIndex.Includes) {
                fileSymbolsInfo.includesInfo = <SystemVerilogIncludesInfo>(jsonFileSymbolsInfo[FileInfoIndex.Includes]);
            }

            if (jsonFileSymbolsInfo.length > FileInfoIndex.Imports) {
                fileSymbolsInfo.importsInfo = <SystemVerilogImportsInfo>(jsonFileSymbolsInfo[FileInfoIndex.Imports]);
            }

            if (jsonFileSymbolsInfo.length > FileInfoIndex.Exports) {
                fileSymbolsInfo.exportsInfo = <SystemVerilogExportsInfo>(jsonFileSymbolsInfo[FileInfoIndex.Exports]);
            }

            if (jsonFileSymbolsInfo.length > FileInfoIndex.Symbols) {
                if (jsonFileSymbolsInfo[FileInfoIndex.Symbols] != undefined) {
                    fileSymbolsInfo.symbolsInfo = [];
                    for (let symbol of <SystemVerilogSymbolsInfoJSON>(jsonFileSymbolsInfo[FileInfoIndex.Symbols])) {
                        fileSymbolsInfo.symbolsInfo.push(SystemVerilogSymbol.fromJSON(file, symbol));
                    }
                }
            }

            return fileSymbolsInfo;
        } catch(error) {
            ConnectionLogger.error(error);
            return {};
        }
    }

    function _containerSymbolsInfoToJson(containerSymbolsInfo: SystemVerilogParser.SystemVerilogContainerSymbolsInfo): SystemVerilogContainerSymbolsInfoJSON {
        let result: SystemVerilogContainerSymbolsInfoJSON = [];

        if (containerSymbolsInfo.symbolsInfo == undefined) {
            if ((containerSymbolsInfo.importsInfo != undefined) ||
                (containerSymbolsInfo.containersInfo != undefined) ||
                (containerSymbolsInfo.exportsInfo != undefined)) {
                result.push([]);
            }
        }
        else {
            result.push(containerSymbolsInfo.symbolsInfo.map(ci => ci.toJSON()));
        }

        if (containerSymbolsInfo.importsInfo == undefined) {
            if ((containerSymbolsInfo.containersInfo != undefined) ||
                (containerSymbolsInfo.exportsInfo != undefined)) {
                result.push([]);
            }
        }
        else {
            result.push(containerSymbolsInfo.importsInfo);
        }

        if (containerSymbolsInfo.containersInfo == undefined) {
            if (containerSymbolsInfo.exportsInfo != undefined) {
                result.push([]);
            }
        }
        else {
            result.push(containerSymbolsInfo.containersInfo.map(ci => _containerInfoToJson(ci)));
        }

        if (containerSymbolsInfo.exportsInfo != undefined) {
            result.push(containerSymbolsInfo.exportsInfo);
        }

        return result;
    }

    function _positionToJson(pos: SystemVerilogPosition): SystemVerilogPositionJSON {
        let result: SystemVerilogPositionJSON;
        if (pos.file == undefined) {
            result = [pos.line, pos.character];
        }
        else {
            result = [pos.file, [pos.line, pos.character]];
        }
        return result;
    }

    function _containerInfoToJson(containerInfo: SystemVerilogParser.SystemVerilogContainerInfo): SystemVerilogContainerInfoJSON {
        return [[containerInfo.symbol.toJSON(), _positionToJson(containerInfo.position)], _containerSymbolsInfoToJson(containerInfo.info)];
    }

    export function fileSymbolsInfoToJson(fileSymbolsInfo: SystemVerilogParser.SystemVerilogFileSymbolsInfo): SystemVerilogFileSymbolsInfoJSON {
        try {
            let fileSymbolsInfoJson: SystemVerilogFileSymbolsInfoJSON = [];

            if ((fileSymbolsInfo.containersInfo != undefined) ||
                (fileSymbolsInfo.includesInfo != undefined) ||
                (fileSymbolsInfo.importsInfo != undefined) ||
                (fileSymbolsInfo.exportsInfo != undefined) ||
                (fileSymbolsInfo.symbolsInfo != undefined)) {
                if (fileSymbolsInfo.containersInfo != undefined) {
                    fileSymbolsInfoJson.push(fileSymbolsInfo.containersInfo.map(ci => _containerInfoToJson(ci)));
                }
                else {
                    fileSymbolsInfoJson.push(undefined);
                }
            }

            if ((fileSymbolsInfo.includesInfo != undefined) ||
                (fileSymbolsInfo.importsInfo != undefined) ||
                (fileSymbolsInfo.exportsInfo != undefined) ||
                (fileSymbolsInfo.symbolsInfo != undefined)) {
                if (fileSymbolsInfo.includesInfo != undefined) {
                    fileSymbolsInfoJson.push(fileSymbolsInfo.includesInfo);
                }
                else {
                    fileSymbolsInfoJson.push(undefined);
                }
            }

            if ((fileSymbolsInfo.importsInfo != undefined) ||
                (fileSymbolsInfo.exportsInfo != undefined) ||
                (fileSymbolsInfo.symbolsInfo != undefined)) {
                if (fileSymbolsInfo.importsInfo != undefined) {
                    fileSymbolsInfoJson.push(fileSymbolsInfo.importsInfo);
                }
                else {
                    fileSymbolsInfoJson.push(undefined);
                }
            }

            if ((fileSymbolsInfo.exportsInfo != undefined) ||
                (fileSymbolsInfo.symbolsInfo != undefined)) {
                if (fileSymbolsInfo.exportsInfo != undefined) {
                    fileSymbolsInfoJson.push(fileSymbolsInfo.exportsInfo);
                }
                else {
                    fileSymbolsInfoJson.push(undefined);
                }
            }

            if (fileSymbolsInfo.symbolsInfo != undefined) {
                if (fileSymbolsInfo.symbolsInfo != undefined) {
                    fileSymbolsInfoJson.push(fileSymbolsInfo.symbolsInfo.map(sym => sym.toJSON()));
                }
                else {
                    fileSymbolsInfoJson.push(undefined);
                }
            }

            return fileSymbolsInfoJson;
        } catch(error) {
            ConnectionLogger.error(error);
            return [];
        }
    }

    export function preprocToFileSymbolsInfo(symbols: SystemVerilogSymbol[], includes?: Set<string>): SystemVerilogFileSymbolsInfo {
        try {
            let fileSymbolsInfo: SystemVerilogFileSymbolsInfo = {};
            fileSymbolsInfo.symbolsInfo = symbols;
            fileSymbolsInfo.includesInfo = includes == undefined ? undefined : [...includes];
            return fileSymbolsInfo;
        } catch(error) {
            ConnectionLogger.error(error);
            return {};
        }
    }

    export function containerImports(containerSymbolsInfo: SystemVerilogContainerSymbolsInfo, topOnly: boolean = false): SystemVerilogImportsInfo {
        try {
            let containerImportsInfo: SystemVerilogImportsInfo = [];

            if (containerSymbolsInfo.importsInfo != undefined) {
                containerImportsInfo = containerSymbolsInfo.importsInfo;
            }

            if (!topOnly && (containerSymbolsInfo.containersInfo != undefined)) {
                for (let cntnrInfo of containerSymbolsInfo.containersInfo) {
                    containerImportsInfo = containerImportsInfo.concat(containerImports(cntnrInfo.info));
                }
            }

            return containerImportsInfo;
        } catch(error) {
            ConnectionLogger.error(error);
            return [];
        }
    }

    export function fileAllImports(fileSymbolsInfo: SystemVerilogFileSymbolsInfo): SystemVerilogImportsInfo {
        try {
            let fileImportsInfo: SystemVerilogImportsInfo = [];

            if (fileSymbolsInfo.importsInfo != undefined) {
                fileImportsInfo = fileSymbolsInfo.importsInfo;
            }

            if (fileSymbolsInfo.containersInfo != undefined) {
                for (let cntnrInfo of fileSymbolsInfo.containersInfo) {
                    fileImportsInfo = fileImportsInfo.concat(containerImports(cntnrInfo.info));
                }
            }

            return fileImportsInfo;
        } catch(error) {
            ConnectionLogger.error(error);
            return [];
        }
    }

    export function containerExports(containerSymbolsInfo: SystemVerilogContainerSymbolsInfo): SystemVerilogExportsInfo {
        try {
            let containerExportsInfo: SystemVerilogExportsInfo = [];

            if (containerSymbolsInfo.exportsInfo != undefined) {
                containerExportsInfo = containerSymbolsInfo.exportsInfo;
            }

            if (containerSymbolsInfo.containersInfo != undefined) {
                for (let cntnrInfo of containerSymbolsInfo.containersInfo) {
                    containerExportsInfo = containerExportsInfo.concat(containerExports(cntnrInfo.info));
                }
            }

            return containerExportsInfo;
        } catch(error) {
            ConnectionLogger.error(error);
            return [];
        }
    }
}
