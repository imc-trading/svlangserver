import {
    Location,
    Position,
    Range,
    SymbolInformation,
    TextDocument,
    TextDocumentIdentifier
} from 'vscode-languageserver';

import {
    SystemVerilogIndexer
} from './svindexer';

import {
    SystemVerilogSymbol
} from './svsymbol';

import {
    SystemVerilogParser
} from './svparser';

import {
    GrammarToken
} from './grammar_engine';

import {
    ConnectionLogger
} from './genutils';

export class SystemVerilogDefinitionProvider {
    private _indexer: SystemVerilogIndexer;

    constructor(indexer: SystemVerilogIndexer) {
        this._indexer = indexer;
    }

    private _findNamedArg(tokenNum: number, svtokens: GrammarToken[]): [string, Boolean] {
        let scopeDepth: number = svtokens[tokenNum].scopes.length - 1;

        if ((tokenNum == 0) || (scopeDepth == 0)) {
            return [undefined, undefined];
        }

        let dotLocation: number;
        for (let i: number = tokenNum - 1; i >= 0; i--) {
            if (svtokens[i].text == ".") {
                dotLocation = i;
                break;
            }
            else if (svtokens[i].scopes[svtokens[i].scopes.length - 1] != "meta.whitespace.systemverilog") {
                return [undefined, undefined];
            }
        }
        if (dotLocation == undefined) {
            return [undefined, undefined];
        }

        for (let i: number = 0; i < svtokens[tokenNum].scopes.length; i++) {
            if (!svtokens[tokenNum].scopes[i].startsWith("identifier.") &&
                (svtokens[tokenNum].scopes[i] != "parantheses.block.systemverilog") &&
                (svtokens[tokenNum].scopes[i] != "case.body.systemverilog") &&
                (svtokens[tokenNum].scopes[i] != "begin.block.systemverilog") &&
                (svtokens[tokenNum].scopes[i] != "generate.block.systemverilog") &&
                (svtokens[tokenNum].scopes[i] != "source.systemverilog")) {
                for (let j: number = tokenNum - 1; j >= 0; j--) {
                    if (svtokens[j].scopes[scopeDepth - 1].startsWith("identifier.")) {
                        return [svtokens[j].text, true];
                    }
                }
                return [undefined, undefined];
            }
        }

        let instNameFound: Boolean = false;
        let openParenFound: Boolean = false;
        let hashOpenParenFound: Boolean = false;
        for (let i: number = dotLocation - 1; i >= 0; i--) {
            if (svtokens[i].scopes[scopeDepth - 1].startsWith("identifier.")) {
                if (instNameFound || hashOpenParenFound) {
                    return [svtokens[i].text, false];
                }
                else {
                    instNameFound = true;
                }
            }
            else if ((svtokens[i].text == "#") && openParenFound) {
                hashOpenParenFound = true;
            }
            else if (!openParenFound && (svtokens[i].text == "(")) {
                openParenFound = true;
            }
            else if (!svtokens[i].scopes[svtokens[i].scopes.length - 1].startsWith("comment.") &&
                     (svtokens[i].scopes[svtokens[i].scopes.length - 1] != "meta.whitespace.systemverilog")) {
                openParenFound = false;
            }
        }
        return [undefined, undefined];
    }

    private _getIncludeFileName(tokens: GrammarToken[], tokenNum: number): string {
        let startTokenNum: number;
        for (let i: number = tokenNum; i >= 0; i--) {
            let scope: string = tokens[i].scopes[tokens[i].scopes.length - 1];
            if (scope == "string.begin.systemverilog") {
                startTokenNum = i;
                break;
            }
        }
        if (startTokenNum === undefined) {
            return undefined;
        }

        let endTokenNum: number;
        for (let i: number = tokenNum; i < tokens.length; i++) {
            let scope: string = tokens[i].scopes[tokens[i].scopes.length - 1];
            if (scope == "string.end.systemverilog") {
                endTokenNum = i;
                break;
            }
        }
        if (endTokenNum === undefined) {
            return undefined;
        }

        return tokens.slice(startTokenNum + 1, endTokenNum).map(t => t.text).join('');
    }

