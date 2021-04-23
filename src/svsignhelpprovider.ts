import {
    SignatureHelp
} from 'vscode-languageserver';

import {
    TextDocument
} from 'vscode-languageserver-textdocument';

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
    SystemVerilogUtils
} from './svutils';

import {
    GrammarToken,
} from './grammar_engine';

import {
    ConnectionLogger
} from './genutils';

enum ScopeType {
    None,
    InstanceParamsPortsNamed,
    InstanceParamsOrdered,
    InstancePortsOrdered,
    Macro,
    RoutineNamed,
    RoutineOrdered,
    SystemTask
}

const systemTasksInfo: Map<RegExp, [[string, string][], number]> = new Map([
    [/(?:display|write)[boh]?/, [[["format", "format string"], ["...", "arguments"]], 0]],
]);

export class SystemVerilogSignatureHelpProvider {
    private _indexer: SystemVerilogIndexer;

    constructor(indexer: SystemVerilogIndexer) {
        this._indexer = indexer;
    }

    private _getScopeType(tokenNum: number, svtokens: GrammarToken[]): [ScopeType, number] {
        let scopes: string[] = svtokens[tokenNum].scopes;
        if (scopes.length > 0) {
            let topScope: string = scopes[scopes.length - 1];
            if (topScope == "system.task.systemverilog") {
                return [ScopeType.SystemTask, tokenNum];
            }
            else if(topScope == "macro.call.systemverilog") {
                return [ScopeType.Macro, tokenNum];
            }

            for (let i: number = scopes.length - 1; i >= 0; i--) {
                if ((scopes[i] == "system.args.systemverilog") ||
                    (scopes[i] == "macro.args.systemverilog")) {
                    let startTokenNum: number = tokenNum - 1;
                    for (; startTokenNum >= 0; startTokenNum--) {
                        if ((svtokens[startTokenNum].scopes.length >= i) &&
                            ((svtokens[startTokenNum].scopes[i] == "system.task.systemverilog") ||
                             (svtokens[startTokenNum].scopes[i] == "macro.call.systemverilog"))) {
                            break;
                        }
                    }
                    if (startTokenNum >= 0) {
                        return [scopes[i] == "system.args.systemverilog" ? ScopeType.SystemTask : ScopeType.Macro, startTokenNum];
                    }
                    else {
                        return [ScopeType.None, undefined];
                    }
                }
                else if ((scopes[i] == "parantheses.begin.systemverilog") ||
                         (scopes[i] == "parantheses.block.systemverilog")) {
                    let startTokenNum: number;
                    if (scopes[i] == "parantheses.begin.systemverilog") {
                        startTokenNum = tokenNum;
                    }
                    else {
                        for (let j: number = tokenNum - 1; j >= 0; j--) {
                            if (svtokens[j].scopes.length <= i) {
                                break;
                            }
                            else if (svtokens[j].scopes[i] == "parantheses.begin.systemverilog") {
                                startTokenNum = j;
                                break;
                            }
                        }
                    }

                    if (startTokenNum != undefined) {
                        let hashOpenParenFound: Boolean = false;
                        for (let j: number = startTokenNum - 1; j >= 0; j--) {
                            let scope: string = svtokens[j].scopes[svtokens[j].scopes.length - 1];
                            if (scope.startsWith("identifier.")) {
                                if (SystemVerilogUtils.keywordsList.has(svtokens[j].text)) {
                                    break;
                                }
                                else if ((svtokens[j].scopes.length < 2) ||
                                         (svtokens[j].scopes[svtokens[j].scopes.length - 2] == "container.header.systemverilog") ||
                                         (svtokens[j].scopes[svtokens[j].scopes.length - 2] == "routine.header.systemverilog")) {
                                    break;
                                }
                                else if (scope == "identifier.scoped.systemverilog") {
                                    return [ScopeType.RoutineOrdered, j];
                                }
                                else {
                                    let namedArg: Boolean = false;
                                    for (let k: number = j - 1; k >= 0; k--) {
                                        if (svtokens[k].text == ".") {
                                            namedArg = true;
                                            break;
                                        }
                                        else if (!svtokens[k].scopes[svtokens[k].scopes.length - 1].startsWith("comment.") &&
                                                 (svtokens[k].scopes[svtokens[k].scopes.length - 1] != "meta.whitespace.systemverilog")) {
                                            break;
                                        }
                                    }

                                    for (let k: number = 0; k < svtokens[j].scopes.length; k++) {
                                        if (!svtokens[j].scopes[k].startsWith("identifier.") &&
                                            (svtokens[j].scopes[k] != "parantheses.block.systemverilog") &&
                                            (svtokens[j].scopes[k] != "case.body.systemverilog") &&
                                            (svtokens[j].scopes[k] != "begin.block.systemverilog") &&
                                            (svtokens[j].scopes[k] != "generate.block.systemverilog") &&
                                            (svtokens[j].scopes[k] != "source.systemverilog")) {
                                            return [namedArg ? ScopeType.RoutineNamed : ScopeType.RoutineOrdered, j];
                                        }
                                    }

                                    if (namedArg) {
                                        return [ScopeType.InstanceParamsPortsNamed, j];
                                    }

                                    if (hashOpenParenFound) {
                                        return [ScopeType.InstanceParamsOrdered, j];
                                    }

                                    let scopeDepth: number = svtokens[j].scopes.length - 1;
                                    for (let k: number = j - 1; k >= 0; k--) {
                                        if (svtokens[k].scopes[scopeDepth].startsWith("identifier.")) {
                                            return [ScopeType.InstancePortsOrdered, k];
                                        }
                                    }
                                }
                            }
                            else if (!scope.startsWith("comment.") && (scope != "meta.whitespace.systemverilog")) {
                                if (!hashOpenParenFound && (svtokens[j].text == "#")) {
                                    hashOpenParenFound = true;
                                }
                                else {
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
        return [ScopeType.None, undefined];
    }

    private _getArgNum(scopeType: ScopeType, startTokenNum: number, tokenNum: number, svtokens: GrammarToken[]): number {
        let scopeDepth: number = svtokens[startTokenNum].scopes.length;
        if (scopeType == ScopeType.InstanceParamsPortsNamed) {
            scopeDepth--;
        }
        let argNum: number = 0;
        for (let i: number = startTokenNum + 1; i <= tokenNum; i++) {
            if ((svtokens[i].scopes.length > scopeDepth) &&
                (svtokens[i].scopes[scopeDepth] == "operator.comma.systemverilog")) {
                argNum++;
            }
        }
        return argNum;
    }

    getSignatures(document: TextDocument, line: number, character: number): SignatureHelp {
        let nullSignatureHelp: SignatureHelp = {
            signatures: [],
            activeSignature: null,
            activeParameter: null
        }

        const svtokens: GrammarToken[] = this._indexer.getSystemVerilogCompletionTokens(document.uri);
        const tokenNum: number = this._indexer.getSystemVerilogCompletionTokenNumber(document, line, character)[1];
        const svtoken: GrammarToken | null = (tokenNum > 0) && (tokenNum < svtokens.length) ? svtokens[tokenNum] : null;

        if (!svtoken) {
            return nullSignatureHelp;
        }

        let scopeType: ScopeType;
        let startTokenNum: number;
        [scopeType, startTokenNum] = this._getScopeType(tokenNum, svtokens);
        if (scopeType == ScopeType.None) {
            return nullSignatureHelp;
        }

        let argNum: number = this._getArgNum(scopeType, startTokenNum, tokenNum, svtokens);
        if (scopeType == ScopeType.SystemTask) {
            let taskInfo: [[string, string][], number];
            for (let task of systemTasksInfo.keys()) {
                let regEx: RegExp = new RegExp(String.raw`^\$${task.source}\s*\($`);
                if (regEx.exec(svtokens[startTokenNum].text)) {
                    taskInfo = systemTasksInfo.get(task);
                    break;
                }
            }
            if (taskInfo != undefined) {
                let params = [];
                for (let i: number = 0; i < taskInfo[0].length; i++) {
                    let label: string = taskInfo[0][i][0];
                    if (i == taskInfo[1]) {
                        label = `[${label}`;
                    }
                    if ((i == (taskInfo[0].length - 1)) &&
                        (taskInfo[1] < taskInfo[0].length)) {
                        label = `${label}]`;
                    }
                    params.push({
                        label: label,
                        documentation: taskInfo[0][i][1]
                    });
                }

                let signLabel: string = svtokens[startTokenNum].text.concat(params.map(param => { return param.label; }).join(', ')).concat(')');
                return {
                    signatures: [
                        {
                            label: signLabel,
                            documentation: "system task",
                            parameters: params
                        }
                    ],
                    activeSignature: 0,
                    activeParameter: argNum >= params.length ? params.length - 1: argNum
                };
            }
        }
        else if (scopeType == ScopeType.Macro) {
            let macroName: string = svtokens[startTokenNum].text.slice(1, -1).trim();
            let macroFilesInfo: [string, SystemVerilogSymbol[]][] = this._indexer.getMacros(document.uri, svtokens[startTokenNum].text.slice(1).replace(/\s*\($/, ""));
            if (macroFilesInfo.length > 0) {
                let macroDefinition: string = macroFilesInfo[0][1][0].getDefinition(macroFilesInfo[0][0]);

                let macroArgsStartRegEx: RegExp = new RegExp(String.raw`^\s*\`define\s+${macroName}\s*\(`);
                let macroArgsStart = macroArgsStartRegEx.exec(macroDefinition);
                if (!macroArgsStart) {
                    return nullSignatureHelp;
                }

                let params = [];
                let paramLabel: string = "";
                let nestDepth: number = 0;
                let charIndex: number = macroArgsStart[0].length;
                for (; charIndex < macroDefinition.length; charIndex++) {
                    if (((macroDefinition[charIndex] == ",") || (macroDefinition[charIndex] == ")")) && (nestDepth == 0)) {
                        params.push({ label: paramLabel.trim() });
                        if (macroDefinition[charIndex] == ")") {
                            charIndex++
                            break;
                        }
                        else {
                            paramLabel = "";
                        }
                    }
                    else {
                        paramLabel = paramLabel.concat(macroDefinition[charIndex]);
                        if ((macroDefinition[charIndex] == "(") ||
                            (macroDefinition[charIndex] == "[") ||
                            (macroDefinition[charIndex] == "{")) {
                            nestDepth++;
                        }
                        else if ((macroDefinition[charIndex] == ")") ||
                            (macroDefinition[charIndex] == "]") ||
                            (macroDefinition[charIndex] == "}")) {
                            nestDepth--;
                        }
                    }
                }

                let macroLabel: string = `\`${macroName}(`.concat(params.map(param => { return param.label; }).join(', ')).concat(')');
                let macroDoc: string = macroDefinition.slice(charIndex).trim();
                return {
                    signatures: [
                        {
                            label: macroLabel,
                            documentation: macroDoc,
                            parameters: params
                        }
                    ],
                    activeSignature: 0,
                    activeParameter: argNum >= params.length ? params.length - 1: argNum
                };
            }
        }
        else if (scopeType == ScopeType.RoutineNamed) {
            let scopeDepth: number = svtokens[startTokenNum].scopes.length - 2;
            if (scopeDepth <= 0) {
                return nullSignatureHelp;
            }

            let routineToken: number;
            for (let i: number = startTokenNum - 1; i >= 0; i--) {
                if (svtokens[i].scopes[scopeDepth].startsWith("identifier.")) {
                    routineToken = i;
                    break;
                }
            }
            if (routineToken == undefined) {
                return nullSignatureHelp;
            }

            let routineFile: string;
            let routineSymbol: SystemVerilogSymbol;
            let containerSymbolsInfo: SystemVerilogParser.SystemVerilogContainerSymbolsInfo[];
            [routineFile, routineSymbol, containerSymbolsInfo] = this._indexer.getContainerInfo(document.uri, svtokens[routineToken].text);
            if ((routineFile == undefined) || (routineSymbol == undefined) || (containerSymbolsInfo == undefined) ||
                (containerSymbolsInfo.length <= SystemVerilogParser.ContainerInfoIndex.Symbols) ||
                (containerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Symbols] == undefined)) {
                return nullSignatureHelp;
            }

            let routineArgSymbols: SystemVerilogSymbol[] = <SystemVerilogSymbol[]>(containerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Symbols]);
            let symbols: SystemVerilogSymbol[] = routineArgSymbols.filter(sym => { return sym.name == svtokens[startTokenNum].text; })
            if (symbols.length <= 0) {
                return nullSignatureHelp;
            }

            let label: string = `${svtokens[routineToken].text}(${routineArgSymbols.map(sym => sym.name).join(', ')})`;
            let definition: string = symbols[0].getDefinition(routineFile);
            return {
                signatures: [
                    {
                        label: definition,
                        documentation: routineSymbol.getDefinition(routineFile),
                        parameters: []
                    }
                ],
                activeSignature: 0,
                activeParameter: null
            };
        }
        else if (scopeType == ScopeType.RoutineOrdered) {
            let routineFile: string;
            let routineSymbol: SystemVerilogSymbol;
            let containerSymbolsInfo: SystemVerilogParser.SystemVerilogContainerSymbolsInfo[];
            [routineFile, routineSymbol, containerSymbolsInfo] = this._indexer.getContainerInfo(document.uri, svtokens[startTokenNum].text);
            //DBG ConnectionLogger.log(`DEBUG: HERE with ${svtoken.text} and ${scopeType} and ${svtokens[startTokenNum].text} and ${routineFile} and ${routineSymbol.name} and ${containerSymbolsInfo == undefined}`);
            if ((routineFile == undefined) || (routineSymbol == undefined) || (containerSymbolsInfo == undefined)) {
                return nullSignatureHelp;
            }

            if ((containerSymbolsInfo.length <= SystemVerilogParser.ContainerInfoIndex.Symbols) ||
                (containerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Symbols] == undefined)) {
                return {
                    signatures: [
                        {
                            label: `${svtokens[startTokenNum].text}()`,
                            documentation: routineSymbol.getDefinition(routineFile),
                            parameters: []
                        }
                    ],
                    activeSignature: 0,
                    activeParameter: undefined
                };
            }

            let routineArgSymbols: SystemVerilogSymbol[] = <SystemVerilogSymbol[]>(containerSymbolsInfo[SystemVerilogParser.ContainerInfoIndex.Symbols]);
            let label: string = `${svtokens[startTokenNum].text}(${routineArgSymbols.map(sym => sym.name).join(', ')})`;
            let definitions: string[] = SystemVerilogSymbol.getDefinitions(routineFile, routineArgSymbols);
            let params = [];
            for (let i: number = 0; i < routineArgSymbols.length; i++) {
                params.push({
                    label: routineArgSymbols[i].name,
                    documentation: definitions[i]
                });
            }
            return {
                signatures: [
                    {
                        label: label,
                        documentation: routineSymbol.getDefinition(routineFile),
                        parameters: params
                    }
                ],
                activeSignature: 0,
                activeParameter: argNum >= params.length ? params.length - 1 : argNum
            };
        }
        else if (scopeType == ScopeType.InstanceParamsPortsNamed) {
            // Find the instance type
            let scopeDepth: number = svtokens[startTokenNum].scopes.length - 2;
            if (scopeDepth <= 0) {
                return nullSignatureHelp;
            }

            let instTypeToken: number;
            let openParenFound: Boolean = false;
            let hashOpenParenFound: Boolean = false;
            let portScope: Boolean = false;
            for (let i: number = startTokenNum - 1; i >= 0; i--) {
                if (svtokens[i].scopes[scopeDepth].startsWith("identifier.")) {
                    if (portScope || hashOpenParenFound) {
                        instTypeToken = i;
                        break;
                    }
                    else if (openParenFound) {
                        portScope = true;
                    }
                }
                else if (!svtokens[i].scopes[svtokens[i].scopes.length - 1].startsWith("comment.") &&
                         (svtokens[i].scopes[svtokens[i].scopes.length - 1] != "meta.whitespace.systemverilog")) {
                    if (hashOpenParenFound) {
                        openParenFound = false;
                        hashOpenParenFound = false;
                    }
                    else if (openParenFound) {
                       if (svtokens[i].text == "#") {
                           hashOpenParenFound = true;
                       }
                       openParenFound = false;
                    }
                    else if (svtokens[i].text == "(") {
                        openParenFound = true;
                    }
                }
            }
            if ((instTypeToken == undefined) || (!openParenFound && !hashOpenParenFound)) {
                return nullSignatureHelp;
            }

            let symbols: SystemVerilogSymbol[] = (portScope ? this._indexer.getInstPorts(svtokens[instTypeToken].text)
                                                            : this._indexer.getInstParams(svtokens[instTypeToken].text)).filter(sym => { return sym.name == svtokens[startTokenNum].text; })
            if (symbols.length <= 0) {
                return nullSignatureHelp;
            }

            let instTypeSymbol: SystemVerilogSymbol = this._indexer.getContainerSymbol(svtokens[instTypeToken].text);
            let instFilePath: string = this._indexer.getInstFilePath(svtokens[instTypeToken].text);
            let definition: string = symbols[0].getDefinition(instFilePath);
            return {
                signatures: [
                    {
                        label: definition,
                        documentation: instTypeSymbol.getDefinition(instFilePath),
                        parameters: []
                    }
                ],
                activeSignature: 0,
                activeParameter: null
            };
        }
        else if ((scopeType == ScopeType.InstanceParamsOrdered) ||
                 (scopeType == ScopeType.InstancePortsOrdered)) {
            let symbols: SystemVerilogSymbol[] = (scopeType == ScopeType.InstanceParamsOrdered) ? this._indexer.getInstParams(svtokens[startTokenNum].text) : this._indexer.getInstPorts(svtokens[startTokenNum].text);
            let label: string = `${svtokens[startTokenNum].text}(${symbols.map(sym => sym.name).join(', ')})`;
            let instTypeSymbol: SystemVerilogSymbol = this._indexer.getContainerSymbol(svtokens[startTokenNum].text);
            let instFilePath: string = this._indexer.getInstFilePath(svtokens[startTokenNum].text);
            let definitions: string[] = SystemVerilogSymbol.getDefinitions(instFilePath, symbols);
            let params = [];
            for (let i: number = 0; i < symbols.length; i++) {
                params.push({
                    label: symbols[i].name,
                    documentation: definitions[i]
                });
            }
            return {
                signatures: [
                    {
                        label: label,
                        documentation: instTypeSymbol.getDefinition(instFilePath),
                        parameters: params
                    }
                ],
                activeSignature: 0,
                activeParameter: argNum >= params.length ? params.length - 1 : argNum
            };
        }

        return nullSignatureHelp;
    }
}
