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
    PostToken,
    PreprocCacheEntry,
    PreprocIncInfo,
    PreprocInfo,
    SystemVerilogPreprocessor,
    TokenOrderEntry
} from "./svpreprocessor";

import {
    svIndexParser,
    svIndexParserInitSubscribers,
    visitAllNodes,
    visitLeafNodes,
} from './svparsers_manager';

import {
    SyntaxNode,
    Tree,
    TreeCursor
} from 'web-tree-sitter';

const DEBUG_MODE: number = 0;
const fs = require('fs');

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
        if (jsonContainerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Imports] != undefined) {
            containerSymbolsInfo.importsInfo = [];
            for (let importInfo of <SystemVerilogParser.SystemVerilogImportsInfoJSON>(jsonContainerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Imports])) {
                containerSymbolsInfo.importsInfo.push({pkg: importInfo[0], symbolsText: importInfo[1]});
            }
        }
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
        if (jsonContainerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Exports] != undefined) {
            containerSymbolsInfo.exportsInfo = [];
            for (let exportInfo of <SystemVerilogParser.SystemVerilogExportsInfoJSON>(jsonContainerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Exports])) {
                containerSymbolsInfo.exportsInfo.push({pkg: exportInfo[0], symbolsText: exportInfo[1]});
            }
        }
    }

    return containerSymbolsInfo;
}

type ImportExportEntry = { allIncluded: Boolean, index: number };
type ImportExportMap = Map<string, ImportExportEntry>;

class ContainerStack {
    private _stack: { fileInfo: SystemVerilogParser.SystemVerilogFileSymbolsInfo, containersInfo: SystemVerilogParser.SystemVerilogContainersInfo };
    private _symbolMap: Map<string, number>;
    private _importMap: ImportExportMap;
    private _exportMap: ImportExportMap;

    constructor(fileSymbolsInfo: SystemVerilogParser.SystemVerilogFileSymbolsInfo) {
        this._stack = { fileInfo: fileSymbolsInfo, containersInfo: [] };
        this._symbolMap = new Map();
        this._importMap = new Map();
        this._exportMap = new Map();
    }