    private _getDefinition(document: TextDocument, position: Position, includeUserDefines?: Boolean, checkPrevPosition: Boolean = false): [string, SystemVerilogSymbol|number] {
        let svtokens: GrammarToken[] = this._indexer.getSystemVerilogCompletionTokens(document.uri);
        let extTokenNums: number[] = this._indexer.getSystemVerilogCompletionTokenNumber(document, position.line, position.character + 1);
        let tokenNum: number = extTokenNums[1];
        if (tokenNum == undefined) {
            return [undefined, undefined];
        }

        let scope: string = svtokens[tokenNum].scopes[svtokens[tokenNum].scopes.length - 1];
        let parentScope: string = svtokens[tokenNum].scopes.length > 1 ? svtokens[tokenNum].scopes[svtokens[tokenNum].scopes.length - 2] : undefined;
        if (scope.startsWith("macro.")) {
            let defText: string = svtokens[tokenNum].text.slice(1).replace(/\s*\($/, "");
            let result: [string, SystemVerilogSymbol[]][] = this._indexer.getMacros(document.uri, defText);
            if (result.length > 0) {
                return [result[0][0], result[0][1][0]];
            }

            if (includeUserDefines) {
                let userDefineNum: number = this._indexer.findUserDefine(defText);
                if (userDefineNum >= 0) {
                    //DBG ConnectionLogger.log(`DEBUG: HERE with ${userDefineNum} for ${defText}`);
                    return ["", userDefineNum];
                }
            }

            return [undefined, undefined];
        }
        else if (scope.startsWith("identifier.hierarchical.") || (extTokenNums[0] != tokenNum)) {
            let filePath: string;
            let symbol: SystemVerilogSymbol;
            let idTokens: GrammarToken[] = svtokens.slice(extTokenNums[0], tokenNum + 1);
            [filePath, symbol] = this._indexer.getHierarchicalSymbol(document.uri, this._indexer.getHierParts(idTokens.map(t => t.text).join(''), idTokens, document.offsetAt(position) - svtokens[extTokenNums[0]].index));
            if (symbol != undefined) {
                return [filePath, symbol];
            }
        }
        else if (parentScope == "string.body.systemverilog") {
            let incFileName: string = this._getIncludeFileName(svtokens, tokenNum);
            if (incFileName == undefined) {
                return [undefined, undefined];
            }
            return this._indexer.getIncFilePathAndSymbol(incFileName);
        }
        else if (!scope.startsWith("identifier.")) {
            if (checkPrevPosition && (position.character > 0)) {
                return this._getDefinition(document, Position.create(position.line, position.character - 1), includeUserDefines, false);
            }
            return [undefined, undefined];
        }

        let containerName: string;
        let isRoutine: Boolean;
        [containerName, isRoutine] = this._findNamedArg(tokenNum, svtokens);
        if ((containerName == undefined) || (isRoutine == undefined)) {
            let symText: string = svtokens[tokenNum].text;
            if (scope.startsWith("identifier.scoped.")) {
                let endPos: number = document.offsetAt(position) - svtokens[tokenNum].index;
                endPos = svtokens[tokenNum].text.indexOf("::", endPos > 0 ? endPos - 1 : 0);
                endPos = endPos < 0 ? svtokens[tokenNum].text.length : endPos;
                symText = svtokens[tokenNum].text.slice(0, endPos);
                symText = symText.replace(/::\*$/, '');
                if (symText == "*") {
                    return [undefined, undefined];
                }
                else if (symText.indexOf("::") < 0) {
                    return this._indexer.getPackageSymbol(symText);
                }
            }
            let filePath: string;
            let symbol: SystemVerilogSymbol;
            [filePath, symbol] = scope.startsWith("identifier.scoped.") ? this._indexer.findSymbol(document.uri, symText) : this._indexer.findScopedSymbol(document.uri, symText, position);
            if ((filePath == undefined) || (symbol == undefined)) {
                symbol = this._indexer.getContainerSymbol(svtokens[tokenNum].text);
                if (symbol == undefined) {
                    return this._indexer.getPackageSymbol(svtokens[tokenNum].text);
                }

                filePath = this._indexer.getInstFilePath(svtokens[tokenNum].text);
                return [filePath, symbol];
            }

            return [filePath, symbol];
        }
        else if (isRoutine) {
            let filePath: string;
            let symbol: SystemVerilogSymbol;
            let containerSymbolsInfo: SystemVerilogParser.SystemVerilogContainerSymbolsInfo[];
            [filePath, symbol, containerSymbolsInfo] = this._indexer.getContainerInfo(document.uri, containerName);
            if ((filePath == undefined) || (symbol == undefined) || (containerSymbolsInfo == undefined) ||
                (containerSymbolsInfo.length <= SystemVerilogParser.ContainerInfoIndex.Symbols) ||
                (containerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Symbols] == undefined)) {
                return [undefined, undefined];
            }

            let argSymbols: SystemVerilogSymbol[] = <SystemVerilogSymbol[]>(containerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Symbols]);
            let filteredArgSymbols: SystemVerilogSymbol[] = argSymbols.filter(sym => { return sym.name == svtokens[tokenNum].text; });
            if (filteredArgSymbols.length > 0) {
                return [filePath, filteredArgSymbols[0]];
            }
            return [undefined, undefined];
        }
        else {
            let filePath: string;
            let symbol: SystemVerilogSymbol;
            let containerSymbolsInfo: SystemVerilogParser.SystemVerilogContainerSymbolsInfo[];
            [filePath, symbol, containerSymbolsInfo] = this._indexer.getContainerInfo(this._indexer.getInstFilePath(containerName), containerName);
            if ((filePath == undefined) || (symbol == undefined) || (containerSymbolsInfo == undefined) ||
                (containerSymbolsInfo.length <= SystemVerilogParser.ContainerInfoIndex.Symbols) ||
                (containerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Symbols] == undefined)) {
                return [undefined, undefined];
            }

