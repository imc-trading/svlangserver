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

    private _getDefinition(document: TextDocument, position: Position, includeUserDefines?: Boolean): [string, SystemVerilogSymbol|number] {
        let svtokens: GrammarToken[] = this._indexer.getSystemVerilogCompletionTokens(document.uri);
        let extTokenNums: number[] = this._indexer.getSystemVerilogCompletionTokenNumber(document, position.line, position.character + 1);
        let tokenNum: number = extTokenNums[1];
        let scope: string = svtokens[tokenNum].scopes[svtokens[tokenNum].scopes.length - 1];
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
        else if (!scope.startsWith("identifier.")) {
            return [undefined, undefined];
        }

        let containerName: string;
        let isRoutine: Boolean;
        [containerName, isRoutine] = this._findNamedArg(tokenNum, svtokens);
        if ((containerName == undefined) || (isRoutine == undefined)) {
            let filePath: string;
            let symbol: SystemVerilogSymbol;
            [filePath, symbol] = this._indexer.findSymbol(document.uri, svtokens[tokenNum].text);
            if ((filePath == undefined) || (symbol == undefined)) {
                symbol = this._indexer.getContainerSymbol(svtokens[tokenNum].text);
                if (symbol == undefined) {
                    return [undefined, undefined];
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
        let symbolInfo: [string, SystemVerilogSymbol|number] = this._getDefinition(document, position, false);
        if (symbolInfo[0] == undefined) {
            return Promise.resolve([]);
        }

        if (symbolInfo[0] == "") {
            return Promise.resolve([Location.create("", Range.create(<number>symbolInfo[1], 0, 0, 0))]);
        }

        return Promise.resolve([(<SystemVerilogSymbol>(symbolInfo[1])).getSymbolLocation(symbolInfo[0])]);
    }

    public getDefinitionText(document: TextDocument, position: Position): string {
        let symbolInfo: [string, SystemVerilogSymbol|number] = this._getDefinition(document, position, true);
        if (symbolInfo[0] == undefined) {
            return undefined;
        }

        if (symbolInfo[0] == "") {
            return this._indexer.getUserDefine(<number>(symbolInfo[1]));
        }

        return (<SystemVerilogSymbol>(symbolInfo[1])).getDefinition(symbolInfo[0]);
    }
}