    push(symbol: SystemVerilogSymbol): SystemVerilogSymbol {
        let containerSymbols: SystemVerilogParser.SystemVerilogContainersInfo;
        if (this._stack.containersInfo.length <= 0) {
            if (this._stack.fileInfo.containersInfo == undefined) {
                this._stack.fileInfo.containersInfo = [];
            }
            containerSymbols = this._stack.fileInfo.containersInfo;
        }
        else {
            let containerSymbolsInfo: SystemVerilogParser.SystemVerilogContainerSymbolsInfo = this._stack.containersInfo[this._stack.containersInfo.length - 1].info;
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

        this._stack.containersInfo.push(containerInfo);
        return resSymbol;
    }

    pushSymbol(symbol: SystemVerilogSymbol): SystemVerilogSymbol {
        let symbols: SystemVerilogParser.SystemVerilogSymbolsInfo;
        if (this._stack.containersInfo.length <= 0) {
            if (this._stack.fileInfo.symbolsInfo == undefined) {
                this._stack.fileInfo.symbolsInfo = [];
            }
            symbols = this._stack.fileInfo.symbolsInfo;
        }
        else {
            let containerSymbolsInfo: SystemVerilogParser.SystemVerilogContainerSymbolsInfo = this._stack.containersInfo[this._stack.containersInfo.length - 1].info;
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
        if (this._stack.containersInfo.length <= 0) {
            return undefined;
        }
        return this._stack.containersInfo[this._stack.containersInfo.length - 1].symbol.getSymbolDocumentPath(uri);
    }

    pop(endPosition?: SystemVerilogParser.SystemVerilogPosition) {
        if (this._stack.containersInfo.length <= 0) {
            ConnectionLogger.error(`ContainerStack is already empty!`);
            return;
        }
        this._stack.containersInfo[this._stack.containersInfo.length - 1].position = endPosition;
        this._stack.containersInfo.pop();
    }

    toStringList(): string[] {
        return this._stack.containersInfo.map(e => e.symbol.name);
    }

    pushImportItemParts(pkgName: string, importName: string) {
        let importHierPath: string = [pkgName, ...this.toStringList()].join(' ');
        if (!this._importMap.has(importHierPath)) {
            this._importMap.set(importHierPath, { allIncluded: false, index: undefined });
        }

        let importInfo: ImportExportEntry = this._importMap.get(importHierPath);
        if (importInfo.allIncluded) {
            return;
        }

        let importsInfo: SystemVerilogParser.SystemVerilogImportsInfo;
        if (this._stack.containersInfo.length <= 0) {
            if (this._stack.fileInfo.importsInfo == undefined) {
                this._stack.fileInfo.importsInfo = [];
            }
            importsInfo = this._stack.fileInfo.importsInfo;
        }
        else {
            let containerSymbolsInfo: SystemVerilogParser.SystemVerilogContainerSymbolsInfo = this._stack.containersInfo[this._stack.containersInfo.length - 1].info;
            if (containerSymbolsInfo.importsInfo == undefined) {
                containerSymbolsInfo.importsInfo = [];
            }
            importsInfo = containerSymbolsInfo.importsInfo;
        }

        if (importInfo.index == undefined) {
            importInfo.index = importsInfo.length;
            importsInfo.push({ pkg: pkgName, symbolsText: [] });
        }

        if (importName == "*") {
            importInfo.allIncluded = true;
            importsInfo[importInfo.index].symbolsText = ["*"];
        }
        else {
            importsInfo[importInfo.index].symbolsText.push(importName);
        }
    }

    pushImportItem(importItemToken: ParseToken) {
        let importParts: string[] = importItemToken.text.split('::');
        this.pushImportItemParts(importParts[0], importParts[1]);
    }

    pushExportItemParts(pkgName: string, exportName: string) {
        let exportHierPath: string = [pkgName, ...this.toStringList()].join(' ');
        if (!this._exportMap.has(exportHierPath)) {
            this._exportMap.set(exportHierPath, { allIncluded: false, index: undefined });
        }
        else if (pkgName == "*") {
            return;
        }

        if (pkgName == "*") {
            if (this._stack.containersInfo.length <= 0) {
                this._stack.fileInfo.exportsInfo = [{pkg: pkgName, symbolsText: ["*"] }];
            }
            else {
                this._stack.containersInfo[this._stack.containersInfo.length - 1].info.exportsInfo = [{pkg: pkgName, symbolsText: ["*"] }];
            }
            return;
        }

        let exportInfo: ImportExportEntry = this._exportMap.get(exportHierPath);
        if (exportInfo.allIncluded) {
            return;
        }

        let exportsInfo: SystemVerilogParser.SystemVerilogExportsInfo;
        if (this._stack.containersInfo.length <= 0) {
            if (this._stack.fileInfo.exportsInfo == undefined) {
                this._stack.fileInfo.exportsInfo = [];
            }
            exportsInfo = this._stack.fileInfo.exportsInfo;
        }
        else {
            let containerSymbolsInfo: SystemVerilogParser.SystemVerilogContainerSymbolsInfo = this._stack.containersInfo[this._stack.containersInfo.length - 1].info;
            if (containerSymbolsInfo.exportsInfo == undefined) {
                containerSymbolsInfo.exportsInfo = [];
            }
            exportsInfo = containerSymbolsInfo.exportsInfo;
        }

        if (exportInfo.index == undefined) {
            exportInfo.index = exportsInfo.length;
            exportsInfo.push({ pkg: pkgName, symbolsText: [] });
        }

        if (exportName == "*") {
            exportInfo.allIncluded = true;
            exportsInfo[exportInfo.index].symbolsText = ["*"];
        }
        else {
            exportsInfo[exportInfo.index].symbolsText.push(exportName);
        }
    }

    pushExportItem(exportItemToken: ParseToken) {
        let exportParts: string[] = exportItemToken.text.split('::');
        this.pushExportItemParts(exportParts[0], exportParts[1]);
    }
}

type SystemVerilogIndexParserParseArgs = { postText: string, document: TextDocument, preprocCache: Map<string, PreprocCacheEntry>, postTokens: PostToken[], tokenOrder: TokenOrderEntry[] }; //TMP

export class SystemVerilogParser {
    private _completionGrammarEngine: GrammarEngine = new GrammarEngine(svcompletion_grammar, "meta.invalid.systemverilog");
    private _anonStructUnionCount: number = 0;
    private _anonEnumCount: number = 0;

    private _document: TextDocument;
    private _documentPath: string;
    private _preprocCache: Map<string, PreprocCacheEntry>;
    private _fileSymbolsInfo: SystemVerilogParser.SystemVerilogFileSymbolsInfo;
    private _svtokens: ParseToken[];
    private _tokenOrder: TokenOrderEntry[];
    private _containerStack: ContainerStack;
    private _currTokenNum: number;
    private _svIndexParserParseArgs: SystemVerilogIndexParserParseArgs; //TMP

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

    public tokenize(_text: string, includeFilePaths: string[], userDefinesMacroInfo: Map<string, MacroInfo>): [ParseToken[], TokenOrderEntry[], SystemVerilogSymbol[]] {
        try {
            let preprocParser: SystemVerilogPreprocessor = new SystemVerilogPreprocessor();
            let preprocInfo: PreprocInfo = preprocParser.parse(this._document, includeFilePaths, this._preprocCache, userDefinesMacroInfo);

            if (preprocInfo.includes.size > 0) {
                this._fileSymbolsInfo.includesInfo = [...preprocInfo.includes];
            }

            let postText: string = preprocInfo.postTokens.map(tok => tok.text).join('');
            this._svIndexParserParseArgs = { postText: postText, document: this._document, preprocCache: this._preprocCache, postTokens: preprocInfo.postTokens, tokenOrder: preprocInfo.tokenOrder }; //TMP
            let tokens: GrammarToken[] = this._completionGrammarEngine.tokenize(postText);
            let parseTokens: ParseToken[] = tokens.map(token => { return {text: token.text, scopes: token.scopes, startTokenIndex: undefined, endTokenIndex: undefined}; });
            let tokenOrder: TokenOrderEntry[] = [];
            let currParseToken: number = 0;
            let tokenText: string = "";
            let tokenOrderIndex: number = 0;
            let tokenOrderFile: string;
            for (let i: number = 0; i < preprocInfo.postTokens.length; i++) {
                if ((tokenOrderIndex < preprocInfo.tokenOrder.length) &&
                    (preprocInfo.tokenOrder[tokenOrderIndex].tokenNum == i)) {
                    if ((tokenText != "") && (parseTokens[currParseToken].text.trim() != "")) {
                        ConnectionLogger.error(`assumption about tokens not split across files might be broken for ${this._documentPath} at ${preprocInfo.tokenOrder[tokenOrderIndex].tokenNum}`);
                    }
                    tokenOrderFile = preprocInfo.tokenOrder[tokenOrderIndex].file;
                    tokenOrderIndex++;
                }

                if (tokenText == "") {
                    parseTokens[currParseToken].startTokenIndex = preprocInfo.postTokens[i].index;
                    if (tokenOrderFile != undefined) {
                        tokenOrder.push({ file: tokenOrderFile, tokenNum: currParseToken });
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
            if (token >= this._tokenOrder[i].tokenNum) {
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
        while ((tokenOrderIndex < this._tokenOrder.length) && (endToken >= this._tokenOrder[tokenOrderIndex].tokenNum)) {
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
                document.positionAt(this._svtokens[this._tokenOrder[tokenOrderIndices[i]].tokenNum - 1].endTokenIndex + 1)
            ));
            currToken = this._tokenOrder[tokenOrderIndices[i]].tokenNum;
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
            file = this._tokenOrder[tokenOrderIndex].file;
        }

        if (file == this._documentPath) {
            document = this._document;
        }
        else {
            let shortFile: string;
            for (let [sfile, fileInfo] of this._preprocCache) {
                if (fileInfo.file == file) {
                    shortFile = sfile;
                    break;
                }
            }
            if (shortFile) {
                document = this._preprocCache.get(shortFile).doc;
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
            //if (this._document.uri.endsWith("/i2c_wrapper.sv") && (containerSymbol.type[0] == "module")) {
            //    ConnectionLogger.log(`DEBUG: old module ${containerSymbol.name} json symbol = ${containerSymbol.toJSON()}`);
            //}
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

                if (!this._processPortDeclaration() &&
                    !this._processTypeDef() &&
                    !this._processRoutineVarDeclaration() &&
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
                        memberSymbol.defLocations = this._getDefLocations(startToken, this._currTokenNum);
                        memberToken = undefined;
                    }
                    else {
                        memberSymbol = this._pushSymbol(prevIdToken, ["struct_union_member"], [startToken, this._currTokenNum]);
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
            if (!this._processEndIdentifier()) {
                this._currTokenNum--;
            }
            if (this._currTokenNum == this._svtokens.length) {
                this._currTokenNum--;
            }
            this._containerStack.pop(this._getEndPosition());
            this._currTokenNum++;
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
                        this._pushSymbol(prevIdToken, types, [portTypeToken, prevToken]);
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

    public parse(document: TextDocument, includeFilePaths: string[], preprocCache: Map<string, PreprocCacheEntry>,
                 userDefinesMacroInfo: Map<string, MacroInfo>, _precision: string="full", _maxDepth: number=-1, text?: string): [SystemVerilogParser.SystemVerilogFileSymbolsInfo, string[]] {
        try {
            this._document = document;
            this._documentPath = uriToPath(document.uri);
            this._preprocCache = preprocCache;
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

    public static preprocCacheToJSON(preprocCache: Map<string, PreprocCacheEntry>) {
        try {
            return Array.from(preprocCache.entries()).map(e => [e[0], [e[1].file, SystemVerilogPreprocessor.preprocIncInfoToJSON(e[1].info), e[1].doc]]);
        } catch (error) {
            ConnectionLogger.error(error);
            return new Map();
        }
    }

    public static preprocCacheFromJSON(preprocCacheJSON): Map<string, PreprocCacheEntry> {
        try {
            return new Map(preprocCacheJSON.map(e => [e[0], { file: e[1][0], info: SystemVerilogPreprocessor.preprocIncInfoFromJSON(e[0], e[1][1]), doc: TextDocument.create(e[1][2]._uri, e[1][2]._languageId, e[1][2]._version, e[1][2]._content) }]));
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
    export type SystemVerilogImportInfo = { pkg: string, symbolsText: string[] };
    export type SystemVerilogExportInfo = { pkg: string, symbolsText: string[] };
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
    export type SystemVerilogImportInfoJSON = [string, string[]];
    export type SystemVerilogExportInfoJSON = [string, string[]];
    export type SystemVerilogImportsInfoJSON = SystemVerilogImportInfoJSON[];
    export type SystemVerilogExportsInfoJSON = SystemVerilogExportInfoJSON[];
    export type SystemVerilogSymbolsInfoJSON = SystemVerilogSymbolInfoJSON[];
    export type SystemVerilogContainerSymbolsInfoJSON = (SystemVerilogSymbolsInfoJSON|SystemVerilogImportsInfoJSON|SystemVerilogContainersInfoJSON|SystemVerilogExportsInfoJSON)[];
    export type SystemVerilogContainerInfoJSON = [[SystemVerilogSymbolJSON, SystemVerilogPositionJSON], SystemVerilogContainerSymbolsInfoJSON];
    export type SystemVerilogContainersInfoJSON = SystemVerilogContainerInfoJSON[];
    export type SystemVerilogFileSymbolsInfoJSON = (SystemVerilogContainersInfoJSON|SystemVerilogIncludesInfo|SystemVerilogSymbolsInfoJSON|SystemVerilogImportsInfoJSON|SystemVerilogExportsInfoJSON)[];

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
                if (jsonFileSymbolsInfo[FileInfoIndex.Imports] != undefined) {
                    fileSymbolsInfo.importsInfo = [];
                    for (let importInfo of <SystemVerilogImportsInfoJSON>(jsonFileSymbolsInfo[FileInfoIndex.Imports])) {
                        fileSymbolsInfo.importsInfo.push({ pkg: importInfo[0], symbolsText: importInfo[1] });
                    }
                }
            }

            if (jsonFileSymbolsInfo.length > FileInfoIndex.Exports) {
                if (jsonFileSymbolsInfo[FileInfoIndex.Exports] != undefined) {
                    fileSymbolsInfo.exportsInfo = [];
                    for (let exportInfo of <SystemVerilogExportsInfoJSON>(jsonFileSymbolsInfo[FileInfoIndex.Exports])) {
                        fileSymbolsInfo.exportsInfo.push({ pkg: exportInfo[0], symbolsText: exportInfo[1] });
                    }
                }
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
            result.push(containerSymbolsInfo.importsInfo.map(im => [im.pkg, im.symbolsText]));
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
            result.push(containerSymbolsInfo.exportsInfo.map(ex => [ex.pkg, ex.symbolsText]));
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
                    const importsInfoJSON: SystemVerilogImportsInfoJSON = fileSymbolsInfo.importsInfo.map(im => [im.pkg, im.symbolsText]);
                    fileSymbolsInfoJson.push(importsInfoJSON);
                }
                else {
                    fileSymbolsInfoJson.push(undefined);
                }
            }

            if ((fileSymbolsInfo.exportsInfo != undefined) ||
                (fileSymbolsInfo.symbolsInfo != undefined)) {
                if (fileSymbolsInfo.exportsInfo != undefined) {
                    const exportsInfoJSON: SystemVerilogExportsInfoJSON = fileSymbolsInfo.exportsInfo.map(ex => [ex.pkg, ex.symbolsText]);
                    fileSymbolsInfoJson.push(exportsInfoJSON);
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

type MyTreeCursor = { currentNode: SyntaxNode };
type SyntaxLeafNodeRange = { startIndex: number, endIndex: number, node: SyntaxNode | null };
type IndexFileInfo = { startIndex: number, file: string };
type SyntaxNodeRangeMap = { startIndexMap: Map<number, number>, endIndexMap: Map<number, number>, indexFileRanges: IndexFileInfo[] };
type SymbolDefinitionRange = { startSynNode: SyntaxNode, endSynNode: SyntaxNode };

export class SystemVerilogIndexParser {
    private static readonly S_ALWAYS_CONSTRUCT: string = "always_construct";
    private static readonly S_ANONYMOUS_PROGRAM: string = "anonymous_program";
    private static readonly S_ANSI_OR_NONANSI_PORT_DECLARATION: string = "ansi_or_nonansi_port_declaration";
    private static readonly S_ARRAY_IDENTIFIER: string = "array_identifier";
    private static readonly S_ASSERTION_ITEM: string = "assertion_item";
    private static readonly S_ASSERTION_ITEM_DECLARATION: string = "assertion_item_declaration";
    private static readonly S_ATTRIBUTE_INSTANCE: string = "attribute_instance";
    private static readonly S_BASE_GRAMMAR: string = "base_grammar";
    private static readonly S_BASE_MODULE_OR_GENERATE_ITEM_STATEMENT: string = "base_module_or_generate_item_statement";
    private static readonly S_BASE_STATEMENT: string = "base_statement";
    private static readonly S_BEGIN_KEYWORD: string = "begin_keyword";
    private static readonly S_BIND_DIRECTIVE: string = "bind_directive";
    private static readonly S_BLOCK_ITEM_DECLARATION: string = "block_item_declaration";
    private static readonly S_CASE_GENERATE_CONSTRUCT: string = "case_generate_construct";
    private static readonly S_CHECKER_DECLARATION: string = "checker_declaration";
    private static readonly S_CHANDLE_KEYWORD: string = "chandle_keyword";
    private static readonly S_CLASS_DECLARATION: string = "class_declaration";
    private static readonly S_CLASS_KEYWORD: string = "class_keyword";
    private static readonly S_CLASS_SCOPE: string = "class_scope";
    private static readonly S_CLASS_TYPE: string = "class_type";
    private static readonly S_CLOCKING_DECLARATION: string = "clocking_declaration";
    private static readonly S_CLOSE_CURLY_BRACES: string = 'close_curly_braces';
    private static readonly S_CLOSE_PARANTHESES: string = 'close_parantheses';
    private static readonly S_CLOSE_SQUARE_BRACKETS: string = 'close_square_brackets';
    private static readonly S_COLON_OPERATOR: string = 'colon_operator';
    private static readonly S_COMMA_OPERATOR: string = "comma_operator";
    private static readonly S_COMMENT: string = "comment";
    private static readonly S_CONDITIONAL_GENERATE_CONSTRUCT: string = "conditional_generate_construct";
    private static readonly S_CONFIG_DECLARATION: string = "config_declaration";
    private static readonly S_CONST_KEYWORD: string = "const_keyword";
    private static readonly S_CONSTANT_EXPRESSION: string = "constant_expression";
    private static readonly S_CONTINUOUS_ASSIGN: string = "continuous_assign";
    private static readonly S_COVERGROUP_DECLARATION: string = "covergroup_declaration";
    private static readonly S_CURLY_BRACKETS_BLOCK: string = "curly_brackets_block";
    private static readonly S_DATA_TYPE: string = "data_type";
    private static readonly S_DATA_TYPE_OR_VOID: string = "data_type_or_void";
    private static readonly S_DEFAULT_CLOCKING_DECLARATION: string = "default_clocking_declaration";
    private static readonly S_DEFAULT_DISABLE_DECLARATION: string = "default_disable_declaration";
    private static readonly S_DELAY3: string = "delay3";
    private static readonly S_DELAY_VALUE: string = "delay_value";
    private static readonly S_DOUBLE_COLON_OPERATOR: string = "double_colon_operator";
    private static readonly S_DOUBLE_QUOTED_STRING: string = "double_quoted_string";
    private static readonly S_DOT_OPERATOR: string = "dot_operator";
    private static readonly S_DPI_IMPORT_EXPORT: string = "dpi_import_export";
    private static readonly S_EMPTY_PORT_DECLARATION: string = "empty_port_declaration";
    private static readonly S_END_KEYWORD: string = "end_keyword";
    private static readonly S_ENDFUNCTION_DECLARATION: string = "endfunction_declaration";
    private static readonly S_ENDGENERATE_KEYWORD: string = "endgenerate_keyword";
    private static readonly S_ENDINTERFACE_DECLARATION: string = "endinterface_declaration";
    private static readonly S_ENDMODULE_DECLARATION: string = "endmodule_declaration";
    private static readonly S_ENDPACKAGE_DECLARATION: string = "endpackage_declaration";
    private static readonly S_ENDTASK_DECLARATION: string = "endtask_declaration";
    private static readonly S_ENUM_BASE_TYPE: string = "enum_base_type";
    private static readonly S_ENUM_KEYWORD: string = "enum_keyword";
    private static readonly S_ENUM_NAME_DECLARATION: string = "enum_name_declaration";
    private static readonly S_ELSE_KEYWORD: string = "else_keyword";
    private static readonly S_EQUALS_OPERATOR: string = "equals_operator";
    private static readonly S_ESCAPED_IDENTIFIER: string = "escaped_identifier";
    private static readonly S_EVENT_CONTROL_BLOCK: string = "event_control_block";
    private static readonly S_EVENT_KEYWORD: string = "event_keyword";
    private static readonly S_EXPLICIT_DATA_DECLARATION: string = "explicit_data_declaration";
    private static readonly S_EXPLICIT_DATA_INDICATOR: string = "explicit_data_indicator";
    private static readonly S_EXPLICIT_DATA_TYPE: string = "explicit_data_type";
    private static readonly S_EXPORT_KEYWORD: string = "export_keyword";
    private static readonly S_EXPRESSION: string = "expression";
    private static readonly S_EXTERN_CONSTRAINT_DECLARATION: string = "extern_constraint_declaration";
    private static readonly S_EXTERN_KEYWORD: string = "extern_keyword";
    private static readonly S_EXTERN_TF_DECLARATION: string = "extern_tf_declaration";
    private static readonly S_EVENT_CONTROL_OPERATOR: string = "event_control_operator";
    private static readonly S_FINAL_CONSTRUCT: string = "final_construct";
    private static readonly S_FOR_KEYWORD: string = "for_keyword";
    private static readonly S_FUNCTION_BODY_DECLARATION: string = "function_body_declaration";
    private static readonly S_FUNCTION_DECLARATION: string = "function_declaration";
    private static readonly S_FUNCTION_HEADER: string = "function_header";
    private static readonly S_FUNCTION_IDENTIFIER: string = "function_identifier";
    private static readonly S_FUNCTION_KEYWORD: string = "function_keyword";
    private static readonly S_FUNCTION_NON_PORT_HEADER: string = "function_non_port_header";
    private static readonly S_GATE_INSTANTIATION: string = "gate_instantiation";
    private static readonly S_GENERATE_BLOCK: string = "generate_block";
    private static readonly S_GENERATE_ITEM: string = "generate_item";
    private static readonly S_GENERATE_KEYWORD: string = "generate_keyword";
    private static readonly S_GENERATE_REGION: string = "generate_region";
    private static readonly S_GENVAR_DECLARATION: string = "genvar_declaration";
    private static readonly S_GENVAR_INITIALIZATION: string = "genvar_initialization";
    private static readonly S_GENVAR_KEYWORD: string = "genvar_keyword";
    private static readonly S_HASH_OPERATOR: string = "hash_operator";
    private static readonly S_HASH_PARANTHESES_BLOCK: string = "hash_parantheses_block";
    private static readonly S_HIERARCHICAL_IDENTIFIER: string = "hierarchical_identifier";
    private static readonly S_IDENTIFIER: string = "identifier";
    private static readonly S_IF_GENERATE_CONSTRUCT: string = "if_generate_construct";
    private static readonly S_IF_KEYWORD: string = "if_keyword";
    private static readonly S_IMPORT_KEYWORD: string = "import_keyword";
    private static readonly S_INITIAL_CONSTRUCT: string = "initial_construct";
    private static readonly S_INOUT_DECLARATION: string = "inout_declaration";
    private static readonly S_INOUT_KEYWORD: string = "inout_keyword";
    private static readonly S_INPUT_DECLARATION: string = "input_declaration";
    private static readonly S_INPUT_KEYWORD: string = "input_keyword";
    private static readonly S_INTEGER_ATOM_TYPE: string = "integer_atom_type";
    private static readonly S_INTEGER_VECTOR_TYPE: string = "integer_vector_type";
    private static readonly S_INTEGRAL_NUMBER: string = "integral_number";
    private static readonly S_INTERCONNECT_KEYWORD: string = "interconnect_keyword";
    private static readonly S_INTERFACE_DECLARATION: string = "interface_declaration";
    private static readonly S_INTERFACE_HEADER: string = "interface_header";
    private static readonly S_INTERFACE_ITEM: string = "interface_item";
    private static readonly S_INTERFACE_KEYWORD: string = "interface_keyword";
    private static readonly S_INTERFACE_OR_GENERATE_ITEM: string = "interface_or_generate_item";
    private static readonly S_INTERFACE_PORT_HEADER: string = "interface_port_header";
    private static readonly S_LET_DECLARATION: string = "let_declaration";
    private static readonly S_LIFETIME: string = "lifetime";
    private static readonly S_LIST_OF_PORT_DECLARATIONS: string = "list_of_port_declarations";
    private static readonly S_LIST_OF_TF_VARIABLE_IDENTIFIERS: string = "list_of_tf_variable_identifiers";
    private static readonly S_LIST_OF_VARIABLE_DECL_ASSIGNMENTS: string = "list_of_variable_decl_assignments";
    private static readonly S_LOCALPARAM_DECLARATION: string = "localparam_declaration";
    private static readonly S_LOCALPARAM_KEYWORD: string = "localparam_keyword";
    private static readonly S_LOCALPARAM_NONTYPE_DECLARATION: string = "localparam_nontype_declaration";
    private static readonly S_LOCALPARAM_TYPE_DECLARATION: string = "localparam_type_declaration";
    private static readonly S_LOOP_GENERATE_CONSTRUCT: string = "loop_generate_construct";
    private static readonly S_MACRO_IDENTIFIER: string = "macro_identifier";
    private static readonly S_MODPORT_CLOCKING_DECLARATION: string = "modport_clocking_declaration";
    private static readonly S_MODPORT_DECLARATION: string = "modport_declaration";
    private static readonly S_MODPORT_KEYWORD: string = "modport_keyword";
    private static readonly S_MODPORT_ITEM: string = "modport_item";
    private static readonly S_MODPORT_PORTS_DECLARATION: string = "modport_ports_declaration";
    private static readonly S_MODPORT_SIMPLE_PORT: string = "modport_simple_port";
    private static readonly S_MODPORT_SIMPLE_PORTS_DECLARATION: string = "modport_simple_ports_declaration";
    private static readonly S_MODPORT_TF_PORTS_DECLARATION: string = "modport_tf_ports_declaration";
    private static readonly S_MODULE_COMMON_ITEM: string = "module_common_item";
    private static readonly S_MODULE_DECLARATION: string = "module_declaration";
    private static readonly S_MODULE_HEADER: string = "module_header";
    private static readonly S_MODULE_ITEM: string = "module_item";
    private static readonly S_MODULE_KEYWORD: string = "module_keyword";
    private static readonly S_MODULE_OR_GENERATE_ITEM: string = "module_or_generate_item";
    private static readonly S_MODULE_OR_GENERATE_ITEM_DECLARATION: string = "module_or_generate_item_declaration";
    private static readonly S_NET_ALIAS: string = "net_alias";
    private static readonly S_NET_DECL_ASSIGNMENT: string = "net_decl_assignment";
    private static readonly S_NET_DECLARATION: string = "net_declaration";
    private static readonly S_NET_IDENTIFIER: string = "net_identifier";
    private static readonly S_NET_TYPE: string = "net_type";
    private static readonly S_NET_TYPE_DECLARATION: string = "net_type_declaration";
    private static readonly S_NON_INTEGER_TYPE: string = "non_integer_type";
    private static readonly S_NON_PORT_MODULE_ITEM: string = "non_port_module_item";
    private static readonly S_NON_PORT_INTERFACE_ITEM: string = "non_port_interface_item";
    private static readonly S_NUMERIC_LITERAL: string = "numeric_literal";
    private static readonly S_OPEN_CURLY_BRACES: string = 'open_curly_braces';
    private static readonly S_OPEN_PARANTHESES: string = 'open_parantheses';
    private static readonly S_OPEN_SQUARE_BRACKETS: string = 'open_square_brackets';
    private static readonly S_OUTPUT_DECLARATION: string = "output_declaration";
    private static readonly S_OUTPUT_KEYWORD: string = "output_keyword";
    private static readonly S_PACKAGE_DECLARATION: string = "package_declaration";
    private static readonly S_PACKAGE_EXPORT_DECLARATION: string = "package_export_declaration";
    private static readonly S_PACKAGE_HEADER: string = "package_header";
    private static readonly S_PACKAGE_IMPORT_DECLARATION: string = "package_import_declaration";
    private static readonly S_PACKAGE_ITEM: string = "package_item";
    private static readonly S_PACKAGE_KEYWORD: string = "package_keyword";
    private static readonly S_PACKAGE_OR_GENERATE_ITEM_DECLARATION: string = "package_or_generate_item_declaration";
    private static readonly S_PACKAGE_SCOPE: string = "package_scope";
    private static readonly S_PACKED_KEYWORD: string = "packed_keyword";
    private static readonly S_PARAM_ASSIGNMENT: string = "param_assignment";
    private static readonly S_PARAMETER_DECLARATION: string = "parameter_declaration";
    private static readonly S_PARAMETER_KEYWORD: string = "parameter_keyword";
    private static readonly S_PARAMETER_NONTYPE_DECLARATION: string = "parameter_nontype_declaration";
    private static readonly S_PARAMETER_OVERRIDE: string = "parameter_override";
    private static readonly S_PARAMETER_PORT_LIST: string = "parameter_port_list";
    private static readonly S_PARAMETER_TYPE_DECLARATION: string = "parameter_type_declaration";
    private static readonly S_PARAMETRIZED_IDENTIFIER: string = "parametrized_identifier";
    private static readonly S_PARANTHESES_BLOCK: string = "parantheses_block";
    private static readonly S_PROGRAM_DECLARATION: string = "program_declaration";
    private static readonly S_PORT_DECLARATION: string = "port_declaration";
    private static readonly S_PORT_DIRECTION: string = "port_direction";
    private static readonly S_RANDOM_QUALIFIER: string = "random_qualifier";
    private static readonly S_REF_DECLARATION: string = "ref_declaration";
    private static readonly S_REF_KEYWORD: string = "ref_keyword";
    private static readonly S_SCALARED_KEYWORD: string = "scalared_keyword";
    private static readonly S_SCOPED_IDENTIFIER: string = "scoped_identifier";
    private static readonly S_SCOPED_AND_HIERARCHICAL_IDENTIFIER: string = "scoped_and_hierarchical_identifier";
    private static readonly S_SEMICOLON_OPERATOR: string = "semicolon_operator";
    private static readonly S_SIGNING: string = "signing";
    private static readonly S_SIMPLE_IDENTIFIER: string = "simple_identifier";
    private static readonly S_SIMPLE_OPERATORS: string = "simple_operators";
    private static readonly S_SLASHED_OPERATORS: string = "slashed_operators";
    private static readonly S_SPECIFY_BLOCK: string = "specify_block";
    private static readonly S_SPECPARAM_DECLARATION: string = "specparam_declaration";
    private static readonly S_SQUARE_BRACKETS_BLOCK: string = "square_brackets_block";
    private static readonly S_STAR_OPERATOR: string = "star_operator";
    private static readonly S_STATEMENT_ITEM: string = "statement_item";
    private static readonly S_STATEMENT_OR_NULL: string = "statement_or_null";
    private static readonly S_STRING_KEYWORD: string = "string_keyword";
    private static readonly S_STRUCT_KEYWORD: string = "struct_keyword";
    private static readonly S_STRUCT_UNION: string = "struct_union";
    private static readonly S_STRUCT_UNION_MEMBER: string = "struct_union_member";
    private static readonly S_TASK_BODY_DECLARATION: string = "task_body_declaration";
    private static readonly S_TASK_DECLARATION: string = "task_declaration";
    private static readonly S_TASK_IDENTIFIER: string = "task_identifier";
    private static readonly S_TASK_KEYWORD: string = "task_keyword";
    private static readonly S_TASK_NON_PORT_HEADER: string = "task_non_port_header";
    private static readonly S_TASK_HEADER: string = "task_header";
    private static readonly S_TF_PORT_DECLARATION: string = "tf_port_declaration";
    private static readonly S_TF_PORT_DIRECTION: string = "tf_port_direction";
    private static readonly S_TF_PORT_ITEM: string = "tf_port_item";
    private static readonly S_TF_ITEM_DECLARATION: string = "tf_item_declaration";
    private static readonly S_TIMEUNITS_DECLARATION: string = "timeunits_declaration";
    private static readonly S_TYPE_ASSIGNMENT: string = "type_assignment";
    private static readonly S_TYPE_DECLARATION: string = "type_declaration";
    private static readonly S_TYPEDEF1_DECLARATION: string = "typedef1_declaration";
    private static readonly S_TYPEDEF2_DECLARATION: string = "typedef2_declaration";
    private static readonly S_TYPEDEF3_DECLARATION: string = "typedef3_declaration";
    private static readonly S_TYPE_KEYWORD: string = "type_keyword";
    private static readonly S_TYPE_REFERENCE: string = "type_reference";
    private static readonly S_TYPEDEF_KEYWORD: string = "typedef_keyword";
    private static readonly S_UDP_DECLARATION: string = "udp_declaration";
    private static readonly S_UNION_KEYWORD: string = "union_keyword";
    private static readonly S_UNIQUE_CHECKER_OR_GENERATE_ITEM: string = "unique_checker_or_generate_item";
    private static readonly S_UNIQUE_INTERFACE_OR_GENERATE_ITEM: string = "unique_interface_or_generate_item";
    private static readonly S_VARIABLE_DECL_ASSIGNMENT: string = "variable_decl_assignment";
    private static readonly S_VARIABLE_PORT_HEADER: string = "variable_port_header";
    private static readonly S_VARIABLE_PORT_TYPE: string = "variable_port_type";
    private static readonly S_VAR_KEYWORD: string = "var_keyword";
    private static readonly S_VECTORED_KEYWORD: string = "vectored_keyword";
    private static readonly S_VIRTUAL_KEYWORD: string = "virtual_keyword";
    private static readonly S_VOID_KEYWORD: string = "void_keyword";

    private _anonStructUnionCount: number = 0;
    private _anonEnumCount: number = 0;

    private _document: TextDocument;
    private _documentPath: string;
    private _preprocCache: Map<string, PreprocCacheEntry>;
    private _synLeafNodeRanges: SyntaxLeafNodeRange[];
    private _synNodeRangeMap: SyntaxNodeRangeMap;
    private _fileSymbolsInfo: SystemVerilogParser.SystemVerilogFileSymbolsInfo;
    private _containerStack: ContainerStack;

    private _calcSyntaxLeafNodeRanges(rootNode: SyntaxNode, uri: string, sourceText: string): SyntaxLeafNodeRange[] {
        let result: SyntaxLeafNodeRange[] = [];

        let prevEndIndex: number = 0;
        visitLeafNodes(rootNode.walk(), (synNode) => {
            if (synNode.startIndex < prevEndIndex) {
                ConnectionLogger.error(`Out of order leaf nodes at ${synNode.startIndex}, ${prevEndIndex} in ${uri}`);
                return;
            }

            if (synNode.startIndex > prevEndIndex) {
                result.push({ startIndex: prevEndIndex, endIndex: synNode.startIndex, node: null });
                prevEndIndex = synNode.startIndex;
            }

            // Workaround for tree-sitter bug where it matches both \r and \n in a regex like `/.*(\n|\r)?/`
            let endIndex = synNode.endIndex;
            if (synNode.text.endsWith('\r\n')) {
                endIndex--;
            }

            if (endIndex > synNode.startIndex) {
                result.push({ startIndex: synNode.startIndex, endIndex: endIndex, node: synNode });
                prevEndIndex = endIndex;
            }
            else if (endIndex < synNode.startIndex) {
                ConnectionLogger.error(`Leaf node with end index smaller than startIndex!!! (${synNode.startIndex}, ${synNode.endIndex}, ${endIndex})`);
            }
        });

        if (sourceText.length > prevEndIndex) {
            result.push({ startIndex: prevEndIndex, endIndex: sourceText.length, node: null });
        }

        return result;
    }

    private _reRangeSyntaxNodes(postTokens: PostToken[], tokenOrder: TokenOrderEntry[], sourceText: string, uri: string): SyntaxNodeRangeMap {
        let result: SyntaxNodeRangeMap = { startIndexMap: new Map(), endIndexMap: new Map(), indexFileRanges: new Array() };
        let currentPostToken: number = 0;
        let currentTokenOrderIndex: number = 0;
        let currentFile: string = (tokenOrder.length > 0) && (tokenOrder[0].tokenNum == 0) ? tokenOrder[0].file : this._documentPath;

        //if (uri.endsWith("/i2c_wrapper.sv")) {
        //    tokenOrder.forEach(to => { ConnectionLogger.log(`DEBUG: ${to.file} ${to.tokenNum}`); });
        //}
        this._synLeafNodeRanges.forEach(synLeafNodeRange => {
            //ConnectionLogger.log(`DEBUG: Processing synLeafNodeRange (${synLeafNodeRange.startIndex}, ${synLeafNodeRange.endIndex}) |${synLeafNodeRange.node === null ? "" : synLeafNodeRange.node.text}|`);
            if (currentPostToken >= postTokens.length) {
                ConnectionLogger.error(`Range (${synLeafNodeRange.startIndex}, ${synLeafNodeRange.endIndex}) out of bounds (${postTokens[postTokens.length-1].endIndex}) in ${uri}`);
            }
            else {
                let newStartIndex: number = postTokens[currentPostToken].index;
                //if (uri.endsWith("/i2c_wrapper.sv")) {
                //    ConnectionLogger.log(`DEBUG: adding entry to startIndexMap - ${synLeafNodeRange.node?.type} ${synLeafNodeRange.startIndex}, ${newStartIndex}, ${currentFile}`);
                //}
                result.startIndexMap.set(synLeafNodeRange.startIndex, newStartIndex);

                let newEndIndex: number;
                let currentLength: number = 0;
                let rangeLength: number = synLeafNodeRange.endIndex - synLeafNodeRange.startIndex;
                for (;currentPostToken < postTokens.length; currentPostToken++) {
                    if ((currentTokenOrderIndex < tokenOrder.length) && (tokenOrder[currentTokenOrderIndex].tokenNum == currentPostToken)) {
                        currentFile = tokenOrder[currentTokenOrderIndex].file;
                        currentTokenOrderIndex++;
                        result.indexFileRanges.push({ startIndex: synLeafNodeRange.startIndex + currentLength, file: currentFile });
                    }

                    //ConnectionLogger.log(`DEBUG: Processing postToken (${postTokens[currentPostToken].index}, ${currentPostToken}, ${postTokens[currentPostToken].text.length}) |${postTokens[currentPostToken].text}|`);
                    newEndIndex = postTokens[currentPostToken].endIndex + 1;
                    currentLength += postTokens[currentPostToken].text.length;

                    if (currentLength >= rangeLength) {
                        if (currentLength > rangeLength) {
                            ConnectionLogger.error(`PostToken split across range token in ${uri} at (${postTokens[currentPostToken].index}, ${postTokens[currentPostToken].endIndex}), (${synLeafNodeRange.endIndex})`);
                        }
                        currentPostToken++;
                        break;
                    }

                    if (currentPostToken >= (postTokens.length - 1)) {
                        ConnectionLogger.error(`Ran out of post tokens at (${synLeafNodeRange.endIndex}) in ${uri}`);
                    }
                }

                if (newEndIndex === undefined) {
                    ConnectionLogger.error(`Non-positive length range (${rangeLength}) found at ${synLeafNodeRange.startIndex} in ${uri}`);
                }
                else {
                    result.endIndexMap.set(synLeafNodeRange.endIndex, newEndIndex);
                //if (uri.endsWith("/i2c_wrapper.sv")) {
                //    ConnectionLogger.log(`DEBUG: adding entry to endIndexMap - ${synLeafNodeRange.node?.type} ${synLeafNodeRange.endIndex}, ${newEndIndex}, ${currentFile}`);
                //}
                }
            }
        });
        //if (uri.endsWith("/i2c_wrapper.sv")) {
        //    result.indexFileRanges.forEach(r => ConnectionLogger.log(`DEBUG: index file range ${r.startIndex} ${r.endIndex} ${r.file}`));
        //}
        return result;
    }

    private _getDocumentFromFilePath(filePath: string): TextDocument {
        if (filePath == this._documentPath) {
            return this._document;
        }

        let shortFilePath: string;
        for (let [sfile, fileInfo] of this._preprocCache) {
            if (fileInfo.file == filePath) {
                shortFilePath = sfile;
                break;
            }
        }
        if (!!shortFilePath) {
            return this._preprocCache.get(shortFilePath).doc;
        }

        ConnectionLogger.error(`Could not find include cache for ${filePath}`);
        return undefined;
    }

    private _getStartingIndexFileRangesIndex(startIndex: number): number {
        let start: number = 0;
        let end: number = this._synNodeRangeMap.indexFileRanges.length - 1;
        let loopCount = 0;
        while (start <= end) {
            loopCount++;
            if (loopCount > 100) {
                return -1;
            }
            let doubleTheMid: number = end + start;
            let mid: number = (doubleTheMid - (doubleTheMid % 2))/2;
            if ((this._synNodeRangeMap.indexFileRanges[mid].startIndex <= startIndex) &&
               ((mid == (this._synNodeRangeMap.indexFileRanges.length - 1)) || (this._synNodeRangeMap.indexFileRanges[mid+1].startIndex > startIndex))) {
                return mid;
            }
            else if (this._synNodeRangeMap.indexFileRanges[mid].startIndex < startIndex) {
                start = mid + 1;
            }
            else {
                end = mid - 1;
            }
        }

        return -1;
    }

    private _getDocumentRange(doc: TextDocument, startIndex: number, endIndex: number): Range {
        return Range.create(doc.positionAt(startIndex), doc.positionAt(endIndex));
    }

    private _getEndPosition(synNode: SyntaxNode): SystemVerilogParser.SystemVerilogPosition {
        let startingIndexFileRangesIndex: number = this._getStartingIndexFileRangesIndex(synNode.startIndex);
        if (startingIndexFileRangesIndex < 0) {
            ConnectionLogger.error(`Could not figure out the source file for the given syntax node (${synNode.startIndex}). Falling back to default`);
            let endPos: Position = this._document.positionAt(this._synNodeRangeMap.endIndexMap.get(synNode.endIndex));
            return { line: endPos.line, character: endPos.character };
        }

        let document: TextDocument = this._getDocumentFromFilePath(this._synNodeRangeMap.indexFileRanges[startingIndexFileRangesIndex].file);
        if (document == undefined) {
            ConnectionLogger.error(`Could not figure out the source file for the given syntax node (${synNode.startIndex}). Falling back to default`);
            let endPos: Position = this._document.positionAt(this._synNodeRangeMap.endIndexMap.get(synNode.endIndex));
            return { line: endPos.line, character: endPos.character };
        }

        let refDocumentPath: string = this._containerStack.getContainerDocumentPath(document.uri);
        let endPos: Position = (this._document.uri == refDocumentPath)
                             ? this._document.positionAt(this._synNodeRangeMap.endIndexMap.get(synNode.endIndex))
                             : document.positionAt(this._synNodeRangeMap.endIndexMap.get(synNode.endIndex));
        return (this._document.uri == refDocumentPath) ? { line: endPos.line, character: endPos.character } : { file: refDocumentPath, line: endPos.line, character: endPos.character };
    }

    private _getDefLocations(startSynNode: SyntaxNode, endSynNode: SyntaxNode): DefinitionLocations {
        let startingIndexFileRangesIndex: number = this._getStartingIndexFileRangesIndex(startSynNode.startIndex);
        if (startingIndexFileRangesIndex < 0) {
            ConnectionLogger.error(`Could not figure out the source file for the given range (${startSynNode.startIndex}, ${endSynNode.endIndex}). Falling back to default`);
            return this._getDocumentRange(this._document, this._synNodeRangeMap.startIndexMap.get(startSynNode.startIndex), this._synNodeRangeMap.endIndexMap.get(endSynNode.endIndex));
        }

        let result: DefinitionLocations = [];
        let currentStartIndex: number = startSynNode.startIndex;
        let currentFilePath: string = this._synNodeRangeMap.indexFileRanges[startingIndexFileRangesIndex].file;
        let currentDoc: TextDocument = this._document;
        if (currentFilePath != this._documentPath) {
            let currentDocTmp: TextDocument = this._getDocumentFromFilePath(currentFilePath);
            if (currentDocTmp !== undefined) {
                currentDoc = currentDocTmp;
                result.push(currentDoc.uri);
            }
        }

        //if (this._document.uri.endsWith("/i2c_wrapper.sv")) {
        //    ConnectionLogger.log(`DEBUG: HERE with ${currentStartIndex}, ${endSynNode.endIndex}, ${currentFilePath}, ${startingIndexFileRangesIndex}, ${this._synNodeRangeMap.indexFileRanges.length}`);
        //}
        for (let i: number = startingIndexFileRangesIndex; i < this._synNodeRangeMap.indexFileRanges.length; i++) {
            if ((i == (this._synNodeRangeMap.indexFileRanges.length - 1)) ||
                (endSynNode.endIndex < this._synNodeRangeMap.indexFileRanges[i+1].startIndex)) {
                result.push(this._getDocumentRange(currentDoc, this._synNodeRangeMap.startIndexMap.get(currentStartIndex), this._synNodeRangeMap.endIndexMap.get(endSynNode.endIndex)));
                break;
            }
            else {
                let synNodeRangeEndIndex: number = this._synNodeRangeMap.indexFileRanges[i+1].startIndex;
                result.push(this._getDocumentRange(currentDoc, this._synNodeRangeMap.startIndexMap.get(currentStartIndex), this._synNodeRangeMap.endIndexMap.get(synNodeRangeEndIndex)));

                currentStartIndex = synNodeRangeEndIndex;
                currentFilePath = this._synNodeRangeMap.indexFileRanges[i+1].file;
                let currentDocTmp: TextDocument = this._getDocumentFromFilePath(currentFilePath);
                if (currentDocTmp !== undefined) {
                    currentDoc = currentDocTmp;
                    result.push(currentDoc.uri);
                }
            }
        }

        if (result.length == 1) {
            result = <Range>result[0];
        }
        return result;
    }

    private _createSymbol(synNode: SyntaxNode, symbolType: string[], definitionRange?: SymbolDefinitionRange, symbolText?: string): SystemVerilogSymbol {
        let startingIndexFileRangesIndex:number = this._getStartingIndexFileRangesIndex(synNode.startIndex);
        let filePath: string = this._documentPath;
        if (startingIndexFileRangesIndex < 0) {
            ConnectionLogger.error(`Could not figure out the source file for the given range (${synNode.startIndex}, ${synNode.endIndex}). Falling back to default`);
        }
        else {
            filePath = this._synNodeRangeMap.indexFileRanges[startingIndexFileRangesIndex].file;
        }
        let document: TextDocument = this._getDocumentFromFilePath(filePath);
        if (document == undefined) {
            return;
        }
        let symbolName: string = symbolText || synNode.text;
        let symbolRange: Range = this._getDocumentRange(document, this._synNodeRangeMap.startIndexMap.get(synNode.startIndex), this._synNodeRangeMap.endIndexMap.get(synNode.endIndex));
        //if (this._document.uri.endsWith("/i2c_wrapper.sv")) {
        //    ConnectionLogger.log(`DEBUG: symbolRange: from ${document.uri}, ${synNode.startIndex}, ${synNode.endIndex}, ${this._synNodeRangeMap.startIndexMap.get(synNode.startIndex).file}, ${this._synNodeRangeMap.startIndexMap.get(synNode.startIndex)}, ${this._synNodeRangeMap.endIndexMap.get(synNode.endIndex)}, ${symbolRange.start.line} ${symbolRange.start.character} ${symbolRange.end.line} ${symbolRange.end.character}`);
        //}
        return new SystemVerilogSymbol(
            symbolName,
            !!definitionRange ? this._getDefLocations(definitionRange.startSynNode, definitionRange.endSynNode) : undefined,
            document.uri == this._document.uri ? symbolRange : [document.uri, symbolRange],
            this._containerStack.toStringList(),
            symbolType
        );
    }

    private _pushSymbol(synNode: SyntaxNode, symbolType: string[], definitionRange?: SymbolDefinitionRange, symbolText?: string): SystemVerilogSymbol {
        let symbol: SystemVerilogSymbol = this._createSymbol(synNode, symbolType, definitionRange, symbolText);
        symbol = this._containerStack.pushSymbol(symbol);
        return symbol;
    }

    private _pushContainerSymbol(synNode: SyntaxNode, symbolType: string[], definitionRange?: SymbolDefinitionRange, symbolText?: string): SystemVerilogSymbol {
        let containerSymbol: SystemVerilogSymbol = this._createSymbol(synNode, symbolType, definitionRange, symbolText);
        containerSymbol = this._containerStack.push(containerSymbol);
        //if (this._document.uri.endsWith("/i2c_wrapper.sv")) {
        //    ConnectionLogger.log(`DEBUG: new module ${synNode.text} json symbol = ${containerSymbol.toJSON()}`);
        //}
        return containerSymbol;
    }

    private _ignoreSymbol(treeCursor: MyTreeCursor, symbolType: string): Boolean {
        if (treeCursor.currentNode.type == symbolType) {
            //ConnectionLogger.log(`DEBUG: ignored symbol type ${symbolType} till ${treeCursor.currentNode.endPosition.row}, ${treeCursor.currentNode.endPosition.column}`);
            return true;
        }
        return false;
    }

    private _isEscapedOrSimpleIdentifier(synNode: SyntaxNode): Boolean {
        return (synNode.type == SystemVerilogIndexParser.S_ESCAPED_IDENTIFIER) ||
               (synNode.type == SystemVerilogIndexParser.S_SIMPLE_IDENTIFIER);
    }

    private _isAllAllow(synNode: SyntaxNode): Boolean {
        return (synNode.type == SystemVerilogIndexParser.S_COMMENT) ||
               (synNode.type == SystemVerilogIndexParser.S_MACRO_IDENTIFIER) ||
               (synNode.type == SystemVerilogIndexParser.S_ATTRIBUTE_INSTANCE);
    }

    private _isBaseGrammar(synNode: SyntaxNode): Boolean {
        return (synNode.type == SystemVerilogIndexParser.S_DOUBLE_QUOTED_STRING) ||
               (synNode.type == SystemVerilogIndexParser.S_NUMERIC_LITERAL) ||
               (synNode.type == SystemVerilogIndexParser.S_IDENTIFIER) ||
               (synNode.type == SystemVerilogIndexParser.S_SIMPLE_OPERATORS) ||
               (synNode.type == SystemVerilogIndexParser.S_SLASHED_OPERATORS) ||
               (synNode.type == SystemVerilogIndexParser.S_EVENT_CONTROL_OPERATOR) ||
               (synNode.type == SystemVerilogIndexParser.S_HASH_OPERATOR) ||
               (synNode.type == SystemVerilogIndexParser.S_COMMA_OPERATOR) ||
               (synNode.type == SystemVerilogIndexParser.S_DOT_OPERATOR) ||
               (synNode.type == SystemVerilogIndexParser.S_SQUARE_BRACKETS_BLOCK) ||
               (synNode.type == SystemVerilogIndexParser.S_CURLY_BRACKETS_BLOCK) ||
               (synNode.type == SystemVerilogIndexParser.S_PARANTHESES_BLOCK) ||
               (synNode.type == SystemVerilogIndexParser.S_HASH_PARANTHESES_BLOCK) ||
               (synNode.type == SystemVerilogIndexParser.S_EVENT_CONTROL_BLOCK);
    }

    private _getEscapedOrSimpleIdentifier(synNode: SyntaxNode) : SyntaxNode {
        if (synNode.firstChild === null) {
            return undefined;
        }
        else if (this._isEscapedOrSimpleIdentifier(synNode.firstChild)) {
            return synNode.firstChild;
        }
        else if (synNode.firstChild.type == SystemVerilogIndexParser.S_ARRAY_IDENTIFIER) {
            if (synNode.firstChild.firstChild === null) {
                return undefined;
            }
            else if (this._isEscapedOrSimpleIdentifier(synNode.firstChild.firstChild)) {
                return synNode.firstChild.firstChild;
            }
        }

        return  undefined;
    }

    private _getDataType(parentNode: SyntaxNode): string {
        let synNode: SyntaxNode = parentNode.firstChild;
        if (synNode !== null) {
            if (this._isEscapedOrSimpleIdentifier(synNode)) {
                return synNode.text;
            }
            else if ((synNode.type == SystemVerilogIndexParser.S_ARRAY_IDENTIFIER) ||
                     (synNode.type == SystemVerilogIndexParser.S_PARAMETRIZED_IDENTIFIER)) {
                if ((synNode.firstChild !== null) && this._isEscapedOrSimpleIdentifier(synNode.firstChild)) {
                    return synNode.firstChild.text;
                }
            }
            else if ((synNode.type == SystemVerilogIndexParser.S_SCOPED_IDENTIFIER) ||
                     (synNode.type == SystemVerilogIndexParser.S_HIERARCHICAL_IDENTIFIER) ||
                     (synNode.type == SystemVerilogIndexParser.S_SCOPED_AND_HIERARCHICAL_IDENTIFIER)) {
                let endIndex: number = synNode.endIndex;
                synNode.children.forEach(childSynNode => {
                    if (childSynNode.type != SystemVerilogIndexParser.S_SQUARE_BRACKETS_BLOCK) {
                        endIndex = childSynNode.endIndex;
                    }
                });
                return synNode.text.substring(0, endIndex - synNode.startIndex);
            }
            else {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} while getting data type for ${parentNode.text} in ${this._documentPath}`);
            }
        }
        return undefined;
    }

    private _getInstType(parentNode: SyntaxNode): string {
        return this._getDataType(parentNode);
    }

    private _processImportDeclaration(treeCursor: MyTreeCursor) {
        let _pkgName: string;
        let _pkgSymbol: string;
        treeCursor.currentNode.children.forEach(synNode => {
            if (this._isEscapedOrSimpleIdentifier(synNode)) {
                if (_pkgName === undefined) {
                    _pkgName = synNode.text;
                }
                else {
                    _pkgSymbol = synNode.text;
                }
            }
            else if (synNode.type == SystemVerilogIndexParser.S_STAR_OPERATOR) {
                if (_pkgName !== undefined) {
                    _pkgSymbol = "*";
                }
            }
            else if ((synNode.type == SystemVerilogIndexParser.S_COMMA_OPERATOR) ||
                     (synNode.type == SystemVerilogIndexParser.S_SEMICOLON_OPERATOR)) {
                if ((_pkgName !== undefined) && (_pkgSymbol !== undefined)) {
                    this._containerStack.pushImportItemParts(_pkgName, _pkgSymbol);
                }
                _pkgName = undefined;
                _pkgSymbol = undefined;
            }
            else if ((synNode.type != SystemVerilogIndexParser.S_IMPORT_KEYWORD) &&
                     (synNode.type != SystemVerilogIndexParser.S_DOUBLE_COLON_OPERATOR)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a import declaration in ${this._documentPath}`);
            }
        });
    }

    private _processParamAssignment(treeCursor: MyTreeCursor, types: string[], startSymbol?: SyntaxNode) {
        if (treeCursor.currentNode.firstChild !== null) {
            if (this._isEscapedOrSimpleIdentifier(treeCursor.currentNode.firstChild)) {
                this._pushSymbol(
                    treeCursor.currentNode.firstChild,
                    types,
                    { startSynNode: startSymbol === null ? treeCursor.currentNode.firstChild : startSymbol, endSynNode: treeCursor.currentNode.lastChild }
                );
            }
        }
    }

    private _processTypeAssignment(treeCursor: MyTreeCursor, types: string[], startSymbol?: SyntaxNode) {
        if (treeCursor.currentNode.firstChild !== null) {
            if (this._isEscapedOrSimpleIdentifier(treeCursor.currentNode.firstChild)) {
                this._pushSymbol(
                    treeCursor.currentNode.firstChild,
                    types,
                    { startSynNode: startSymbol === null ? treeCursor.currentNode.firstChild : startSymbol, endSynNode: treeCursor.currentNode.lastChild }
                );
            }
        }
    }

    private _processNonTypeParamDeclaration(treeCursor: MyTreeCursor, keywordSymbol: string, types: string[]) {
        let dataType: string[] = [];
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_PARAM_ASSIGNMENT) {
                this._processParamAssignment({ currentNode: synNode }, types.concat([keywordSymbol.replace(/_keyword$/, '')]).concat(dataType.length > 0 ? [dataType.join(' ')] : []), treeCursor.currentNode.firstChild);
                dataType = [];
            }
            else if (synNode.type == SystemVerilogIndexParser.S_DATA_TYPE) {
                dataType.push(this._processDataType({ currentNode: synNode }));
            }
            else if (synNode.type == SystemVerilogIndexParser.S_SIGNING) {
                dataType.push(synNode.text);
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_SQUARE_BRACKETS_BLOCK) &&
                     (synNode.type != SystemVerilogIndexParser.S_COMMA_OPERATOR) &&
                     (synNode.type != keywordSymbol)) {
                ConnectionLogger.error(`Invalid symbol type ${synNode.type} in a parameter_nontype_declaration in ${this._documentPath}`);
            }
        });
    }

    private _processTypeParamDeclaration(treeCursor: MyTreeCursor, keywordSymbol: string) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_TYPE_ASSIGNMENT) {
                this._processTypeAssignment({ currentNode: synNode }, ["parameter-port", "type"].concat(keywordSymbol.replace(/_keyword$/, '')), treeCursor.currentNode.firstChild);
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != keywordSymbol) &&
                     (synNode.type != SystemVerilogIndexParser.S_TYPE_KEYWORD)) {
                ConnectionLogger.error(`Invalid symbol type ${synNode.type} in a parameter_nontype_declaration in ${this._documentPath}`);
            }
        });
    }

    private _processParameterDeclaration(treeCursor: MyTreeCursor, types: string[]): Boolean {
        if (treeCursor.currentNode.type != SystemVerilogIndexParser.S_PARAMETER_DECLARATION) {
            return false;
        }

        if (treeCursor.currentNode.firstChild !== null) {
            if (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_PARAMETER_NONTYPE_DECLARATION) {
                this._processNonTypeParamDeclaration({ currentNode: treeCursor.currentNode.firstChild }, SystemVerilogIndexParser.S_PARAMETER_KEYWORD, types);
            }
            else if (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_PARAMETER_TYPE_DECLARATION) {
                this._processTypeParamDeclaration({ currentNode: treeCursor.currentNode.firstChild }, SystemVerilogIndexParser.S_PARAMETER_KEYWORD);
            }
            else {
                ConnectionLogger.error(`Invalid first child ${treeCursor.currentNode.firstChild.type} of a parameter declaration in ${this._documentPath}`);
            }
        }
        else {
            ConnectionLogger.error(`Invalid parameter declaration with no child in ${this._documentPath}`);
        }

        return true;
    }

    private _processLocalParamDeclaration(treeCursor: MyTreeCursor, types: string[]): Boolean {
        if (treeCursor.currentNode.type != SystemVerilogIndexParser.S_LOCALPARAM_DECLARATION) {
            return false;
        }

        if (treeCursor.currentNode.firstChild !== null) {
            if (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_LOCALPARAM_NONTYPE_DECLARATION) {
                this._processNonTypeParamDeclaration({ currentNode: treeCursor.currentNode.firstChild }, SystemVerilogIndexParser.S_LOCALPARAM_KEYWORD, types);
            }
            else if (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_LOCALPARAM_TYPE_DECLARATION) {
                this._processTypeParamDeclaration({ currentNode: treeCursor.currentNode.firstChild }, SystemVerilogIndexParser.S_LOCALPARAM_KEYWORD);
            }
            else {
                ConnectionLogger.error(`Invalid first child ${treeCursor.currentNode.firstChild.type} of a localparam declaration in ${this._documentPath}`);
            }
        }
        else {
            ConnectionLogger.error(`Invalid localparam declaration with no child in ${this._documentPath}`);
        }

        return true;
    }

    private _processVariableDeclAssignment(treeCursor: MyTreeCursor, symType: string[], defSynNode: SyntaxNode) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (this._isEscapedOrSimpleIdentifier(synNode)) {
                this._pushSymbol(synNode, symType, { startSynNode: defSynNode, endSynNode: defSynNode });
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_EQUALS_OPERATOR) &&
                     (synNode.type != SystemVerilogIndexParser.S_EXPRESSION) &&
                     (synNode.type != SystemVerilogIndexParser.S_SQUARE_BRACKETS_BLOCK)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a variable decl assignments in ${this._documentPath}`);
            }
        });
    }

    private _processListOfVariableDeclAssignments(treeCursor: MyTreeCursor, symType: string[], defSynNode: SyntaxNode) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_VARIABLE_DECL_ASSIGNMENT) {
                this._processVariableDeclAssignment({ currentNode: synNode }, symType, defSynNode);
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_COMMA_OPERATOR)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a list of variable decl assignments in ${this._documentPath}`);
            }
        });
    }

    private _processStructUnionMember(treeCursor: MyTreeCursor) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_DATA_TYPE_OR_VOID) {
                this._processDataTypeOrVoid({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_LIST_OF_VARIABLE_DECL_ASSIGNMENTS) {
                this._processListOfVariableDeclAssignments({ currentNode: synNode }, ["struct_union_member"], treeCursor.currentNode);
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_ATTRIBUTE_INSTANCE) &&
                     (synNode.type != SystemVerilogIndexParser.S_RANDOM_QUALIFIER) &&
                     (synNode.type != SystemVerilogIndexParser.S_SEMICOLON_OPERATOR)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a struct union member in ${this._documentPath}`);
            }
        });
    }

    private _processStructUnionDeclaration(treeCursor: MyTreeCursor): string {
        let structUnionName: string = `#AnonymousStructUnion${this._anonStructUnionCount}`
        this._anonStructUnionCount++;

        let structSymbol: SystemVerilogSymbol = this._pushContainerSymbol(
            treeCursor.currentNode.firstChild,
            [treeCursor.currentNode.firstChild.text],
            { startSynNode: treeCursor.currentNode, endSynNode: treeCursor.currentNode },
            structUnionName);

        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_STRUCT_UNION_MEMBER) {
                this._processStructUnionMember({currentNode: synNode});
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_STRUCT_UNION) &&
                     (synNode.type != SystemVerilogIndexParser.S_PACKED_KEYWORD) &&
                     (synNode.type != SystemVerilogIndexParser.S_SIGNING) &&
                     (synNode.type != SystemVerilogIndexParser.S_OPEN_CURLY_BRACES) &&
                     (synNode.type != SystemVerilogIndexParser.S_CLOSE_CURLY_BRACES) &&
                     (synNode.type != SystemVerilogIndexParser.S_SQUARE_BRACKETS_BLOCK)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a struct union declaration in ${this._documentPath}`);
            }
        });

        this._containerStack.pop(this._getEndPosition(treeCursor.currentNode.lastChild));

        return structUnionName;
    }

    private _processEnumNameDeclaration(treeCursor: MyTreeCursor, enumName: string) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (this._isEscapedOrSimpleIdentifier(synNode)) {
                this._pushSymbol(synNode, ["enum_member", enumName], { startSynNode: treeCursor.currentNode, endSynNode: treeCursor.currentNode });
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_OPEN_SQUARE_BRACKETS) &&
                     (synNode.type != SystemVerilogIndexParser.S_INTEGRAL_NUMBER) &&
                     (synNode.type != SystemVerilogIndexParser.S_COLON_OPERATOR) &&
                     (synNode.type != SystemVerilogIndexParser.S_CLOSE_SQUARE_BRACKETS) &&
                     (synNode.type != SystemVerilogIndexParser.S_EQUALS_OPERATOR) &&
                     (synNode.type != SystemVerilogIndexParser.S_CONSTANT_EXPRESSION)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in an enum name declaration in ${this._documentPath}`);
            }
        });
    }

    private _processEnumDeclaration(treeCursor: MyTreeCursor): string {
        let enumName: string = `#AnonymousEnum${this._anonStructUnionCount}`
        this._anonEnumCount++;

        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_ENUM_NAME_DECLARATION) {
                this._processEnumNameDeclaration({currentNode: synNode}, enumName);
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_ENUM_KEYWORD) &&
                     (synNode.type != SystemVerilogIndexParser.S_ENUM_BASE_TYPE) &&
                     (synNode.type != SystemVerilogIndexParser.S_OPEN_CURLY_BRACES) &&
                     (synNode.type != SystemVerilogIndexParser.S_CLOSE_CURLY_BRACES) &&
                     (synNode.type != SystemVerilogIndexParser.S_COMMA_OPERATOR) &&
                     (synNode.type != SystemVerilogIndexParser.S_SQUARE_BRACKETS_BLOCK)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in an enum declaration in ${this._documentPath}`);
            }
        });

        return enumName;
    }

    private _processClassOrPackageScopedDataType(treeCursor: MyTreeCursor) {
        let dataType: string[] = [];
        treeCursor.currentNode.children.forEach(synNode => {
            if ((synNode.type == SystemVerilogIndexParser.S_CLASS_SCOPE) ||
                (synNode.type == SystemVerilogIndexParser.S_PACKAGE_SCOPE) ||
                this._isEscapedOrSimpleIdentifier(synNode)) {
                dataType.push(synNode.text);
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_SQUARE_BRACKETS_BLOCK)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a class or package scope data type in ${this._documentPath}`);
            }
        });
        return dataType.join('');
    }

    private _processDataType(treeCursor: MyTreeCursor): string {
        if (treeCursor.currentNode.firstChild !== null) {
            if (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_STRUCT_UNION) {
                return this._processStructUnionDeclaration({ currentNode: treeCursor.currentNode });
            }
            else if (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_ENUM_KEYWORD) {
                return this._processEnumDeclaration({ currentNode: treeCursor.currentNode });
            }
            else if (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_INTEGER_VECTOR_TYPE) {
                let dataType: string[] = [];
                treeCursor.currentNode.children.forEach(synNode => {
                    if ((synNode.type == SystemVerilogIndexParser.S_INTEGER_VECTOR_TYPE) ||
                        (synNode.type == SystemVerilogIndexParser.S_SIGNING)) {
                        dataType.push(synNode.text);
                    }
                    else if (!this._isAllAllow(synNode) &&
                             (synNode.type != SystemVerilogIndexParser.S_SQUARE_BRACKETS_BLOCK)) {
                        ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a integer vector type in ${this._documentPath}`);
                    }
                });
                return dataType.join(' ');
            }
            else if ((treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_INTEGER_ATOM_TYPE) ||
                     (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_VIRTUAL_KEYWORD)) {
                return treeCursor.currentNode.text;
            }
            else if ((treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_CLASS_SCOPE) ||
                     (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_PACKAGE_SCOPE)) {
                return this._processClassOrPackageScopedDataType(treeCursor);
            }
            else if ((treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_NON_INTEGER_TYPE) ||
                     (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_STRING_KEYWORD) ||
                     (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_CHANDLE_KEYWORD) ||
                     (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_EVENT_KEYWORD) ||
                     (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_CLASS_TYPE) ||
                     this._isEscapedOrSimpleIdentifier(treeCursor.currentNode.firstChild)) {
                return treeCursor.currentNode.firstChild.text;
            }
            else if (!this._isAllAllow(treeCursor.currentNode.firstChild) &&
                     (treeCursor.currentNode.firstChild.type != SystemVerilogIndexParser.S_TYPE_REFERENCE)) {
                ConnectionLogger.error(`Unexpected symbol type ${treeCursor.currentNode.firstChild.type} in a data type ${this._documentPath}`);
            }
        }
        return undefined;
    }

    private _processDataTypeOrVoid(treeCursor: MyTreeCursor): string {
        if (treeCursor.currentNode.firstChild !== null) {
            if (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_DATA_TYPE) {
                return this._processDataType({ currentNode: treeCursor.currentNode.firstChild });
            }
            else if (treeCursor.currentNode.firstChild.type != SystemVerilogIndexParser.S_VOID_KEYWORD) {
                ConnectionLogger.error(`Unexpected symbol type ${treeCursor.currentNode.firstChild.type} in data type or void in ${this._documentPath}`);
            }
        }
        return undefined;
    }

    private _processParameterPortList(treeCursor: MyTreeCursor) {
        let startSymbol: SyntaxNode = null;
        let dataType: string;
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_PARAM_ASSIGNMENT) {
                this._processParamAssignment({ currentNode: synNode }, ["parameter-port"].concat(dataType || []), startSymbol);
                startSymbol = null;
            }
            else if (synNode.type == SystemVerilogIndexParser.S_TYPE_ASSIGNMENT) {
                this._processTypeAssignment({ currentNode: synNode }, undefined, startSymbol);
            }
            else if (synNode.type == SystemVerilogIndexParser.S_PARAMETER_DECLARATION) {
                this._processParameterDeclaration({ currentNode: synNode }, ["parameter-port"]);
            }
            else if (synNode.type == SystemVerilogIndexParser.S_LOCALPARAM_DECLARATION) {
                this._processLocalParamDeclaration({ currentNode: synNode }, ["parameter-port"]);
            }
            else if (synNode.type == SystemVerilogIndexParser.S_DATA_TYPE) {
                dataType = this._processDataType({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_TYPE_KEYWORD) {
                startSymbol = synNode;
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_HASH_OPERATOR) &&
                     (synNode.type != SystemVerilogIndexParser.S_COMMA_OPERATOR) &&
                     (synNode.type != SystemVerilogIndexParser.S_OPEN_PARANTHESES) &&
                     (synNode.type != SystemVerilogIndexParser.S_CLOSE_PARANTHESES)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a parameter port list in ${this._documentPath}`);
            }
        });
    }

    private _processVariablePortType(treeCursor: MyTreeCursor): string {
        let dataType: string[] = [];
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_DATA_TYPE) {
                dataType.push(this._processDataType({ currentNode: synNode }));
            }
            else if ((synNode.type == SystemVerilogIndexParser.S_VAR_KEYWORD) ||
                     (synNode.type == SystemVerilogIndexParser.S_SIGNING)) {
                dataType.push(synNode.text);
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_SQUARE_BRACKETS_BLOCK)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a variable port type in ${this._documentPath}`);
            }
        });
        return dataType.join(' ');
    }

    private _processVariablePortHeader(treeCursor: MyTreeCursor): string {
        let dataType: string;
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_VARIABLE_PORT_TYPE) {
                dataType = this._processVariablePortType({ currentNode: synNode });
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_PORT_DIRECTION)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a variable port header in ${this._documentPath}`);
            }
        });
        return dataType;
    }

    private _processAnsiOrNonAnsiPortDeclaration(treeCursor: MyTreeCursor) {
        let dataType: string[] = [];
        treeCursor.currentNode.children.forEach(synNode => {
            if (this._isEscapedOrSimpleIdentifier(synNode)) {
                this._pushSymbol(synNode, ["port"].concat(dataType.join(' ')), { startSynNode: treeCursor.currentNode, endSynNode: treeCursor.currentNode });
                dataType = [];
            }
            else if (synNode.type == SystemVerilogIndexParser.S_DATA_TYPE) {
                dataType.push(this._processDataType({ currentNode: synNode }));
            }
            else if ((synNode.type == SystemVerilogIndexParser.S_NET_TYPE) ||
                     (synNode.type == SystemVerilogIndexParser.S_PORT_DIRECTION) ||
                     (synNode.type == SystemVerilogIndexParser.S_SIGNING) ||
                     (synNode.type == SystemVerilogIndexParser.S_INTERCONNECT_KEYWORD)) {
                dataType.push(synNode.text);
            }
            else if (synNode.type == SystemVerilogIndexParser.S_VARIABLE_PORT_HEADER) {
                dataType.push(this._processVariablePortHeader({ currentNode: synNode }));
            }
            else if (synNode.type == SystemVerilogIndexParser.S_INTERFACE_PORT_HEADER) {
                dataType.push(synNode.text);
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_SQUARE_BRACKETS_BLOCK) &&
                     (synNode.type != SystemVerilogIndexParser.S_EQUALS_OPERATOR) &&
                     (synNode.type != SystemVerilogIndexParser.S_CONSTANT_EXPRESSION) &&
                     (synNode.type != SystemVerilogIndexParser.S_DOT_OPERATOR) &&
                     (synNode.type != SystemVerilogIndexParser.S_PARANTHESES_BLOCK) &&
                     (synNode.type != SystemVerilogIndexParser.S_CURLY_BRACKETS_BLOCK)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a ansi or non ansi port declaration in ${this._documentPath}`);
            }
        });
    }

    private _processPortList(treeCursor: MyTreeCursor) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_ANSI_OR_NONANSI_PORT_DECLARATION) {
                this._processAnsiOrNonAnsiPortDeclaration({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_COMMA_OPERATOR) {
                //TBD
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_ATTRIBUTE_INSTANCE) &&
                     (synNode.type != SystemVerilogIndexParser.S_OPEN_PARANTHESES) &&
                     (synNode.type != SystemVerilogIndexParser.S_CLOSE_PARANTHESES)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a port list in ${this._documentPath}`);
            }
        });
    }

    private _processModuleHeader(treeCursor: MyTreeCursor, isExtern: Boolean) {
        //TBD extern
        treeCursor.currentNode.children.forEach(synNode => {
            if (this._isEscapedOrSimpleIdentifier(synNode)) {
                this._pushContainerSymbol(synNode, ["module"], { startSynNode: treeCursor.currentNode, endSynNode: treeCursor.currentNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_PACKAGE_IMPORT_DECLARATION) {
                this._processImportDeclaration({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_PARAMETER_PORT_LIST) {
                this._processParameterPortList({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_LIST_OF_PORT_DECLARATIONS) {
                this._processPortList({ currentNode: synNode });
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_MODULE_KEYWORD) &&
                     (synNode.type != SystemVerilogIndexParser.S_LIFETIME) &&
                     (synNode.type != SystemVerilogIndexParser.S_SEMICOLON_OPERATOR) &&
                     (synNode.type != SystemVerilogIndexParser.S_EMPTY_PORT_DECLARATION)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a module header in ${this._documentPath}`);
            }
        });
    }

    private _processInoutDeclaration(treeCursor: MyTreeCursor) {
        let netTypeText: string;
        let dataTypeText: string;
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_NET_TYPE) {
                netTypeText = synNode.text;
            }
            else if (synNode.type == SystemVerilogIndexParser.S_DATA_TYPE) {
                dataTypeText = this._processDataType({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_INTERCONNECT_KEYWORD) {
                netTypeText = synNode.text;
            }
            else if (this._isEscapedOrSimpleIdentifier(synNode)) {
                this._pushSymbol(synNode, [dataTypeText === undefined ? netTypeText : dataTypeText], { startSynNode: treeCursor.currentNode, endSynNode: treeCursor.currentNode });
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_INOUT_KEYWORD) &&
                     (synNode.type != SystemVerilogIndexParser.S_SIGNING) &&
                     (synNode.type != SystemVerilogIndexParser.S_SQUARE_BRACKETS_BLOCK)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in an inout declaration in ${this._documentPath}`);
            }
        });
    }

    private _processInputDeclaration(treeCursor: MyTreeCursor) {
        let netTypeText: string;
        let dataTypeText: string;
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_NET_TYPE) {
                netTypeText = synNode.text;
            }
            else if (synNode.type == SystemVerilogIndexParser.S_DATA_TYPE) {
                dataTypeText = this._processDataType({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_INTERCONNECT_KEYWORD) {
                netTypeText = synNode.text;
            }
            else if (synNode.type == SystemVerilogIndexParser.S_VARIABLE_PORT_TYPE) {
                dataTypeText = this._processVariablePortType({ currentNode: synNode });
            }
            else if (this._isEscapedOrSimpleIdentifier(synNode)) {
                this._pushSymbol(synNode, [dataTypeText === undefined ? netTypeText : dataTypeText], { startSynNode: treeCursor.currentNode, endSynNode: treeCursor.currentNode });
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_INPUT_KEYWORD) &&
                     (synNode.type != SystemVerilogIndexParser.S_SIGNING) &&
                     (synNode.type != SystemVerilogIndexParser.S_SQUARE_BRACKETS_BLOCK)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in an inout declaration in ${this._documentPath}`);
            }
        });
    }

    private _processOutputDeclaration(treeCursor: MyTreeCursor) {
        let netTypeText: string;
        let dataTypeText: string;
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_NET_TYPE) {
                netTypeText = synNode.text;
            }
            else if (synNode.type == SystemVerilogIndexParser.S_DATA_TYPE) {
                dataTypeText = this._processDataType({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_INTERCONNECT_KEYWORD) {
                netTypeText = synNode.text;
            }
            else if (synNode.type == SystemVerilogIndexParser.S_VARIABLE_PORT_TYPE) {
                dataTypeText = this._processVariablePortType({ currentNode: synNode });
            }
            else if (this._isEscapedOrSimpleIdentifier(synNode)) {
                this._pushSymbol(synNode, [dataTypeText === undefined ? netTypeText : dataTypeText], { startSynNode: treeCursor.currentNode, endSynNode: treeCursor.currentNode });
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_OUTPUT_KEYWORD) &&
                     (synNode.type != SystemVerilogIndexParser.S_SIGNING) &&
                     (synNode.type != SystemVerilogIndexParser.S_SQUARE_BRACKETS_BLOCK)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in an inout declaration in ${this._documentPath}`);
            }
        });
    }

    private _processRefDeclaration(treeCursor: MyTreeCursor) {
        let netTypeText: string;
        let dataTypeText: string;
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_VARIABLE_PORT_TYPE) {
                dataTypeText = this._processVariablePortType({ currentNode: synNode });
            }
            else if (this._isEscapedOrSimpleIdentifier(synNode)) {
                this._pushSymbol(synNode, [dataTypeText === undefined ? netTypeText : dataTypeText], { startSynNode: treeCursor.currentNode, endSynNode: treeCursor.currentNode });
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_REF_KEYWORD) &&
                     (synNode.type != SystemVerilogIndexParser.S_SQUARE_BRACKETS_BLOCK)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in an inout declaration in ${this._documentPath}`);
            }
        });
    }

    private _processPortDeclaration(treeCursor: MyTreeCursor) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_INOUT_DECLARATION) {
                this._processInoutDeclaration({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_INPUT_DECLARATION) {
                this._processInputDeclaration({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_OUTPUT_DECLARATION) {
                this._processOutputDeclaration({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_REF_DECLARATION) {
                this._processRefDeclaration({ currentNode: synNode });
            }
            else if (!this._isAllAllow(synNode)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a port declaration in ${this._documentPath}`);
            }
        });
    }

    private _processInstantiationInBaseGrammar(startSynNodeIndex: number, baseGrammarSynNodes: SyntaxNode[]): number {
        let synNodeIndex: number = startSynNodeIndex;
        while ((synNodeIndex < baseGrammarSynNodes.length) && this._isAllAllow(baseGrammarSynNodes[synNodeIndex])) {
            synNodeIndex++;
        }
        if (synNodeIndex >= baseGrammarSynNodes.length) {
            return startSynNodeIndex;
        }

        let instTypeSynNode: SyntaxNode = baseGrammarSynNodes[synNodeIndex];
        if (instTypeSynNode.type != SystemVerilogIndexParser.S_IDENTIFIER) {
            return startSynNodeIndex;
        }

        let instType: string;
        while (synNodeIndex < baseGrammarSynNodes.length) {
            synNodeIndex++;
            while ((synNodeIndex < baseGrammarSynNodes.length) && this._isAllAllow(baseGrammarSynNodes[synNodeIndex])) {
                synNodeIndex++;
            }
            if (synNodeIndex >= baseGrammarSynNodes.length) {
                return startSynNodeIndex;
            }

            let instSynNode: SyntaxNode = baseGrammarSynNodes[synNodeIndex];
            if (instSynNode.type != SystemVerilogIndexParser.S_IDENTIFIER) {
                return startSynNodeIndex;
            }

            synNodeIndex++;
            while ((synNodeIndex < baseGrammarSynNodes.length) && this._isAllAllow(baseGrammarSynNodes[synNodeIndex])) {
                synNodeIndex++;
            }
            if (synNodeIndex >= baseGrammarSynNodes.length) {
                return startSynNodeIndex;
            }

            let parenSynNode: SyntaxNode = baseGrammarSynNodes[synNodeIndex];
            if (parenSynNode.type != SystemVerilogIndexParser.S_PARANTHESES_BLOCK) {
                return startSynNodeIndex;
            }

            synNodeIndex++;
            while ((synNodeIndex < baseGrammarSynNodes.length) && this._isAllAllow(baseGrammarSynNodes[synNodeIndex])) {
                synNodeIndex++;
            }
            if (synNodeIndex >= baseGrammarSynNodes.length) {
                return startSynNodeIndex;
            }

            let opSynNode: SyntaxNode = baseGrammarSynNodes[synNodeIndex];
            if ((opSynNode.type != SystemVerilogIndexParser.S_SEMICOLON_OPERATOR) &&
                (opSynNode.type != SystemVerilogIndexParser.S_COMMA_OPERATOR)) {
                return startSynNodeIndex;
            }

            let instNameSynNode: SyntaxNode = this._getEscapedOrSimpleIdentifier(instSynNode);
            if (!!instNameSynNode) {
                if (!instType) {
                    instType = this._getInstType(instTypeSynNode);
                }
                this._pushSymbol(instNameSynNode, ["instance"].concat(!!instType ? [instType] : []), { startSynNode: instTypeSynNode, endSynNode: baseGrammarSynNodes[synNodeIndex] });
                if (baseGrammarSynNodes[synNodeIndex].type == SystemVerilogIndexParser.S_SEMICOLON_OPERATOR) {
                    return synNodeIndex + 1;
                }
            }
        }

        return startSynNodeIndex;
    }

    private _processBaseGrammarModuleItems(baseGrammarModuleItems: SyntaxNode[]) {
        let currSynNodeIndex: number = 0;
        let prevSyntaxNodeIndx: number = 0;
        while (currSynNodeIndex < baseGrammarModuleItems.length) {
            if (prevSyntaxNodeIndx == currSynNodeIndex) {
                currSynNodeIndex = this._processVariableDeclarationInBaseGrammar(currSynNodeIndex, baseGrammarModuleItems);
            }

            if (prevSyntaxNodeIndx == currSynNodeIndex) {
                currSynNodeIndex = this._processInstantiationInBaseGrammar(currSynNodeIndex, baseGrammarModuleItems);
            }

            if ((prevSyntaxNodeIndx == currSynNodeIndex) && this._isAllAllow(baseGrammarModuleItems[currSynNodeIndex])) {
                currSynNodeIndex++;
            }

            if (prevSyntaxNodeIndx == currSynNodeIndex) {
                currSynNodeIndex = this._processNullStatementInBaseGrammar(currSynNodeIndex, baseGrammarModuleItems);
            }

            if (prevSyntaxNodeIndx == currSynNodeIndex) {
                ConnectionLogger.error(`Unexpected symbol type ${baseGrammarModuleItems[currSynNodeIndex].type} in module item base grammar at index ${baseGrammarModuleItems[currSynNodeIndex].startIndex} in ${this._documentPath}`);
                currSynNodeIndex++;
            }
            prevSyntaxNodeIndx = currSynNodeIndex;
        }
    }

    private _processGenvarDeclaration(treeCursor: MyTreeCursor) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (this._isEscapedOrSimpleIdentifier(synNode)) {
                this._pushSymbol(synNode, ["variable", "genvar"], { startSynNode: treeCursor.currentNode, endSynNode: treeCursor.currentNode });
            }
            else if (!this._isAllAllow(synNode) &&
                (synNode.type != SystemVerilogIndexParser.S_GENVAR_KEYWORD) &&
                (synNode.type != SystemVerilogIndexParser.S_COMMA_OPERATOR) &&
                (synNode.type != SystemVerilogIndexParser.S_SEMICOLON_OPERATOR)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in genvar declaration in ${this._documentPath}`);
            }
        });
    }

    private _processModuleOrGenerateItemDeclaration(treeCursor: MyTreeCursor) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_PACKAGE_OR_GENERATE_ITEM_DECLARATION) {
                this._processPackageOrGenerateItemDeclaration({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_GENVAR_DECLARATION) {
                this._processGenvarDeclaration({ currentNode: synNode });
            }
            else if (!this._isAllAllow(synNode) &&
                (synNode.type != SystemVerilogIndexParser.S_CLOCKING_DECLARATION) &&
                (synNode.type != SystemVerilogIndexParser.S_DEFAULT_CLOCKING_DECLARATION) &&
                (synNode.type != SystemVerilogIndexParser.S_DEFAULT_DISABLE_DECLARATION)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in module or generate item declaration in ${this._documentPath}`);
            }
        });
    }

    private _processGenvarInitialization(treeCursor: MyTreeCursor) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (this._isEscapedOrSimpleIdentifier(synNode)) {
                this._pushSymbol(synNode, ["variable", "genvar"], { startSynNode: treeCursor.currentNode, endSynNode: treeCursor.currentNode });
            }
            else if (!this._isAllAllow(synNode) &&
                (synNode.type != SystemVerilogIndexParser.S_GENVAR_KEYWORD) &&
                (synNode.type != SystemVerilogIndexParser.S_EQUALS_OPERATOR) &&
                (synNode.type != SystemVerilogIndexParser.S_BASE_GRAMMAR)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in genvar initialization in ${this._documentPath}`);
            }
        });
    }

    private _processLoopGenerateConstruct(treeCursor: MyTreeCursor) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_GENERATE_ITEM) {
                this._processGenerateItem({ currentNode: synNode});
            }
            else if (!this._isAllAllow(synNode) &&
                (synNode.type != SystemVerilogIndexParser.S_FOR_KEYWORD) &&
                (synNode.type != SystemVerilogIndexParser.S_OPEN_PARANTHESES) &&
                (synNode.type != SystemVerilogIndexParser.S_GENVAR_INITIALIZATION) &&
                (synNode.type != SystemVerilogIndexParser.S_SEMICOLON_OPERATOR) &&
                (synNode.type != SystemVerilogIndexParser.S_BASE_GRAMMAR) &&
                (synNode.type != SystemVerilogIndexParser.S_CLOSE_PARANTHESES)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in loop generate construct in ${this._documentPath}`);
            }
        });
    }

    private _processIfGenerateConstruct(treeCursor: MyTreeCursor) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_GENERATE_ITEM) {
                this._processGenerateItem({ currentNode: synNode });
            }
            else if (!this._isAllAllow(synNode) &&
                 (synNode.type != SystemVerilogIndexParser.S_IF_KEYWORD) &&
                 (synNode.type != SystemVerilogIndexParser.S_PARANTHESES_BLOCK) &&
                 (synNode.type != SystemVerilogIndexParser.S_ELSE_KEYWORD)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in if generate construct in ${this._documentPath}`);
            }
        });
    }

    private _processConditionalGenerateConstruct(treeCursor: MyTreeCursor) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_IF_GENERATE_CONSTRUCT) {
                this._processIfGenerateConstruct({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_CASE_GENERATE_CONSTRUCT) {
                //TBD
            }
            else if (!this._isAllAllow(synNode)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in conditional generate construct in ${this._documentPath}`);
            }
        });
    }

    private _processModuleCommonItem(treeCursor: MyTreeCursor) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_MODULE_OR_GENERATE_ITEM_DECLARATION) {
                this._processModuleOrGenerateItemDeclaration({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_LOOP_GENERATE_CONSTRUCT) {
                this._processLoopGenerateConstruct({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_CONDITIONAL_GENERATE_CONSTRUCT) {
                this._processConditionalGenerateConstruct({ currentNode: synNode });
            }
            else if (!this._isAllAllow(synNode) &&
                (synNode.type != SystemVerilogIndexParser.S_ASSERTION_ITEM) &&
                (synNode.type != SystemVerilogIndexParser.S_BIND_DIRECTIVE) &&
                (synNode.type != SystemVerilogIndexParser.S_CONTINUOUS_ASSIGN) &&
                (synNode.type != SystemVerilogIndexParser.S_NET_ALIAS) &&
                (synNode.type != SystemVerilogIndexParser.S_INITIAL_CONSTRUCT) &&
                (synNode.type != SystemVerilogIndexParser.S_FINAL_CONSTRUCT) &&
                (synNode.type != SystemVerilogIndexParser.S_ALWAYS_CONSTRUCT)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a module common item in ${this._documentPath}`);
            }
        });
    }

    private _processModuleOrGenerateItem(treeCursor: MyTreeCursor) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_GATE_INSTANTIATION) {
                //TBD
            }
            else if (synNode.type == SystemVerilogIndexParser.S_MODULE_COMMON_ITEM) {
                this._processModuleCommonItem({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_BASE_MODULE_OR_GENERATE_ITEM_STATEMENT) {
                this._processBaseGrammarModuleItems(synNode.children);
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_ATTRIBUTE_INSTANCE) &&
                     (synNode.type != SystemVerilogIndexParser.S_PARAMETER_OVERRIDE)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a module or generate item in ${this._documentPath}`);
            }
        });
    }

    private _processGenerateBlock(treeCursor: MyTreeCursor) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_GENERATE_ITEM) {
                this._processGenerateItem({ currentNode: synNode });
            }
            else if (!this._isAllAllow(synNode) &&
                 !this._isEscapedOrSimpleIdentifier(synNode) &&
                 (synNode.type != SystemVerilogIndexParser.S_COLON_OPERATOR) &&
                 (synNode.type != SystemVerilogIndexParser.S_BEGIN_KEYWORD) &&
                 (synNode.type != SystemVerilogIndexParser.S_END_KEYWORD)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a generate block in ${this._documentPath}`);
            }
        });
    }

    private _processGenerateItem(treeCursor: MyTreeCursor) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_MODULE_OR_GENERATE_ITEM) {
                this._processModuleOrGenerateItem({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_UNIQUE_INTERFACE_OR_GENERATE_ITEM) {
                //TBD
            }
            else if (synNode.type == SystemVerilogIndexParser.S_UNIQUE_CHECKER_OR_GENERATE_ITEM) {
                //TBD
            }
            else if (synNode.type == SystemVerilogIndexParser.S_GENERATE_BLOCK) {
                this._processGenerateBlock({ currentNode: synNode });
            }
            else if (!this._isAllAllow(synNode)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a generate item in ${this._documentPath}`);
            }
        });
    }

    private _processGenerateRegion(treeCursor: MyTreeCursor) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_GENERATE_ITEM) {
                this._processGenerateItem({ currentNode: synNode });
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_GENERATE_KEYWORD) &&
                     (synNode.type != SystemVerilogIndexParser.S_ENDGENERATE_KEYWORD)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a generate region in ${this._documentPath}`);
            }
        });
    }

    private _processNonPortModuleItem(treeCursor: MyTreeCursor) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_GENERATE_REGION) {
                this._processGenerateRegion({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_MODULE_OR_GENERATE_ITEM) {
                this._processModuleOrGenerateItem({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_MODULE_DECLARATION) {
                this._processModuleDeclaration({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_INTERFACE_DECLARATION) {
                this._processInterfaceDeclaration({ currentNode: synNode });
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_ATTRIBUTE_INSTANCE) &&
                     (synNode.type != SystemVerilogIndexParser.S_SPECIFY_BLOCK) &&
                     (synNode.type != SystemVerilogIndexParser.S_SPECPARAM_DECLARATION) &&
                     (synNode.type != SystemVerilogIndexParser.S_PROGRAM_DECLARATION) &&
                     (synNode.type != SystemVerilogIndexParser.S_TIMEUNITS_DECLARATION)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a non port module item in ${this._documentPath}`);
            }
        });
    }

    private _processModuleItem(treeCursor: MyTreeCursor) {
        if (treeCursor.currentNode.firstChild != null) {
            if (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_PORT_DECLARATION) {
                treeCursor.currentNode.children.forEach(synNode => {
                    if (synNode.type == SystemVerilogIndexParser.S_PORT_DECLARATION) {
                        this._processPortDeclaration({ currentNode: synNode });
                    }
                    else if (!this._isAllAllow(synNode) &&
                             (synNode.type != SystemVerilogIndexParser.S_SEMICOLON_OPERATOR)) {
                        ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a module item port declaration in ${this._documentPath}`);
                    }
                });
            }
            else if (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_NON_PORT_MODULE_ITEM) {
                this._processNonPortModuleItem({ currentNode: treeCursor.currentNode.firstChild });
            }
            else {
                ConnectionLogger.error(`Unexpected symbol type ${treeCursor.currentNode.firstChild.type} in a module item in ${this._documentPath}`);
            }
        }
    }

    private _processModuleDeclaration(treeCursor: MyTreeCursor): Boolean {
        if (treeCursor.currentNode.type != SystemVerilogIndexParser.S_MODULE_DECLARATION) {
            return false;
        }

        let extern_module: Boolean = (treeCursor.currentNode.firstChild !== null) && (treeCursor.currentNode.firstChild.type === SystemVerilogIndexParser.S_EXTERN_KEYWORD);

        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_MODULE_HEADER) {
                this._processModuleHeader({ currentNode: synNode }, extern_module);
            }
            else if (synNode.type == SystemVerilogIndexParser.S_MODULE_ITEM) {
                this._processModuleItem({ currentNode: synNode });
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_EXTERN_KEYWORD) &&
                     (synNode.type != SystemVerilogIndexParser.S_ENDMODULE_DECLARATION)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a ${extern_module ? "extern" : ""} module header in ${this._documentPath}`);
            }
        });

        this._containerStack.pop(this._getEndPosition(treeCursor.currentNode.lastChild));

        return true;
    }

    private _processInterfaceHeader(treeCursor: MyTreeCursor, isExtern: Boolean) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (this._isEscapedOrSimpleIdentifier(synNode)) {
                this._pushContainerSymbol(synNode, ["interface"], { startSynNode: treeCursor.currentNode, endSynNode: treeCursor.currentNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_PACKAGE_IMPORT_DECLARATION) {
                this._processImportDeclaration({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_PARAMETER_PORT_LIST) {
                this._processParameterPortList({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_LIST_OF_PORT_DECLARATIONS) {
                this._processPortList({ currentNode: synNode });
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_INTERFACE_KEYWORD) &&
                     (synNode.type != SystemVerilogIndexParser.S_LIFETIME) &&
                     (synNode.type != SystemVerilogIndexParser.S_SEMICOLON_OPERATOR) &&
                     (synNode.type != SystemVerilogIndexParser.S_EMPTY_PORT_DECLARATION)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a interface header in ${this._documentPath}`);
            }
        });
    }

    private _processInterfaceOrGenerateItem(treeCursor: MyTreeCursor) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_MODULE_COMMON_ITEM) {
                this._processModuleCommonItem({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_BASE_MODULE_OR_GENERATE_ITEM_STATEMENT) {
                this._processBaseGrammarModuleItems(synNode.children);
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_ATTRIBUTE_INSTANCE) &&
                     (synNode.type != SystemVerilogIndexParser.S_EXTERN_TF_DECLARATION)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a interface or generate item in ${this._documentPath}`);
            }
        });
    }

    private _processModportSimplePort(treeCursor: MyTreeCursor, parentNode: SyntaxNode) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (this._isEscapedOrSimpleIdentifier(synNode)) {
                this._pushSymbol(synNode, ["port", parentNode.firstChild.text], { startSynNode: parentNode, endSynNode: parentNode });
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_DOT_OPERATOR) &&
                     (synNode.type != SystemVerilogIndexParser.S_PARANTHESES_BLOCK)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a modport simple port in ${this._documentPath}`);
            }
        });
    }

    private _processModportSimplePortsDeclaration(treeCursor: MyTreeCursor) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_MODPORT_SIMPLE_PORT) {
                this._processModportSimplePort({ currentNode: synNode }, treeCursor.currentNode);
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_PORT_DIRECTION) &&
                     (synNode.type != SystemVerilogIndexParser.S_COMMA_OPERATOR)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a modport simple ports declaration in ${this._documentPath}`);
            }
        });
    }

    private _processModportPortsDeclaration(treeCursor: MyTreeCursor) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_MODPORT_SIMPLE_PORTS_DECLARATION) {
                this._processModportSimplePortsDeclaration({ currentNode: synNode });
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_ATTRIBUTE_INSTANCE) &&
                     (synNode.type != SystemVerilogIndexParser.S_MODPORT_TF_PORTS_DECLARATION) &&
                     (synNode.type != SystemVerilogIndexParser.S_MODPORT_CLOCKING_DECLARATION)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a modport ports declaration in ${this._documentPath}`);
            }
        });
    }

    private _processModportItem(treeCursor: MyTreeCursor) {
        let modportSymbol: SystemVerilogSymbol = this._pushContainerSymbol(
            treeCursor.currentNode.firstChild,
            ["modport"],
            { startSynNode: treeCursor.currentNode, endSynNode: treeCursor.currentNode });

        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_MODPORT_PORTS_DECLARATION) {
                this._processModportPortsDeclaration({ currentNode: synNode });
            }
            else if (!this._isAllAllow(synNode) &&
                     !this._isEscapedOrSimpleIdentifier(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_OPEN_PARANTHESES) &&
                     (synNode.type != SystemVerilogIndexParser.S_COMMA_OPERATOR) &&
                     (synNode.type != SystemVerilogIndexParser.S_CLOSE_PARANTHESES)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a modport item in ${this._documentPath}`);
            }
        });

        this._containerStack.pop(this._getEndPosition(treeCursor.currentNode.lastChild));
    }

    private _processModportDeclaration(treeCursor: MyTreeCursor) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_MODPORT_ITEM) {
                this._processModportItem({ currentNode: synNode });
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_MODPORT_KEYWORD) &&
                     (synNode.type != SystemVerilogIndexParser.S_SEMICOLON_OPERATOR) &&
                     (synNode.type != SystemVerilogIndexParser.S_COMMA_OPERATOR)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a module or generate item in ${this._documentPath}`);
            }
        });
    }

    private _processNonPortInterfaceItem(treeCursor: MyTreeCursor) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_GENERATE_REGION) {
                this._processGenerateRegion({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_INTERFACE_OR_GENERATE_ITEM) {
                this._processInterfaceOrGenerateItem({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_INTERFACE_DECLARATION) {
                this._processInterfaceDeclaration({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_MODPORT_DECLARATION) {
                this._processModportDeclaration({ currentNode: synNode });
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_PROGRAM_DECLARATION) &&
                     (synNode.type != SystemVerilogIndexParser.S_TIMEUNITS_DECLARATION)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a non port interface item in ${this._documentPath}`);
            }
        });
    }

    private _processInterfaceItem(treeCursor: MyTreeCursor) {
        if (treeCursor.currentNode.firstChild != null) {
            if (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_PORT_DECLARATION) {
                treeCursor.currentNode.children.forEach(synNode => {
                    if (synNode.type == SystemVerilogIndexParser.S_PORT_DECLARATION) {
                        this._processPortDeclaration({ currentNode: synNode });
                    }
                    else if (!this._isAllAllow(synNode) &&
                             (synNode.type != SystemVerilogIndexParser.S_SEMICOLON_OPERATOR)) {
                        ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in an interface item port declaration in ${this._documentPath}`);
                    }
                });
            }
            else if (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_NON_PORT_INTERFACE_ITEM) {
                this._processNonPortInterfaceItem({ currentNode: treeCursor.currentNode.firstChild });
            }
            else {
                ConnectionLogger.error(`Unexpected symbol type ${treeCursor.currentNode.firstChild.type} in an interface item in ${this._documentPath}`);
            }
        }
    }

    private _processInterfaceDeclaration(treeCursor: MyTreeCursor): Boolean {
        if (treeCursor.currentNode.type != SystemVerilogIndexParser.S_INTERFACE_DECLARATION) {
            return false;
        }

        let extern_interface: Boolean = (treeCursor.currentNode.firstChild !== null) && (treeCursor.currentNode.firstChild.type === SystemVerilogIndexParser.S_EXTERN_KEYWORD);

        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_INTERFACE_HEADER) {
                this._processInterfaceHeader({ currentNode: synNode }, extern_interface);
            }
            else if (synNode.type == SystemVerilogIndexParser.S_INTERFACE_ITEM) {
                this._processInterfaceItem({ currentNode: synNode });
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_EXTERN_KEYWORD) &&
                     (synNode.type != SystemVerilogIndexParser.S_ENDINTERFACE_DECLARATION)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a ${extern_interface ? "extern" : ""} interface header in ${this._documentPath}`);
            }
        });

        this._containerStack.pop(this._getEndPosition(treeCursor.currentNode.lastChild));

        return true;
    }

    private _processPackageHeader(treeCursor: MyTreeCursor) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (this._isEscapedOrSimpleIdentifier(synNode)) {
                this._pushContainerSymbol(synNode, ["package"], { startSynNode: treeCursor.currentNode, endSynNode: treeCursor.currentNode });
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_PACKAGE_KEYWORD) &&
                     (synNode.type != SystemVerilogIndexParser.S_LIFETIME) &&
                     (synNode.type != SystemVerilogIndexParser.S_SEMICOLON_OPERATOR)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a package header in ${this._documentPath}`);
            }
        });
    }

    private _processPackageExportDeclaration(treeCursor: MyTreeCursor) {
        let packageName: string;
        let exportName: string;
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_STAR_OPERATOR) {
                if (packageName === undefined) {
                    packageName = synNode.text;
                }
                else if (exportName === undefined) {
                    exportName = synNode.text;
                }
                else {
                    ConnectionLogger.error(`Parsing failed for symbol ${synNode.text} in a package export declaration in ${this._documentPath}`);
                }
            }
            else if (this._isEscapedOrSimpleIdentifier(synNode)) {
                if (packageName === undefined) {
                    packageName = synNode.text;
                }
                else if (exportName === undefined) {
                    exportName = synNode.text;
                }
                else {
                    ConnectionLogger.error(`Parsing failed for symbol ${synNode.text} in a package export declaration in ${this._documentPath}`);
                }
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_EXPORT_KEYWORD) &&
                     (synNode.type != SystemVerilogIndexParser.S_DOUBLE_COLON_OPERATOR) &&
                     (synNode.type != SystemVerilogIndexParser.S_SEMICOLON_OPERATOR)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a package export declaration in ${this._documentPath}`);
            }
        });
        if ((packageName !== undefined) && (exportName !== undefined)) {
            this._containerStack.pushExportItemParts(packageName, exportName);
        }
    }

    private _processNetDeclAssignment(treeCursor: MyTreeCursor, definitionRange: SymbolDefinitionRange, netTypeText?: string, dataTypeText?: string) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_NET_IDENTIFIER) {
                this._pushSymbol(synNode.firstChild, ["variable"].concat([dataTypeText === undefined ? netTypeText : dataTypeText]), definitionRange);
            }
            else if (!this._isAllAllow(synNode) &&
                     !this._isBaseGrammar(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_SQUARE_BRACKETS_BLOCK) &&
                     (synNode.type != SystemVerilogIndexParser.S_EQUALS_OPERATOR) &&
                     (synNode.type != SystemVerilogIndexParser.S_EXPRESSION)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a net decl assignment in ${this._documentPath}`);
            }
        });
    }

    private _processNetDeclaration(treeCursor: MyTreeCursor) {
        let netTypeText: string;
        let dataTypeText: string;
        if (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_NET_TYPE) {
            treeCursor.currentNode.children.forEach(synNode => {
                if (synNode.type == SystemVerilogIndexParser.S_NET_TYPE) {
                    netTypeText = synNode.text;
                }
                else if (synNode.type == SystemVerilogIndexParser.S_DATA_TYPE) {
                    dataTypeText = this._processDataType({ currentNode: synNode });
                }
                else if (synNode.type == SystemVerilogIndexParser.S_NET_DECL_ASSIGNMENT) {
                    this._processNetDeclAssignment({ currentNode: synNode }, { startSynNode: treeCursor.currentNode, endSynNode: treeCursor.currentNode }, netTypeText, dataTypeText);
                }
                else if (!this._isAllAllow(synNode) &&
                         (synNode.type != SystemVerilogIndexParser.S_PARANTHESES_BLOCK) &&
                         (synNode.type != SystemVerilogIndexParser.S_VECTORED_KEYWORD) &&
                         (synNode.type != SystemVerilogIndexParser.S_SCALARED_KEYWORD) &&
                         (synNode.type != SystemVerilogIndexParser.S_SIGNING) &&
                         (synNode.type != SystemVerilogIndexParser.S_SQUARE_BRACKETS_BLOCK) &&
                         (synNode.type != SystemVerilogIndexParser.S_DELAY3) &&
                         (synNode.type != SystemVerilogIndexParser.S_SEMICOLON_OPERATOR)) {
                    ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a net declaration in ${this._documentPath}`);
                }
            });
        }
        else if (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_INTERCONNECT_KEYWORD) {
            treeCursor.currentNode.children.forEach(synNode => {
                if (synNode.type == SystemVerilogIndexParser.S_INTERCONNECT_KEYWORD) {
                    netTypeText = synNode.text;
                }
                else if (synNode.type == SystemVerilogIndexParser.S_DATA_TYPE) {
                    dataTypeText = this._processDataType({ currentNode: synNode });
                }
                else if (synNode.type == SystemVerilogIndexParser.S_NET_IDENTIFIER) {
                    this._pushSymbol(synNode, [dataTypeText === undefined ? netTypeText : dataTypeText], { startSynNode: treeCursor.currentNode, endSynNode: treeCursor.currentNode });
                }
                else if (!this._isAllAllow(synNode) &&
                         (synNode.type != SystemVerilogIndexParser.S_SIGNING) &&
                         (synNode.type != SystemVerilogIndexParser.S_SQUARE_BRACKETS_BLOCK) &&
                         (synNode.type != SystemVerilogIndexParser.S_HASH_OPERATOR) &&
                         (synNode.type != SystemVerilogIndexParser.S_DELAY_VALUE) &&
                         (synNode.type != SystemVerilogIndexParser.S_COMMA_OPERATOR) &&
                         (synNode.type != SystemVerilogIndexParser.S_SEMICOLON_OPERATOR)) {
                    ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a interconnect net declaration in ${this._documentPath}`);
                }
            });
        }
    }

    private _processExplicitDataIndicatorExplicitDataDeclaration(treeCursor: MyTreeCursor) {
        let dataTypeText: string;
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_DATA_TYPE) {
                dataTypeText = this._processDataType({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_LIST_OF_VARIABLE_DECL_ASSIGNMENTS) {
                this._processListOfVariableDeclAssignments({ currentNode: synNode }, ["variable"].concat(dataTypeText || []), treeCursor.currentNode);
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_EXPLICIT_DATA_INDICATOR) &&
                     (synNode.type != SystemVerilogIndexParser.S_SEMICOLON_OPERATOR)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a explicit data indicator explicit data declaration in ${this._documentPath}`);
            }
        });
    }

    private _processExplicitDataTypeExplicitDataDeclaration(treeCursor: MyTreeCursor) {
        let dataTypeText: string;
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_EXPLICIT_DATA_TYPE) {
                dataTypeText = this._processDataType({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_LIST_OF_VARIABLE_DECL_ASSIGNMENTS) {
                this._processListOfVariableDeclAssignments({ currentNode: synNode }, ["variable"].concat(dataTypeText || []), treeCursor.currentNode);
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_SEMICOLON_OPERATOR)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a explicit data type explicit data declaration in ${this._documentPath}`);
            }
        });
    }

    private _processTypedef1Declaration(treeCursor: MyTreeCursor) {
        let symType: string[] = [];
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_TYPEDEF_KEYWORD) {
                symType.push(synNode.text);
            }
            else if (synNode.type == SystemVerilogIndexParser.S_DATA_TYPE) {
                symType.push(this._processDataType({ currentNode: synNode }));
            }
            else if (this._isEscapedOrSimpleIdentifier(synNode)) {
                this._pushSymbol(synNode, symType, { startSynNode: treeCursor.currentNode, endSynNode: treeCursor.currentNode });
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_SQUARE_BRACKETS_BLOCK) &&
                     (synNode.type != SystemVerilogIndexParser.S_SEMICOLON_OPERATOR)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a typedef1 declaration in ${this._documentPath}`);
            }
        });
    }

    private _processTypedef2Declaration(treeCursor: MyTreeCursor) {
        let idCount: number = 0;
        let symType: string[] = [];
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_TYPEDEF_KEYWORD) {
                symType.push(synNode.text);
            }
            else if (this._isEscapedOrSimpleIdentifier(synNode)) {
                if (idCount == 0) {
                    symType.push("");
                }
                idCount++;
                if (idCount == 3) {
                    this._pushSymbol(synNode, symType, { startSynNode: treeCursor.currentNode, endSynNode: treeCursor.currentNode });
                }
                else {
                    symType[symType.length - 1] += synNode.text;
                }
            }
            else if ((synNode.type == SystemVerilogIndexParser.S_SQUARE_BRACKETS_BLOCK) ||
                     (synNode.type == SystemVerilogIndexParser.S_DOT_OPERATOR)) {
                symType[symType.length - 1] += synNode.text;
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_SEMICOLON_OPERATOR)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a typedef1 declaration in ${this._documentPath}`);
            }
        });
    }

    private _processTypedef3Declaration(treeCursor: MyTreeCursor) {
        let typedefKeywordText: string;
        let symType: string[] = [];
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_TYPEDEF_KEYWORD) {
                typedefKeywordText = synNode.text;
            }
            else if (this._isEscapedOrSimpleIdentifier(synNode)) {
                this._pushSymbol(synNode, [typedefKeywordText].concat(symType), { startSynNode: treeCursor.currentNode, endSynNode: treeCursor.currentNode });
            }
            else if ((synNode.type == SystemVerilogIndexParser.S_ENUM_KEYWORD) ||
                     (synNode.type == SystemVerilogIndexParser.S_STRUCT_KEYWORD) ||
                     (synNode.type == SystemVerilogIndexParser.S_UNION_KEYWORD) ||
                     (synNode.type == SystemVerilogIndexParser.S_CLASS_KEYWORD) ||
                     (synNode.type == SystemVerilogIndexParser.S_INTERFACE_KEYWORD)) {
                symType.push(synNode.text);
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_SEMICOLON_OPERATOR)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a typedef1 declaration in ${this._documentPath}`);
            }
        });
    }

    private _processTypeDeclaration(treeCursor: MyTreeCursor) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_TYPEDEF1_DECLARATION) {
                this._processTypedef1Declaration({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_TYPEDEF2_DECLARATION) {
                this._processTypedef2Declaration({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_TYPEDEF3_DECLARATION) {
                this._processTypedef3Declaration({ currentNode: synNode });
            }
            else if (!this._isAllAllow(synNode)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a type declaration in ${this._documentPath}`);
            }
        });
    }

    private _processExplicitDataDeclaration(treeCursor: MyTreeCursor) {
        if (treeCursor.currentNode.firstChild !== null) {
            if (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_EXPLICIT_DATA_INDICATOR) {
                this._processExplicitDataIndicatorExplicitDataDeclaration(treeCursor);
            }
            else if (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_EXPLICIT_DATA_TYPE) {
                this._processExplicitDataTypeExplicitDataDeclaration(treeCursor);
            }
            else if (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_PACKAGE_IMPORT_DECLARATION) {
                this._processImportDeclaration({ currentNode: treeCursor.currentNode.firstChild });
            }
            else if (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_TYPE_DECLARATION) {
                this._processTypeDeclaration({ currentNode: treeCursor.currentNode.firstChild });
            }
            else if (!this._isAllAllow(treeCursor.currentNode.firstChild) &&
                     (treeCursor.currentNode.firstChild.type != SystemVerilogIndexParser.S_NET_TYPE_DECLARATION)) {
                ConnectionLogger.error(`Unexpected symbol type ${treeCursor.currentNode.firstChild.type} in a explicit data declaration in ${this._documentPath}`);
            }
        }
    }

    private _processVariableInDataDeclaration(treeCursor: MyTreeCursor) {
        let dataType: string[] = [];
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_DATA_TYPE) {
                dataType.push(this._processDataType({ currentNode: synNode }));
            }
            else if (synNode.type == SystemVerilogIndexParser.S_LIST_OF_VARIABLE_DECL_ASSIGNMENTS) {
                this._processListOfVariableDeclAssignments({ currentNode: synNode }, ["variable"].concat(dataType.length > 0 ? dataType.join(' ') : []), treeCursor.currentNode);
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_CONST_KEYWORD) &&
                     (synNode.type != SystemVerilogIndexParser.S_VAR_KEYWORD) &&
                     (synNode.type != SystemVerilogIndexParser.S_LIFETIME) &&
                     (synNode.type != SystemVerilogIndexParser.S_SIGNING) &&
                     (synNode.type != SystemVerilogIndexParser.S_SQUARE_BRACKETS_BLOCK) &&
                     (synNode.type != SystemVerilogIndexParser.S_SEMICOLON_OPERATOR)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a variable in data declaration in ${this._documentPath}`);
            }
        });
    }

    private _processDataDeclaration(treeCursor: MyTreeCursor) {
        if (treeCursor.currentNode.firstChild !== null) {
            if ((treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_CONST_KEYWORD) ||
                (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_VAR_KEYWORD) ||
                (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_LIFETIME) ||
                (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_DATA_TYPE) ||
                (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_SIGNING) ||
                (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_SQUARE_BRACKETS_BLOCK)) {
                this._processVariableInDataDeclaration(treeCursor);
            }
            else if (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_TYPE_DECLARATION) {
                this._processTypeDeclaration({ currentNode: treeCursor.currentNode.firstChild });
            }
            else if (treeCursor.currentNode.firstChild.type == SystemVerilogIndexParser.S_PACKAGE_IMPORT_DECLARATION) {
                this._processImportDeclaration({ currentNode: treeCursor.currentNode.firstChild });
            }
            else if (!this._isAllAllow(treeCursor.currentNode.firstChild) &&
                     (treeCursor.currentNode.firstChild.type != SystemVerilogIndexParser.S_NET_TYPE_DECLARATION) &&
                     (treeCursor.currentNode.firstChild.type != SystemVerilogIndexParser.S_LIST_OF_VARIABLE_DECL_ASSIGNMENTS)) {
                ConnectionLogger.error(`Unexpected symbol type ${treeCursor.currentNode.firstChild.type} in a data declaration in ${this._documentPath}`);
            }
        }
    }

    private _processVariableDeclarationInBaseGrammar(startSynNodeIndex: number, baseGrammarSynNodes: SyntaxNode[]): number {
        let synNodeIndex: number = startSynNodeIndex;
        while ((synNodeIndex < baseGrammarSynNodes.length) && this._isAllAllow(baseGrammarSynNodes[synNodeIndex])) {
            synNodeIndex++;
        }
        if (synNodeIndex >= baseGrammarSynNodes.length) {
            return startSynNodeIndex;
        }

        let dataTypeSynNode: SyntaxNode = baseGrammarSynNodes[synNodeIndex];
        if (dataTypeSynNode.type != SystemVerilogIndexParser.S_IDENTIFIER) {
            return startSynNodeIndex;
        }

        let dataType: string;
        while (synNodeIndex < baseGrammarSynNodes.length) {
            synNodeIndex++;
            while ((synNodeIndex < baseGrammarSynNodes.length) && this._isAllAllow(baseGrammarSynNodes[synNodeIndex])) {
                synNodeIndex++;
            }
            if (synNodeIndex >= baseGrammarSynNodes.length) {
                return startSynNodeIndex;
            }

            let varSynNode: SyntaxNode = baseGrammarSynNodes[synNodeIndex];
            if (varSynNode.type != SystemVerilogIndexParser.S_IDENTIFIER) {
                return startSynNodeIndex;
            }

            synNodeIndex++;
            while ((synNodeIndex < baseGrammarSynNodes.length) && this._isAllAllow(baseGrammarSynNodes[synNodeIndex])) {
                synNodeIndex++;
            }
            if (synNodeIndex >= baseGrammarSynNodes.length) {
                return startSynNodeIndex;
            }

            let opSynNode: SyntaxNode = baseGrammarSynNodes[synNodeIndex];
            if ((opSynNode.type != SystemVerilogIndexParser.S_SIMPLE_OPERATORS) &&
                (opSynNode.type != SystemVerilogIndexParser.S_SEMICOLON_OPERATOR) &&
                (opSynNode.type != SystemVerilogIndexParser.S_COMMA_OPERATOR)) {
                return startSynNodeIndex;
            }
            if ((opSynNode.type == SystemVerilogIndexParser.S_SIMPLE_OPERATORS) &&
               (opSynNode.text != '=')) {
                return startSynNodeIndex;
            }

            while (synNodeIndex < baseGrammarSynNodes.length) {
                if ((baseGrammarSynNodes[synNodeIndex].type == SystemVerilogIndexParser.S_SEMICOLON_OPERATOR) ||
                    (baseGrammarSynNodes[synNodeIndex].type == SystemVerilogIndexParser.S_COMMA_OPERATOR)) {
                    break;
                }
                synNodeIndex++;
            }
            if (synNodeIndex == baseGrammarSynNodes.length) {
                return startSynNodeIndex;
            }

            let varNameSynNode: SyntaxNode = this._getEscapedOrSimpleIdentifier(varSynNode);
            if (!!varNameSynNode) {
                if (!dataType) {
                    dataType = this._getDataType(dataTypeSynNode);
                }
                this._pushSymbol(varNameSynNode, ["variable"].concat(!!dataType ? [dataType] : []), { startSynNode: dataTypeSynNode, endSynNode: baseGrammarSynNodes[synNodeIndex] });
                if (baseGrammarSynNodes[synNodeIndex].type == SystemVerilogIndexParser.S_SEMICOLON_OPERATOR) {
                    return synNodeIndex + 1;
                }
            }
        }

        return startSynNodeIndex;
    }

    private _processVariableDeclarationInStatementOrNull(treeCursor: MyTreeCursor): Boolean {
        let varFound: Boolean = false;
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_STATEMENT_ITEM) {
                if ((synNode.firstChild !== null) &&
                    (synNode.firstChild.type == SystemVerilogIndexParser.S_BASE_STATEMENT)) {
                    let res: number = this._processVariableDeclarationInBaseGrammar(0, synNode.firstChild.children);
                    varFound = res > 0;
                }
            }
            else if (!this._isAllAllow(synNode) &&
                     !this._isEscapedOrSimpleIdentifier(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_COLON_OPERATOR)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a variable declaration in statement or null ${this._documentPath}`);
            }
        });
        return varFound;
    }

    private _processTfPortItem(treeCursor: MyTreeCursor) {
        let dataType: string[] = [];
        let portDirection: string;
        treeCursor.currentNode.children.forEach(synNode => {
            if (this._isEscapedOrSimpleIdentifier(synNode)) {
                this._pushSymbol(synNode, ["port"].concat(dataType.length > 0 ? dataType.join(' ') : (!!portDirection ? portDirection : [])), { startSynNode: treeCursor.currentNode, endSynNode: treeCursor.currentNode });
                dataType = [];
            }
            else if (synNode.type == SystemVerilogIndexParser.S_DATA_TYPE) {
                dataType.push(this._processDataType({ currentNode: synNode }));
            }
            else if (synNode.type == SystemVerilogIndexParser.S_SIGNING) {
                dataType.push(synNode.text);
            }
            else if (synNode.type == SystemVerilogIndexParser.S_TF_PORT_DIRECTION) {
                portDirection = synNode.text;
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_VAR_KEYWORD) &&
                     (synNode.type != SystemVerilogIndexParser.S_SQUARE_BRACKETS_BLOCK) &&
                     (synNode.type != SystemVerilogIndexParser.S_EQUALS_OPERATOR) &&
                     (synNode.type != SystemVerilogIndexParser.S_EXPRESSION)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a ansi or non ansi port declaration in ${this._documentPath}`);
            }
        });
    }

    private _processTaskNonPortHeader(treeCursor: MyTreeCursor, startSynNode: SyntaxNode): SystemVerilogSymbol {
        let taskSymbol: SystemVerilogSymbol;
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_TASK_IDENTIFIER) {
                taskSymbol = this._pushContainerSymbol(synNode, [startSynNode.text], { startSynNode: startSynNode, endSynNode: treeCursor.currentNode });
            }
            else if (!this._isAllAllow(synNode) &&
                     !this._isEscapedOrSimpleIdentifier(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_DOT_OPERATOR) &&
                     (synNode.type != SystemVerilogIndexParser.S_CLASS_SCOPE) &&
                     (synNode.type != SystemVerilogIndexParser.S_SEMICOLON_OPERATOR)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a task non port header in ${this._documentPath}`);
            }
        });
        return taskSymbol;
    }

    private _processTaskHeader(treeCursor: MyTreeCursor, startSynNode: SyntaxNode): SystemVerilogSymbol {
        let taskSymbol: SystemVerilogSymbol;
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_TASK_IDENTIFIER) {
                taskSymbol = this._pushContainerSymbol(synNode, [startSynNode.text], { startSynNode: startSynNode, endSynNode: treeCursor.currentNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_TF_PORT_ITEM) {
                this._processTfPortItem({ currentNode: synNode });
            }
            else if (!this._isAllAllow(synNode) &&
                     !this._isEscapedOrSimpleIdentifier(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_DOT_OPERATOR) &&
                     (synNode.type != SystemVerilogIndexParser.S_CLASS_SCOPE) &&
                     (synNode.type != SystemVerilogIndexParser.S_OPEN_PARANTHESES) &&
                     (synNode.type != SystemVerilogIndexParser.S_CLOSE_PARANTHESES) &&
                     (synNode.type != SystemVerilogIndexParser.S_COMMA_OPERATOR) &&
                     (synNode.type != SystemVerilogIndexParser.S_SEMICOLON_OPERATOR)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a task non port header in ${this._documentPath}`);
            }
        });
        return taskSymbol;
    }

    private _processBlockItemDeclaration(treeCursor: MyTreeCursor) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_EXPLICIT_DATA_DECLARATION) {
                this._processExplicitDataDeclaration({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_LOCALPARAM_DECLARATION) {
                this._processLocalParamDeclaration({ currentNode: synNode }, []);
            }
            else if (synNode.type == SystemVerilogIndexParser.S_PARAMETER_DECLARATION) {
                this._processParameterDeclaration({ currentNode: synNode }, []);
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_SEMICOLON_OPERATOR) &&
                     (synNode.type != SystemVerilogIndexParser.S_LET_DECLARATION)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a block item declaration in ${this._documentPath}`);
            }
        });
    }

    private _processListOfTfVariableIdentifiers(treeCursor: MyTreeCursor, dataType: string[], defSynNode: SyntaxNode) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (this._isEscapedOrSimpleIdentifier(synNode)) {
                this._pushSymbol(synNode, ["port"].concat(dataType.length > 0 ? dataType.join(' ') : []), { startSynNode: defSynNode, endSynNode: defSynNode });
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_SQUARE_BRACKETS_BLOCK) &&
                     (synNode.type != SystemVerilogIndexParser.S_EQUALS_OPERATOR) &&
                     (synNode.type != SystemVerilogIndexParser.S_EXPRESSION)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a list of tf variable identifiers in ${this._documentPath}`);
            }
        });
    }

    private _processTfPortDeclaration(treeCursor: MyTreeCursor) {
        let dataType: string[] = [];
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_LIST_OF_TF_VARIABLE_IDENTIFIERS) {
                this._processListOfTfVariableIdentifiers({ currentNode: synNode }, dataType, treeCursor.currentNode);
                dataType = [];
            }
            else if (synNode.type == SystemVerilogIndexParser.S_DATA_TYPE) {
                dataType.push(this._processDataType({ currentNode: synNode }));
            }
            else if (synNode.type == SystemVerilogIndexParser.S_SIGNING) {
                dataType.push(synNode.text);
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_TF_PORT_DIRECTION) &&
                     (synNode.type != SystemVerilogIndexParser.S_VAR_KEYWORD) &&
                     (synNode.type != SystemVerilogIndexParser.S_SQUARE_BRACKETS_BLOCK) &&
                     (synNode.type != SystemVerilogIndexParser.S_SEMICOLON_OPERATOR)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a ansi or non ansi port declaration in ${this._documentPath}`);
            }
        });
    }

    private _processTfItemDeclaration(treeCursor: MyTreeCursor) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_BLOCK_ITEM_DECLARATION) {
                this._processBlockItemDeclaration({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_TF_PORT_DECLARATION) {
                this._processTfPortDeclaration({ currentNode: synNode });
            }
            else if (!this._isAllAllow(synNode)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a tf item declaration in ${this._documentPath}`);
            }
        });
    }

    private _processTaskBodyDeclaration(treeCursor: MyTreeCursor, startSynNode: SyntaxNode) {
        let taskSymbol: SystemVerilogSymbol;
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_TASK_NON_PORT_HEADER) {
                taskSymbol = this._processTaskNonPortHeader({ currentNode: synNode }, startSynNode);
            }
            else if (synNode.type == SystemVerilogIndexParser.S_TASK_HEADER) {
                taskSymbol = this._processTaskHeader({ currentNode: synNode }, startSynNode);
            }
            else if (synNode.type == SystemVerilogIndexParser.S_BLOCK_ITEM_DECLARATION) {
                this._processBlockItemDeclaration({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_TF_ITEM_DECLARATION) {
                this._processTfItemDeclaration({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_STATEMENT_OR_NULL) {
                this._processVariableDeclarationInStatementOrNull({ currentNode: synNode });
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_ENDTASK_DECLARATION)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a task body declaration in ${this._documentPath}`);
            }
        });

        if (!!taskSymbol) {
            this._containerStack.pop(this._getEndPosition(treeCursor.currentNode.lastChild));
        }
    }

    private _processTaskDeclaration(treeCursor: MyTreeCursor) {
        let startSynNode: SyntaxNode;
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_TASK_KEYWORD) {
                startSynNode = synNode;
            }
            else if (synNode.type == SystemVerilogIndexParser.S_TASK_BODY_DECLARATION) {
                this._processTaskBodyDeclaration({ currentNode: synNode }, startSynNode);
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_LIFETIME)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a task declaration in ${this._documentPath}`);
            }
        });
    }

    private _processFunctionNonPortHeader(treeCursor: MyTreeCursor, startSynNode: SyntaxNode): SystemVerilogSymbol {
        let funcSymbol: SystemVerilogSymbol;
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_FUNCTION_IDENTIFIER) {
                funcSymbol = this._pushContainerSymbol(synNode, [startSynNode.text], { startSynNode: startSynNode, endSynNode: treeCursor.currentNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_DATA_TYPE_OR_VOID) {
                this._processDataTypeOrVoid({ currentNode: synNode });
            }
            else if (!this._isAllAllow(synNode) &&
                     !this._isEscapedOrSimpleIdentifier(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_SIGNING) &&
                     (synNode.type != SystemVerilogIndexParser.S_SQUARE_BRACKETS_BLOCK) &&
                     (synNode.type != SystemVerilogIndexParser.S_DOT_OPERATOR) &&
                     (synNode.type != SystemVerilogIndexParser.S_CLASS_SCOPE) &&
                     (synNode.type != SystemVerilogIndexParser.S_SEMICOLON_OPERATOR)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a function non port header in ${this._documentPath}`);
            }
        });
        return funcSymbol;
    }

    private _processFunctionHeader(treeCursor: MyTreeCursor, startSynNode: SyntaxNode): SystemVerilogSymbol {
        let funcSymbol: SystemVerilogSymbol;
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_FUNCTION_IDENTIFIER) {
                funcSymbol = this._pushContainerSymbol(synNode, [startSynNode.text], { startSynNode: startSynNode, endSynNode: treeCursor.currentNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_DATA_TYPE_OR_VOID) {
                this._processDataTypeOrVoid({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_TF_PORT_ITEM) {
                this._processTfPortItem({ currentNode: synNode });
            }
            else if (!this._isAllAllow(synNode) &&
                     !this._isEscapedOrSimpleIdentifier(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_SIGNING) &&
                     (synNode.type != SystemVerilogIndexParser.S_SQUARE_BRACKETS_BLOCK) &&
                     (synNode.type != SystemVerilogIndexParser.S_DOT_OPERATOR) &&
                     (synNode.type != SystemVerilogIndexParser.S_CLASS_SCOPE) &&
                     (synNode.type != SystemVerilogIndexParser.S_OPEN_PARANTHESES) &&
                     (synNode.type != SystemVerilogIndexParser.S_CLOSE_PARANTHESES) &&
                     (synNode.type != SystemVerilogIndexParser.S_COMMA_OPERATOR) &&
                     (synNode.type != SystemVerilogIndexParser.S_SEMICOLON_OPERATOR)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a function port header in ${this._documentPath}`);
            }
        });
        return funcSymbol;
    }

    private _processFunctionBodyDeclaration(treeCursor: MyTreeCursor, startSynNode: SyntaxNode) {
        let funcSymbol: SystemVerilogSymbol;
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_FUNCTION_NON_PORT_HEADER) {
                funcSymbol = this._processFunctionNonPortHeader({ currentNode: synNode }, startSynNode);
            }
            else if (synNode.type == SystemVerilogIndexParser.S_FUNCTION_HEADER) {
                funcSymbol = this._processFunctionHeader({ currentNode: synNode }, startSynNode);
            }
            else if (synNode.type == SystemVerilogIndexParser.S_BLOCK_ITEM_DECLARATION) {
                this._processBlockItemDeclaration({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_TF_ITEM_DECLARATION) {
                this._processTfItemDeclaration({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_STATEMENT_OR_NULL) {
                this._processVariableDeclarationInStatementOrNull({ currentNode: synNode });
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_ENDFUNCTION_DECLARATION)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a function body declaration in ${this._documentPath}`);
            }
        });

        if (!!funcSymbol) {
            this._containerStack.pop(this._getEndPosition(treeCursor.currentNode.lastChild));
        }
    }

    private _processFunctionDeclaration(treeCursor: MyTreeCursor) {
        let startSynNode: SyntaxNode;
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_FUNCTION_KEYWORD) {
                startSynNode = synNode;
            }
            else if (synNode.type == SystemVerilogIndexParser.S_FUNCTION_BODY_DECLARATION) {
                this._processFunctionBodyDeclaration({ currentNode: synNode }, startSynNode);
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_LIFETIME)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a task declaration in ${this._documentPath}`);
            }
        });
    }

    private _processPackageOrGenerateItemDeclaration(treeCursor: MyTreeCursor) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_NET_DECLARATION) {
                this._processNetDeclaration({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_EXPLICIT_DATA_DECLARATION) {
                this._processExplicitDataDeclaration({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_TASK_DECLARATION) {
                this._processTaskDeclaration({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_FUNCTION_DECLARATION) {
                this._processFunctionDeclaration({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_LOCALPARAM_DECLARATION) {
                this._processLocalParamDeclaration({ currentNode: synNode }, []);
            }
            else if (synNode.type == SystemVerilogIndexParser.S_PARAMETER_DECLARATION) {
                this._processParameterDeclaration({ currentNode: synNode }, []);
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_CHECKER_DECLARATION) &&
                     (synNode.type != SystemVerilogIndexParser.S_DPI_IMPORT_EXPORT) &&
                     (synNode.type != SystemVerilogIndexParser.S_EXTERN_CONSTRAINT_DECLARATION) &&
                     (synNode.type != SystemVerilogIndexParser.S_CLASS_DECLARATION) &&
                     (synNode.type != SystemVerilogIndexParser.S_SEMICOLON_OPERATOR) &&
                     (synNode.type != SystemVerilogIndexParser.S_COVERGROUP_DECLARATION) &&
                     (synNode.type != SystemVerilogIndexParser.S_ASSERTION_ITEM_DECLARATION)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a package or generate item declaration in ${this._documentPath}`);
            }
        });
    }

    private _processNullStatementInBaseGrammar(currSynNodeIndex: number, baseGrammarPackageItems: SyntaxNode[]): number {
        if (baseGrammarPackageItems[currSynNodeIndex].type == SystemVerilogIndexParser.S_SEMICOLON_OPERATOR) {
            return currSynNodeIndex + 1;
        }
        return currSynNodeIndex;
    }

    private _processBaseGrammarPackageItems(baseGrammarPackageItems: SyntaxNode[]) {
        let currSynNodeIndex: number = 0;
        let prevSyntaxNodeIndx: number = 0;
        while (currSynNodeIndex < baseGrammarPackageItems.length) {
            if (this._isAllAllow(baseGrammarPackageItems[currSynNodeIndex])) {
                currSynNodeIndex++;
            }

            if (prevSyntaxNodeIndx == currSynNodeIndex) {
                currSynNodeIndex = this._processVariableDeclarationInBaseGrammar(currSynNodeIndex, baseGrammarPackageItems);
            }

            if (prevSyntaxNodeIndx == currSynNodeIndex) {
                currSynNodeIndex = this._processNullStatementInBaseGrammar(currSynNodeIndex, baseGrammarPackageItems);
            }

            if (prevSyntaxNodeIndx == currSynNodeIndex) {
                ConnectionLogger.error(`Unexpected symbol type ${baseGrammarPackageItems[currSynNodeIndex].type} in package item base grammar at index ${baseGrammarPackageItems[currSynNodeIndex].startIndex} in ${this._documentPath}`);
                currSynNodeIndex++;
            }
            prevSyntaxNodeIndx = currSynNodeIndex;
        }
    }

    private _processPackageItem(treeCursor: MyTreeCursor) {
        treeCursor.currentNode.children.forEach(synNode => {
            if (synNode.type == SystemVerilogIndexParser.S_PACKAGE_OR_GENERATE_ITEM_DECLARATION) {
                this._processPackageOrGenerateItemDeclaration({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_PACKAGE_EXPORT_DECLARATION) {
                this._processPackageExportDeclaration({ currentNode: synNode });
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_ANONYMOUS_PROGRAM) &&
                     (synNode.type != SystemVerilogIndexParser.S_TIMEUNITS_DECLARATION)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a package item in ${this._documentPath}`);
            }
        });
    }

    private _processPackageDeclaration(treeCursor: MyTreeCursor): Boolean {
        if (treeCursor.currentNode.type != SystemVerilogIndexParser.S_PACKAGE_DECLARATION) {
            return false;
        }

        let baseGrammarPackageItems: SyntaxNode[] = [];
        treeCursor.currentNode.children.forEach(synNode => {
            if ((synNode.firstChild !== null) && (this._isBaseGrammar(synNode.firstChild) || (synNode.firstChild.type == SystemVerilogIndexParser.S_SEMICOLON_OPERATOR))) {
                baseGrammarPackageItems.push(synNode.firstChild);
                return;
            }
            else if (baseGrammarPackageItems.length > 0) {
                this._processBaseGrammarPackageItems(baseGrammarPackageItems);
                baseGrammarPackageItems.length = 0;
            }

            if (synNode.type == SystemVerilogIndexParser.S_PACKAGE_HEADER) {
                this._processPackageHeader({ currentNode: synNode });
            }
            else if (synNode.type == SystemVerilogIndexParser.S_PACKAGE_ITEM) {
                this._processPackageItem({ currentNode: synNode });
            }
            else if (!this._isAllAllow(synNode) &&
                     (synNode.type != SystemVerilogIndexParser.S_ENDPACKAGE_DECLARATION)) {
                ConnectionLogger.error(`Unexpected symbol type ${synNode.type} in a package declaration in ${this._documentPath}`);
            }
        });

        if (baseGrammarPackageItems.length > 0) {
            this._processBaseGrammarPackageItems(baseGrammarPackageItems);
        }

        this._containerStack.pop(this._getEndPosition(treeCursor.currentNode.lastChild));

        return true;
    }

    private _ignoreTillSemicolon(treeCursor: MyTreeCursor): Boolean {
        let _startNode: SyntaxNode = treeCursor.currentNode;
        while(treeCursor.currentNode.type != SystemVerilogIndexParser.S_SEMICOLON_OPERATOR) {
            if (treeCursor.currentNode.nextSibling === null) {
                break;
            }
            treeCursor.currentNode = treeCursor.currentNode.nextSibling;
        }
        if (treeCursor.currentNode.type == SystemVerilogIndexParser.S_SEMICOLON_OPERATOR) {
            //ConnectionLogger.log(`DEBUG: ignored symbol type ${treeCursor.currentNode.type} till (${treeCursor.currentNode.endPosition.row}, ${treeCursor.currentNode.endPosition.column})`);
            return true;
        }
        treeCursor.currentNode = _startNode;
        return false;
    }

    private _ignoreInstantiation(treeCursor: MyTreeCursor): Boolean {
        return this._ignoreTillSemicolon(treeCursor);
    }

    private _ignoreSigDeclaration(treeCursor: MyTreeCursor): Boolean {
        return this._ignoreTillSemicolon(treeCursor);
    }

    private _printParsingFailedMessage(treeCursor: MyTreeCursor) {
        ConnectionLogger.warn(`Parsing failed at node (${treeCursor.currentNode.startPosition.row}, ${treeCursor.currentNode.startPosition.column}) "${treeCursor.currentNode.text}" in ${this._documentPath}`);
    }

    private _debugPrint(synNode: SyntaxNode, indent: number = 0) {
        ConnectionLogger.log(`${" ".repeat(indent)}${synNode.type} - (${synNode.startPosition.row}, ${synNode.startPosition.column}, ${synNode.startIndex}), (${synNode.endPosition.row}, ${synNode.endPosition.column}, ${synNode.endIndex}), ${synNode.hasError()}`);
        synNode.children.forEach(subSynNode => this._debugPrint(subSynNode, indent + 2));
    }

    public parse(sourceText: string, document: TextDocument, preprocCache: Map<string, PreprocCacheEntry>, postTokens: PostToken[], tokenOrder: TokenOrderEntry[]): Promise<SystemVerilogParser.SystemVerilogFileSymbolsInfo> {
        if (svIndexParser === null) {
            return new Promise((resolve, reject) => {
                svIndexParserInitSubscribers.push({ resolve: resolve, reject: reject });
            }).then(() => {
                return this.parse(sourceText, document, preprocCache, postTokens, tokenOrder);
            }).catch(() => {
                return undefined;
            });
        }

        try {
            this._document = document;
            this._documentPath = uriToPath(document.uri);
            this._preprocCache = preprocCache;
            this._fileSymbolsInfo = {}; //TBD
            this._containerStack = new ContainerStack(this._fileSymbolsInfo);

            let rootNode: SyntaxNode = svIndexParser.parse(sourceText).rootNode;
            this._synLeafNodeRanges = this._calcSyntaxLeafNodeRanges(rootNode, document.uri, sourceText);
            this._synNodeRangeMap = this._reRangeSyntaxNodes(postTokens, tokenOrder, sourceText, document.uri);

            if (rootNode.hasError()) {
                //if (document.uri.endsWith('/.sv')) {
                //    ConnectionLogger.log(`${sourceText}`);
                //    this._debugPrint(rootNode);
                //}
                ConnectionLogger.error(`Errors found while parsing ${document.uri}`);
            }
            let treeCursor: MyTreeCursor = { currentNode: rootNode.firstChild };
            let baseGrammarPackageItems: SyntaxNode[] = [];
            while(treeCursor.currentNode !== null) {
                if ((treeCursor.currentNode !== null) && (this._isBaseGrammar(treeCursor.currentNode) || (treeCursor.currentNode.type == SystemVerilogIndexParser.S_SEMICOLON_OPERATOR))) {
                    baseGrammarPackageItems.push(treeCursor.currentNode);
                    treeCursor.currentNode = treeCursor.currentNode.nextSibling;
                    continue;
                }
                else if (baseGrammarPackageItems.length > 0) {
                    this._processBaseGrammarPackageItems(baseGrammarPackageItems);
                    baseGrammarPackageItems = [];
                }

                if (this._isAllAllow(treeCursor.currentNode) ||
                    this._ignoreSymbol(treeCursor, SystemVerilogIndexParser.S_TIMEUNITS_DECLARATION) ||
                    this._processModuleDeclaration(treeCursor) ||
                    this._ignoreSymbol(treeCursor, SystemVerilogIndexParser.S_UDP_DECLARATION) ||
                    this._processInterfaceDeclaration(treeCursor) ||
                    this._ignoreSymbol(treeCursor, SystemVerilogIndexParser.S_PROGRAM_DECLARATION) ||
                    this._processPackageDeclaration(treeCursor) ||
                    this._ignoreSymbol(treeCursor, SystemVerilogIndexParser.S_ANONYMOUS_PROGRAM) ||
                    this._ignoreSymbol(treeCursor, SystemVerilogIndexParser.S_BIND_DIRECTIVE) ||
                    this._ignoreSymbol(treeCursor, SystemVerilogIndexParser.S_CONFIG_DECLARATION)) {
                }
                else if (treeCursor.currentNode.type == SystemVerilogIndexParser.S_PACKAGE_OR_GENERATE_ITEM_DECLARATION) {
                    this._processPackageOrGenerateItemDeclaration(treeCursor);
                }
                else if (treeCursor.currentNode.type == SystemVerilogIndexParser.S_PACKAGE_EXPORT_DECLARATION) {
                    this._processPackageExportDeclaration(treeCursor);
                }
                else {
                    this._printParsingFailedMessage(treeCursor);
                }

                treeCursor.currentNode = treeCursor.currentNode.nextSibling;
            }

            if (baseGrammarPackageItems.length > 0) {
                this._processBaseGrammarPackageItems(baseGrammarPackageItems);
            }
            //DBG fs.appendFileSync("/tmp/new.json", JSON.stringify({file: this._documentPath, symbols: SystemVerilogParser.fileSymbolsInfoToJson(this._fileSymbolsInfo)}) + ",\n");
        } catch(error) {
            ConnectionLogger.error(error);
            return Promise.resolve(undefined);
        }

        return Promise.resolve(this._fileSymbolsInfo);
    }
}