            let containerSymbols: SystemVerilogSymbol[] = <SystemVerilogSymbol[]>(containerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Symbols]);
            let filteredContainerSymbols: SystemVerilogSymbol[] = containerSymbols.filter(sym => { return (sym.name == svtokens[tokenNum].text) && ((sym.type[0] == "port") || (sym.type[0] == "parameter-port")); });
            if (filteredContainerSymbols.length > 0) {
                return [filePath, filteredContainerSymbols[0]];
            }
            return [undefined, undefined];
        }
    }

    public getDefinitionSymbolLocation(document: TextDocument, position: Position): Promise<Location[]> {
        try {
            let symbolInfo: [string, SystemVerilogSymbol|number] = this._getDefinition(document, position, false, true);
            if (symbolInfo[0] == undefined) {
                return Promise.resolve([]);
            }

            if (symbolInfo[0] == "") {
                return Promise.resolve([Location.create("", Range.create(<number>symbolInfo[1], 0, 0, 0))]);
            }

            return Promise.resolve([(<SystemVerilogSymbol>(symbolInfo[1])).getSymbolLocation(symbolInfo[0])]);
        } catch (error) {
            ConnectionLogger.error(error);
            return Promise.resolve([]);
        }
    }

    public getDefinitionText(document: TextDocument, position: Position): [string, string[]] {
        try {
            let symbolInfo: [string, SystemVerilogSymbol|number] = this._getDefinition(document, position, true);
            if (symbolInfo[0] == undefined) {
                return [undefined, undefined];
            }

            let header: string;
            let code: string;
            if (symbolInfo[0] == "") {
                header = 'User Define';
                code = this._indexer.getUserDefine(<number>(symbolInfo[1]));
            }
            else if ((typeof symbolInfo[1] !== 'number') && ((<SystemVerilogSymbol>(symbolInfo[1])).type.indexOf("includefile") >= 0)) {
                header = (<SystemVerilogSymbol>(symbolInfo[1])).name;
                code = '';
            }
            else {
                header = (document.uri == symbolInfo[0]) ? '' : `File: ${symbolInfo[0]}`;
                code = (<SystemVerilogSymbol>(symbolInfo[1])).getDefinition(symbolInfo[0]);
            }

            let trimLength: number = 0;
            let codeLines: string[] = code.split(/\r?\n/).map((codeLine, i) => {
                let lineTrimLength: number = codeLine.search(/\S/);
                lineTrimLength = (lineTrimLength < 0) ? 0 : lineTrimLength;;
                if (i == 0) {
                    trimLength = lineTrimLength;
                }
                let actTrimLength: number = (trimLength < lineTrimLength) ? trimLength : lineTrimLength;
                return codeLine.slice(actTrimLength);
            });

            return [header, codeLines];
        } catch(error) {
            // ConnectionLogger.error(error); // Too much noise in VSCode console
            return [undefined, undefined];
        }
    }
}
