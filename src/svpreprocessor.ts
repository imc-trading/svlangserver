import { TextDocument, Location, Range, Position } from "vscode-languageserver";

import {
    fsReadFileSync,
    pathToUri,
    uriToPath
} from './genutils';

import {
    GrammarEngine,
    GrammarToken,
} from './grammar_engine';

import {
    svpreproc_grammar
} from './svpreproc_grammar';

import {
    SystemVerilogSymbol,
    SystemVerilogSymbolJSON
} from "./svsymbol";

enum MacroAction {
    Add,
    Del,
    DelAll
}

export class PostToken {
    text: string;
    index: number;
    endIndex: number;
}

class ReplToken extends GrammarToken {
    endIndex: number;
}

export type MacroInfo = { args: Map<string, number>, default: GrammarToken[][], definition: GrammarToken[], symbol: SystemVerilogSymbol, file: string };
type MacroInfoJSON = [[string, number][], GrammarToken[][], GrammarToken[], SystemVerilogSymbolJSON, string];
type MacroChange = { action: MacroAction, macroName: string, macroInfo: MacroInfo };
type MacroChangeJSON = [MacroAction, string, MacroInfoJSON];
export type PreprocIncInfo = { symbols: SystemVerilogSymbol[], postTokens: PostToken[], tokenOrder: [string, number][], macroChanges: MacroChange[], macroChangeOrder: [string, number][], includes: Set<string> };
export type PreprocIncInfoJSON = [SystemVerilogSymbolJSON[], PostToken[], [string, number][], MacroChangeJSON[], [string, number][], string[]];
export type PreprocInfo = { symbols: SystemVerilogSymbol[], postTokens: PostToken[], tokenOrder: [string, number][], includes: Set<string> };
type TokenMarker = number;
const DEBUG_MODE: number = 0;

class PreprocTokenManager {
    private _preTokens: Array<GrammarToken|ReplToken>;
    private _currTokenNum: number;
    private _tokensPending: Boolean;

    public constructor(tokens: GrammarToken[]) {
        this._preTokens = tokens;
        this._currTokenNum = 0;
        this._tokensPending = tokens.length > 0;
    }

    public getCurrToken(): GrammarToken|ReplToken {
        return this._preTokens[this._currTokenNum];
    }

    public nextToken() {
        if (this._currTokenNum < (this._preTokens.length - 1)) {
            this._currTokenNum++;
        }
        else {
            this._tokensPending = false;
        }
    }

    public prevToken(tokenMarker?: TokenMarker) {
        if (this._currTokenNum == 0) {
            console.error(`cannot go before first token`);
        }
        else if (tokenMarker != undefined) {
            this._currTokenNum = tokenMarker;
            this._tokensPending = true;
        }
        else if (this._tokensPending) {
            this._currTokenNum--;
        }
        else {
            this._tokensPending = true;
        }
    }

    public tokensPending(): Boolean {
        return this._tokensPending;
    }

    public getCurrTokenMarker(): TokenMarker {
        return this._currTokenNum;
    }

    public getEmptyPostToken(tokenMarker?: TokenMarker): PostToken {
        let startTokenMarker: number = (tokenMarker == undefined) ? this._currTokenNum : tokenMarker;
        if ('endIndex' in this._preTokens[this._currTokenNum]) {
            return {
                text: " ",
                index: this._preTokens[startTokenMarker].index,
                endIndex: (<ReplToken>this._preTokens[this._currTokenNum]).endIndex
            };
        }
        else {
            return {
                text: " ",
                index: this._preTokens[startTokenMarker].index,
                endIndex: this._preTokens[this._currTokenNum].index + this._preTokens[this._currTokenNum].text.length - 1
            };
        }
    }

    public getCurrPostToken(): PostToken {
        if ('endIndex' in this._preTokens[this._currTokenNum]) {
            return {
                text: this._preTokens[this._currTokenNum].text,
                index: this._preTokens[this._currTokenNum].index,
                endIndex: (<ReplToken>this._preTokens[this._currTokenNum]).endIndex
            };
        }
        else {
            return {
                text: this._preTokens[this._currTokenNum].text,
                index: this._preTokens[this._currTokenNum].index,
                endIndex: this._preTokens[this._currTokenNum].index + this._preTokens[this._currTokenNum].text.length - 1
            };
        }
    }

    public getRange(document: TextDocument, startTokenMarker: TokenMarker, endTokenMarker?: TokenMarker): Range {
        let endTokenNum: TokenMarker = endTokenMarker || this._currTokenNum;
        if ('endIndex' in this._preTokens[this._currTokenNum]) {
            return Range.create(
                document.positionAt(this._preTokens[startTokenMarker].index),
                document.positionAt((<ReplToken>this._preTokens[endTokenNum]).endIndex + 1));
        }
        else {
            return Range.create(
                document.positionAt(this._preTokens[startTokenMarker].index),
                document.positionAt(this._preTokens[endTokenNum].index + this._preTokens[endTokenNum].text.length));
        }
    }

    public replaceTokens(startTokenMarker: TokenMarker, newTokens: GrammarToken[]) {
        let startIndex: number = this._preTokens[startTokenMarker].index;
        let endIndex: number = ('endIndex' in this._preTokens[this._currTokenNum]) ? (<ReplToken>this._preTokens[this._currTokenNum]).endIndex
                                                                                   : this._preTokens[this._currTokenNum].index + this._preTokens[this._currTokenNum].text.length - 1;
        let replTokens: ReplToken[] = [];
        if (newTokens && (newTokens.length > 0)) {
            replTokens = newTokens.map(token => { return {text: token.text, index: startIndex, scopes: token.scopes, endIndex: endIndex}; });
        }
        this._preTokens.splice(startTokenMarker, this._currTokenNum - startTokenMarker + 1, ...replTokens);
        this._currTokenNum = startTokenMarker;
    }
}

export class SystemVerilogPreprocessor {
    private _document: TextDocument;
    private _filePath: string;
    private _fileList: Set<string>;
    private _includeFilePaths: string[];
    private _includeCache: Map<string, [string, PreprocIncInfo, TextDocument]>;
    private _preprocIncInfo: PreprocIncInfo;
    private _macroInfo: Map<string, MacroInfo>;
    private _tokenManager: PreprocTokenManager;

    private _getElem<T>(list: T[], index?: number): T {
        let _index: number = (index == undefined) ? list.length - 1: index;
        return (list.length > _index) && (_index >= 0) ? list[_index] : undefined;
    }

    private _printDebugInfo(blockId: string) {
        if (DEBUG_MODE != 1) {
            return;
        }
        let pos: Position = this._document.positionAt(this._tokenManager.getCurrToken().index);
        console.log(`DEBUG: Found ${blockId} at ${pos.line}, ${pos.character}`);
    }

    private _pushEmptyPostToken(startTokenMarker?: number) {
        this._preprocIncInfo.postTokens.push(this._tokenManager.getEmptyPostToken(startTokenMarker));
    }

    private _processMacroArgDefault(): GrammarToken[] {
        let scopeDepth: number = this._tokenManager.getCurrToken().scopes.length - 1;
        this._tokenManager.nextToken();

        let argDefault: GrammarToken[] = [];
        let firstTokenFound: Boolean = false;
        let tokenNum: number = 0;
        let lastTokenNum: number = 0;
        for (; this._tokenManager.tokensPending(); this._tokenManager.nextToken()) {
            let scope: string = this._getElem(this._tokenManager.getCurrToken().scopes, scopeDepth);
            if ((scope == "parantheses.close.systemverilog") ||
                (scope == "operator.comma.systemverilog")) {
                this._tokenManager.prevToken();
                break;
            }
            else if (firstTokenFound || (this._getElem(this._tokenManager.getCurrToken().scopes) != "meta.whitespace.systemverilog")) {
                argDefault.push(this._tokenManager.getCurrToken());
                firstTokenFound = true;
                if (this._getElem(this._tokenManager.getCurrToken().scopes) != "meta.whitespace.systemverilog") {
                    lastTokenNum = tokenNum;
                }
            }
            tokenNum++;
        }

        return argDefault.slice(lastTokenNum - tokenNum);
    }

    private _processMacroArgs(macroInfo: MacroInfo) {
        let scopeDepth: number = this._tokenManager.getCurrToken().scopes.length - 1;
        this._tokenManager.nextToken();
        let argId: string;
        let argCount: number = 0;
        let argDefault: GrammarToken[];
        for (; this._tokenManager.tokensPending(); this._tokenManager.nextToken()) {
            let scope: string = this._getElem(this._tokenManager.getCurrToken().scopes, scopeDepth + 1);
            if ((scope == "parantheses.close.systemverilog") ||
                (scope == "operator.comma.systemverilog")) {
                if (argId) {
                    macroInfo.args.set(argId, argCount);
                    macroInfo.default.push(argDefault);
                    argCount++;
                }

                if (scope == "parantheses.close.systemverilog") {
                    break;
                }
                else {
                    argId = undefined;
                    argDefault = undefined;
                }
            }
            else if (scope == "identifier.regular.systemverilog") {
                argId = this._tokenManager.getCurrToken().text;
            }
            else if (scope == "operator.equals.systemverilog") {
                argDefault = this._processMacroArgDefault();
            }
        }
    }

    private _processDefine(): Boolean {
        let startTokenMarker: TokenMarker = this._tokenManager.getCurrTokenMarker();
        let scopeDepth: number = this._tokenManager.getCurrToken().scopes.length - 1;
        let scope: string = this._getElem(this._tokenManager.getCurrToken().scopes, scopeDepth);
        if ((scope != "meta.macro.systemverilog") ||
            (this._tokenManager.getCurrToken().text != "`define")) {
            return false;
        }

        this._printDebugInfo("define macro");
        this._tokenManager.nextToken();
        let macroName: string;
        let macroNameMarker: TokenMarker;
        let macroInfo: MacroInfo = { args: undefined, default: undefined, definition: [], symbol: undefined, file: this._filePath };
        let checkArgsList: Boolean = true;
        for (; this._tokenManager.tokensPending(); this._tokenManager.nextToken()) {
            scope = this._getElem(this._tokenManager.getCurrToken().scopes, scopeDepth);
            let topScope: string = this._getElem(this._tokenManager.getCurrToken().scopes);
            if ((topScope == "meta.whitespace.systemverilog") &&
                /\n|\r/.exec(this._tokenManager.getCurrToken().text)) {
                break;
            }
            else if (topScope == "comment.line.systemverilog") {
                break;
            }
            else if (macroName) {
                if (checkArgsList && (scope == "parantheses.open.systemverilog")) {
                    macroInfo.args = new Map();
                    macroInfo.default = [];
                    this._processMacroArgs(macroInfo);
                    checkArgsList = false;
                }
                else if (checkArgsList && (topScope != "meta.whitespace.systemverilog")) {
                    macroInfo.definition.push(this._tokenManager.getCurrToken());
                    checkArgsList = false;
                }
                else if (!checkArgsList) {
                    macroInfo.definition.push(this._tokenManager.getCurrToken());
                }
            }
            else if (scope == "identifier.regular.systemverilog") {
                macroName = this._tokenManager.getCurrToken().text;
                macroNameMarker = this._tokenManager.getCurrTokenMarker();
            }
        }

        if (macroName) {
            macroInfo.symbol = new SystemVerilogSymbol(
                macroName,
                this._tokenManager.getRange(this._document, startTokenMarker),
                this._tokenManager.getRange(this._document, macroNameMarker, macroNameMarker),
                ["source.systemverilog"],
                ["macro"]
            );
            if (this._macroInfo.has(macroName)) {
                this._macroInfo.delete(macroName);
                this._preprocIncInfo.macroChanges.push({action: MacroAction.Del, macroName: macroName, macroInfo: undefined});
            }
            this._macroInfo.set(macroName, macroInfo);
            this._preprocIncInfo.macroChanges.push({action: MacroAction.Add, macroName: macroName, macroInfo: macroInfo});
        }
        this._pushEmptyPostToken(startTokenMarker);

        return true;
    }

    private _processNoArgDirectives(): Boolean {
        let scope: string = this._getElem(this._tokenManager.getCurrToken().scopes);
        let tokenText = this._tokenManager.getCurrToken().text;
        if ((scope != "meta.macro.systemverilog") ||
            ((tokenText != "`resetall") &&
             (tokenText != "`undefineall") &&
             (tokenText != "`nounconnected_drive") &&
             (tokenText != "`celldefine") && 
             (tokenText != "`endcelldefine") &&
             (tokenText != "`__FILE__") &&
             (tokenText != "`__LINE__") &&
             (tokenText != "`end_keywords"))) {
            return false;
        }

        if (tokenText == "`undefineall") {
            this._macroInfo = new Map();
            this._preprocIncInfo.macroChanges.push({action: MacroAction.DelAll, macroName: undefined, macroInfo: undefined});
        }

        this._pushEmptyPostToken();

        return true;
    }

    private _processSingleArgDirectives(): Boolean {
        let startTokenMarker: TokenMarker = this._tokenManager.getCurrTokenMarker();
        let scope: string = this._getElem(this._tokenManager.getCurrToken().scopes);
        let tokenText: string = this._tokenManager.getCurrToken().text;
        if ((scope != "meta.macro.systemverilog") ||
            ((tokenText != "`undef") &&
             (tokenText != "`default_nettype") &&
             (tokenText != "`unconnected_drive"))) {
            return false;
        }

        this._printDebugInfo("single arg directive");
        this._tokenManager.nextToken();
        for (; this._tokenManager.tokensPending(); this._tokenManager.nextToken()) {
            if (this._getElem(this._tokenManager.getCurrToken().scopes) != "meta.whitespace.systemverilog") {
                break;
            }
        }

        if (tokenText == "`undef") {
            this._macroInfo.delete(this._tokenManager.getCurrToken().text);
            this._preprocIncInfo.macroChanges.push({action: MacroAction.Del, macroName: this._tokenManager.getCurrToken().text, macroInfo: undefined});
        }

        this._pushEmptyPostToken(startTokenMarker);

        return true;
    }

    private _processTimescaleDirective(): Boolean {
        let startTokenMarker: TokenMarker = this._tokenManager.getCurrTokenMarker();
        let scope: string = this._getElem(this._tokenManager.getCurrToken().scopes);
        if ((scope != "meta.macro.systemverilog") ||
            (this._tokenManager.getCurrToken().text != "`timescale")) {
            return false;
        }

        this._printDebugInfo("timescale directive");
        this._tokenManager.nextToken();
        let numTokens: number = 0;
        for (; this._tokenManager.tokensPending(); this._tokenManager.nextToken()) {
            if (this._getElem(this._tokenManager.getCurrToken().scopes) != "meta.whitespace.systemverilog") {
                numTokens++;
                if (numTokens == 5) {
                    break;
                }
            }
        }

        this._pushEmptyPostToken(startTokenMarker);

        return true;
    }

    private _processPragmaDirective(): Boolean {
        let startTokenMarker: TokenMarker = this._tokenManager.getCurrTokenMarker();
        let scope: string = this._getElem(this._tokenManager.getCurrToken().scopes);
        if ((scope != "meta.macro.systemverilog") ||
            (this._tokenManager.getCurrToken().text != "`pragma")) {
            return false;
        }

        this._printDebugInfo("pragma directive");
        this._tokenManager.nextToken();
        for (; this._tokenManager.tokensPending(); this._tokenManager.nextToken()) {
            let topScope: string = this._getElem(this._tokenManager.getCurrToken().scopes);
            if ((topScope == "meta.whitespace.systemverilog") &&
                /\n|\r/.exec(this._tokenManager.getCurrToken().text)) {
                break;
            }
            else if (topScope == "comment.line.systemverilog") {
                break;
            }
        }

        this._pushEmptyPostToken(startTokenMarker);

        return true;
    }

    private _processLineDirective(): Boolean {
        let startTokenMarker: TokenMarker = this._tokenManager.getCurrTokenMarker();
        let scope: string = this._getElem(this._tokenManager.getCurrToken().scopes);
        if ((scope != "meta.macro.systemverilog") ||
            (this._tokenManager.getCurrToken().text != "`line")) {
            return false;
        }

        this._printDebugInfo("line directive");
        this._tokenManager.nextToken();
        for (; this._tokenManager.tokensPending(); this._tokenManager.nextToken()) {
            let topScope: string = this._getElem(this._tokenManager.getCurrToken().scopes);
            if (topScope == "identifier.regular.systemverilog") {
                break;
            }
        }

        this._tokenManager.nextToken();
        for (; this._tokenManager.tokensPending(); this._tokenManager.nextToken()) {
            let topScope: string = this._getElem(this._tokenManager.getCurrToken().scopes);
            if (topScope == "string.end.systemverilog") {
                break;
            }
        }

        this._tokenManager.nextToken();
        for (; this._tokenManager.tokensPending(); this._tokenManager.nextToken()) {
            let topScope: string = this._getElem(this._tokenManager.getCurrToken().scopes);
            if (topScope == "literal.number.systemverilog") {
                break;
            }
        }

        this._pushEmptyPostToken(startTokenMarker);

        return true;
    }

    private _processBeginKeywordsDirective(): Boolean {
        let startTokenMarker: TokenMarker = this._tokenManager.getCurrTokenMarker();
        let scope: string = this._getElem(this._tokenManager.getCurrToken().scopes);
        if ((scope != "meta.macro.systemverilog") ||
            (this._tokenManager.getCurrToken().text != "`begin_keywords")) {
            return false;
        }

        this._printDebugInfo("begin_keywords directive");
        this._tokenManager.nextToken();
        for (; this._tokenManager.tokensPending(); this._tokenManager.nextToken()) {
            let topScope: string = this._getElem(this._tokenManager.getCurrToken().scopes);
            if (topScope == "string.end.systemverilog") {
                break;
            }
        }

        this._pushEmptyPostToken(startTokenMarker);

        return true;
    }

    private _skipConditionalBlock() {
        let nestingLevel: number = 0;
        for (; this._tokenManager.tokensPending(); this._tokenManager.nextToken()) {
            if (this._getElem(this._tokenManager.getCurrToken().scopes) == "meta.macro.systemverilog") {
                let tokenText: string = this._tokenManager.getCurrToken().text;
                if ((tokenText == "`ifdef") || (tokenText == "`ifndef")) {
                    nestingLevel++;
                }
                else {
                    if ((nestingLevel == 0) &&
                        ((tokenText == "`elsif") ||
                         (tokenText == "`else") ||
                         (tokenText == "`endif"))) {
                        break;
                    }
                    else if ((nestingLevel != 0) && (tokenText == "`endif")) {
                        nestingLevel--;
                    }
                }
            }
        }
    }

    private _processConditionalDirectives(): Boolean {
        let startTokenMarker: TokenMarker = this._tokenManager.getCurrTokenMarker();
        let scope: string = this._getElem(this._tokenManager.getCurrToken().scopes);
        let preTokenText = this._tokenManager.getCurrToken().text;
        if ((scope != "meta.macro.systemverilog") ||
            ((preTokenText != "`ifdef") &&
             (preTokenText != "`ifndef") &&
             (preTokenText != "`elsif") &&
             (preTokenText != "`else") &&
             (preTokenText != "`endif"))) {
            return false;
        }

        this._printDebugInfo("conditional directive");
        if ((preTokenText == "`ifdef") || (preTokenText == "`ifndef")) {
            while (this._tokenManager.tokensPending()) {
                let tokenText: string = this._tokenManager.getCurrToken().text;
                this._tokenManager.nextToken();
                if ((tokenText == "`ifdef") || (tokenText == "`ifndef") || (tokenText == "`elsif")) {
                    for (; this._tokenManager.tokensPending(); this._tokenManager.nextToken()) {
                        if (this._getElem(this._tokenManager.getCurrToken().scopes) == "identifier.regular.systemverilog") {
                            break;
                        }
                    }
                    if (this._tokenManager.tokensPending()) {
                        let currTokenText: string = this._tokenManager.getCurrToken().text;
                        if ((((tokenText == "`ifdef") || (tokenText == "`elsif")) && (this._macroInfo.has(currTokenText))) ||
                            ((tokenText == "`ifndef") && (!this._macroInfo.has(currTokenText)))) {
                            break;
                        }
                        else {
                            this._skipConditionalBlock();
                        }
                    }
                }
                else {
                    break;
                }
            }
        }
        else if (preTokenText != "`endif") {
            while (this._tokenManager.tokensPending()) {
                this._tokenManager.nextToken();
                this._skipConditionalBlock();
                if (this._tokenManager.getCurrToken().text == "`endif") {
                    this._tokenManager.nextToken();
                    break;
                }
            }
        }

        this._pushEmptyPostToken(startTokenMarker);

        return true;
    }

    private _getAllMacroChanges(macroChanges: MacroChange[], macroChangeOrder: [string, number][]) {
        let allMacroChanges: MacroChange[] = [];
        let prevIndex: number = 0;
        for (let order of macroChangeOrder) {
            if (order[1] > prevIndex) {
                allMacroChanges = allMacroChanges.concat(macroChanges.slice(prevIndex, order[1]));
            }
            let incInfo: PreprocIncInfo = this._includeCache.get(order[0])[1];
            allMacroChanges = allMacroChanges.concat(this._getAllMacroChanges(incInfo.macroChanges, incInfo.macroChangeOrder));
            prevIndex = order[1];
        }
        if (prevIndex < macroChanges.length) {
            allMacroChanges = allMacroChanges.concat(macroChanges.slice(prevIndex));
        }
        return allMacroChanges;

    }

    private _applyMacroChanges(macroChanges: MacroChange[], macroChangeOrder: [string, number][]) {
        let allMacroChanges: MacroChange[] = this._getAllMacroChanges(macroChanges, macroChangeOrder);

        for (let macroChange of allMacroChanges) {
            if (macroChange.action == MacroAction.DelAll) {
                this._macroInfo = new Map();
            }
            else if (macroChange.action == MacroAction.Del) {
                this._macroInfo.delete(macroChange.macroName);
            }
            else {
                this._macroInfo.set(macroChange.macroName, macroChange.macroInfo);
            }
        }
    }

    private _processIncludeDirective(): Boolean {
        let startTokenMarker: TokenMarker = this._tokenManager.getCurrTokenMarker();
        let scope: string = this._getElem(this._tokenManager.getCurrToken().scopes);
        let preTokenText = this._tokenManager.getCurrToken().text;
        if ((scope != "meta.macro.systemverilog") ||
            (preTokenText != "`include")) {
            return false;
        }

        this._printDebugInfo("include directive");
        this._tokenManager.nextToken();
        let fileName: string = "";
        for (; this._tokenManager.tokensPending(); this._tokenManager.nextToken()) {
            let scope: string = this._getElem(this._tokenManager.getCurrToken().scopes);
            //TBD `define based include
            if ((scope == "string.end.systemverilog") || (this._tokenManager.getCurrToken().text == ">")) {
                break;
            }
            else if ((scope != "string.begin.systemverilog") && (this._tokenManager.getCurrToken().text != "<")) {
                fileName += this._tokenManager.getCurrToken().text;
            }
        }
        if (this._tokenManager.tokensPending()) {
            fileName = fileName.trim();
            // Remove relative include components
            while (fileName.startsWith("./") || fileName.startsWith("../")) {
                if (fileName.startsWith("./")) {
                    fileName = fileName.substring("./".length);
                }
                else if (fileName.startsWith("../")) {
                    fileName = fileName.substring("../".length);
                }
            }

            let includeFilePath: string;
            let preprocIncInfo: PreprocIncInfo;
            if (this._includeCache.has(fileName)) {
                let incInfo: [string, PreprocIncInfo, TextDocument] = this._includeCache.get(fileName);
                includeFilePath = incInfo[0];
                preprocIncInfo = incInfo[1];
                this._applyMacroChanges(preprocIncInfo.macroChanges, preprocIncInfo.macroChangeOrder);
                this._preprocIncInfo.includes.add(includeFilePath);
            }
            else {
                for (let incFilePath of this._includeFilePaths) {
                    if (incFilePath.endsWith(fileName)) {
                        includeFilePath = incFilePath;
                        break;
                    }
                }
                if (includeFilePath) {
                    let allCachedIncFiles: Map<string, string> = new Map(Array.from(this._includeCache).map(([k, v]) => [v[0], k]));
                    if (allCachedIncFiles.has(includeFilePath)) {
                        preprocIncInfo = this._includeCache.get(allCachedIncFiles.get(includeFilePath))[1];
                        let document: TextDocument = this._includeCache.get(allCachedIncFiles.get(includeFilePath))[2];
                        this._includeCache.set(fileName, [includeFilePath, preprocIncInfo, document]);
                        this._applyMacroChanges(preprocIncInfo.macroChanges, preprocIncInfo.macroChangeOrder);
                    }
                    else {
                        try {
                            let data = fsReadFileSync(includeFilePath);
                            let document: TextDocument = TextDocument.create(pathToUri(includeFilePath), "SystemVerilog", 0, data.toString());
                            preprocIncInfo = (new SystemVerilogPreprocessor())._parseInc(document, this._includeFilePaths, this._includeCache, this._macroInfo, this._fileList);
                            this._includeCache.set(fileName, [includeFilePath, preprocIncInfo, document]);
                        }
                        catch (err) {
                            console.warn(`Could not process include file ${includeFilePath} - ${err}`);
                            preprocIncInfo = { symbols: [], postTokens: [], tokenOrder: [], macroChanges: [], macroChangeOrder: [], includes: new Set() };
                        }
                    }

                    this._preprocIncInfo.includes.add(includeFilePath);
                }
                else {
                    console.warn(`Could not find include file ${fileName}`);
                    preprocIncInfo = { symbols: [], postTokens: [], tokenOrder: [], macroChanges: [], macroChangeOrder: [], includes: new Set() };
                }
            }

            if (preprocIncInfo.postTokens.length > 0) {
                this._preprocIncInfo.tokenOrder.push([fileName, this._preprocIncInfo.postTokens.length]);
            }

            if (preprocIncInfo.macroChanges.length > 0) {
                this._preprocIncInfo.macroChangeOrder.push([fileName, this._preprocIncInfo.macroChanges.length]);
            }
        }

        this._pushEmptyPostToken(startTokenMarker);

        return true;
    }

    private _replaceSpecialMacros(tokens: GrammarToken[]): GrammarToken[] {
        let result: GrammarToken[] = [...tokens];
        for (let i: number = 0; i < tokens.length; i++) {
            let scope: string = this._getElem(result[i].scopes);
            if (scope == "macro.quote.systemverilog") {
                result[i] = { text: '"', index: result[i].index, scopes: [...result[i].scopes.slice(-1), "string.begin.systemverilog"] };
            }
            else if (scope == "macro.escaped_quote.systemverilog") {
                result[i] = { text: '\\"', index: result[i].index, scopes: [...result[i].scopes.slice(-1), "escaped.quote.systemverilog"]};
            }
            else if (scope == "macro.concat.systemverilog") {
                result[i-1] = { text: result[i-1].text.concat(result[i+1].text), index: result[i-1].index, scopes: result[i-1].scopes };
                result.splice(i, 2);
                i--;
            }
            else if (scope == "escaped.new_line.systemverilog") {
                result[i] = { text: '\n', index: result[i].index, scopes: [...result[i].scopes.slice(-1), "meta.whitespace.systemverilog"]};
            }
        }
        return result;
    }

    private _expandMacroCall(macroInfo: MacroInfo, argTokens: GrammarToken[][]): GrammarToken[] {
        if (!macroInfo.definition || (macroInfo.definition.length == 0)) {
            return [];
        }

        let valueTokens: GrammarToken[][] = [];
        for (let i: number = 0; i < argTokens.length; i++) {
            let tokens: GrammarToken[] = argTokens[i];
            if ((tokens.length == 0) && (macroInfo.default.length > i) && (macroInfo.default[i].length != 0)) {
                valueTokens.push(macroInfo.default[i]);
            }
            else {
                let start: number = 0;
                for (let j: number = 0; j < argTokens[i].length; j++) {
                    if (this._getElem(argTokens[i][j].scopes) != "meta.whitespace.systemverilog") {
                        start = j;
                        break;
                    }
                }

                let end: number = 0;
                for (let j: number = argTokens[i].length - 1; j >= 0; j--) {
                    if (this._getElem(argTokens[i][j].scopes) != "meta.whitespace.systemverilog") {
                        end = j;
                        break;
                    }
                }

                valueTokens.push([...tokens].splice(start, end - start + 1));
            }
        }

        let result: GrammarToken[] = [];
        for (let i: number = 0; i < macroInfo.definition.length; i++) {
            let tokenText: string = macroInfo.definition[i].text;
            if ((this._getElem(macroInfo.definition[i].scopes) == "identifier.regular.systemverilog") && (macroInfo.args.has(tokenText))) {
                result = result.concat(valueTokens[macroInfo.args.get(tokenText)]);
            }
            else {
                result.push(macroInfo.definition[i]);
            }
        }

        return this._replaceSpecialMacros(result);
    }

    private _processMacroCall(): Boolean {
        let startTokenMarker: TokenMarker = this._tokenManager.getCurrTokenMarker();
        let scopeDepth: number = this._tokenManager.getCurrToken().scopes.length - 1;
        let scope: string = this._getElem(this._tokenManager.getCurrToken().scopes);
        let macroName = this._tokenManager.getCurrToken().text.slice(1);
        if ((scope != "meta.macro.systemverilog") ||
            !this._macroInfo.has(macroName)) {
            return false;
        }

        this._printDebugInfo("macro call");
        let macroInfo: MacroInfo = this._macroInfo.get(macroName);
        if (macroInfo.args == undefined) {
            this._tokenManager.replaceTokens(startTokenMarker, this._replaceSpecialMacros(macroInfo.definition));
        }
        else {
            this._tokenManager.nextToken();
            for (; this._tokenManager.tokensPending(); this._tokenManager.nextToken()) {
                let scope: string = this._getElem(this._tokenManager.getCurrToken().scopes);
                if (scope == "parantheses.open.systemverilog") {
                    break;
                }
                else if (scope != "meta.whitespace.systemverilog") {
                    this._tokenManager.prevToken(startTokenMarker);
                    return false;
                }
            }

            let argTokens: GrammarToken[][] = [];
            let currArgTokens: GrammarToken[] = [];
            this._tokenManager.nextToken();
            for (; this._tokenManager.tokensPending(); this._tokenManager.nextToken()) {
                let scope: string = this._getElem(this._tokenManager.getCurrToken().scopes, scopeDepth + 1);
                if ((scope == "operator.comma.systemverilog") || (scope == "parantheses.close.systemverilog")) {
                    argTokens.push(currArgTokens);
                    if (scope == "parantheses.close.systemverilog") {
                        break;
                    }
                    else {
                        currArgTokens = [];
                    }
                }
                else {
                    currArgTokens.push(this._tokenManager.getCurrToken());
                }
            }

            this._tokenManager.replaceTokens(startTokenMarker, this._expandMacroCall(macroInfo, argTokens));
        }

        return true;
    }

    public static tokenize(preText: string): GrammarToken[] {
        let _grammarEngine: GrammarEngine = new GrammarEngine(svpreproc_grammar, "meta.any.systemverilog");
        return _grammarEngine.tokenize(preText)
    }

    private _parseInc(document: TextDocument, includeFilePaths: string[], includeCache: Map<string, [string, PreprocIncInfo, TextDocument]>, macroInfo: Map<string, MacroInfo>, fileList: Set<string>, text?: string): PreprocIncInfo {
        let preText: string = text || document.getText();
        this._document = document;
        this._filePath = uriToPath(document.uri);
        this._fileList = fileList;
        this._includeFilePaths = includeFilePaths;
        this._includeCache = includeCache;
        this._preprocIncInfo = { symbols: [], postTokens: [], tokenOrder: [], macroChanges: [], macroChangeOrder: [], includes: new Set() };
        this._macroInfo = macroInfo;
        this._tokenManager = new PreprocTokenManager(SystemVerilogPreprocessor.tokenize(preText));

        if (this._fileList.has(this._filePath)) {
            console.error(`include loop found`);
            return undefined;
        }
        else {
            this._fileList.add(this._filePath);
        }

        for (; this._tokenManager.tokensPending(); this._tokenManager.nextToken()) {
            while (this._processMacroCall()) {
            }

            if (this._processDefine() ||
                this._processNoArgDirectives() ||
                this._processSingleArgDirectives() ||
                this._processTimescaleDirective() ||
                this._processPragmaDirective() ||
                this._processLineDirective() ||
                this._processBeginKeywordsDirective() ||
                this._processConditionalDirectives() ||
                this._processIncludeDirective()) {
                continue;
            }
            else {
                if (this._tokenManager.getCurrToken().text.startsWith("`")) {
                    console.error(`Parsing failed for token ${this._tokenManager.getCurrToken().text} in file ${this._filePath}`);
                }
                this._preprocIncInfo.postTokens.push(this._tokenManager.getCurrPostToken());
            }
        }

        for (let [macroName, macroInfo] of this._macroInfo) {
            if (macroInfo.file == this._filePath) {
                this._preprocIncInfo.symbols.push(macroInfo.symbol);
            }
        }

        if (DEBUG_MODE == 2) {
            let postText: string = "";
            for (let token of this._getAllPostTokens(this._filePath, this._preprocIncInfo.postTokens, this._preprocIncInfo.tokenOrder)[0]) {
                //console.log(`DEBUG: token "${token.text}" at ${token.index} - ${token.endIndex}`);
                postText += token.text;
            }
            console.log(`DEBUG: New text (${preText.length}, ${postText.length})`);
            console.log(`${postText}`);

            for (let macro of this._macroInfo) {
                console.log(`DEBUG: macro=${macro[0]}`);
                if (macro[1].args != undefined) {
                    if (macro[1].args.size == 0) {
                        console.log(`    function with no args`);
                    }
                    else {
                        let args: string[] = Array.from(macro[1].args).sort((n1, n2) => { return n1[1] - n2[1]; }).map(arg => arg[0]);
                        for (let i: number = 0; i < args.length; i++) {
                            let defValue: string;
                            if (macro[1].default[i] == undefined) {
                                defValue = "none";
                            }
                            else if (macro[1].default[i].length == 0) {
                                defValue = "empty";
                            }
                            else {
                                defValue = "";
                                for (let token of macro[1].default[i]) {
                                    defValue += token.text;
                                }
                            }
                            console.log(`    arg=${args[i]}, default=${defValue}`);
                        }
                    }
                }
                else {
                    console.log(`    not a function`);
                }

                if (macro[1].definition.length == 0) {
                    console.log(`    empty replacement text`);
                }
                else {
                    let defText: string = "";
                    for (let token of macro[1].definition) {
                        defText += token.text;
                    }
                    console.log(`    - ${defText}`);
                }
            }
        }

        return this._preprocIncInfo;
    }

    private _getAllPostTokens(filePath: string, postTokens: PostToken[], tokenOrder: [string, number][]): [PostToken[], [string, number][]] {
        let allPostTokens: PostToken[] = [];
        let allTokenOrder: [string, number][] = [];
        let prevIndex: number = 0;
        for (let order of tokenOrder) {
            if (order[1] > prevIndex) {
                allTokenOrder.push([filePath, allPostTokens.length]);
                allPostTokens = allPostTokens.concat(postTokens.slice(prevIndex, order[1]));
            }
            let incInfo: PreprocIncInfo = this._includeCache.get(order[0])[1];
            let incPostTokensInfo: [PostToken[], [string, number][]] = this._getAllPostTokens(this._includeCache.get(order[0])[0], incInfo.postTokens, incInfo.tokenOrder);
            for (let incTokenOrder of incPostTokensInfo[1]) {
                allTokenOrder.push([incTokenOrder[0], allPostTokens.length + incTokenOrder[1]]);
            }
            allPostTokens = allPostTokens.concat(incPostTokensInfo[0]);
            prevIndex = order[1];
        }
        if (prevIndex < postTokens.length) {
            allTokenOrder.push([filePath, allPostTokens.length]);
            allPostTokens = allPostTokens.concat(postTokens.slice(prevIndex));
        }
        return [allPostTokens, allTokenOrder];
    }

    public parse(document: TextDocument, includeFilePaths: string[], includeCache: Map<string, [string, PreprocIncInfo, TextDocument]>, macroInfo: Map<string, MacroInfo>, text?: string): PreprocInfo {
        let preprocIncInfo: PreprocIncInfo = this._parseInc(document, includeFilePaths, includeCache, macroInfo, new Set(), text);
        let postTokensInfo: [PostToken[], [string, number][]] = this._getAllPostTokens(this._filePath, this._preprocIncInfo.postTokens, this._preprocIncInfo.tokenOrder);
        return {
            symbols: preprocIncInfo.symbols,
            postTokens: postTokensInfo[0],
            tokenOrder: postTokensInfo[1],
            includes: preprocIncInfo.includes
        };
    }

    private static macroInfoToJSON(macroInfo: MacroInfo): MacroInfoJSON {
        return [
            macroInfo.args == undefined ? undefined : Array.from(macroInfo.args.entries()),
            macroInfo.default,
            macroInfo.definition,
            macroInfo.symbol == undefined ? undefined : macroInfo.symbol.toJSON(),
            macroInfo.file
        ];
    }

    private static macroInfoFromJSON(macroInfoJSON: MacroInfoJSON): MacroInfo {
        return {
            args: macroInfoJSON[0] == undefined ? undefined : new Map(macroInfoJSON[0]),
            default: macroInfoJSON[1],
            definition: macroInfoJSON[2],
            symbol: macroInfoJSON[3] == undefined ? undefined : SystemVerilogSymbol.fromJSON(pathToUri(macroInfoJSON[4]), macroInfoJSON[3]),
            file: macroInfoJSON[4]
        };
    }

    public static preprocIncInfoToJSON(preprocIncInfo: PreprocIncInfo): PreprocIncInfoJSON {
        return [
            preprocIncInfo.symbols == undefined ? undefined : preprocIncInfo.symbols.map(s => s.toJSON()),
            preprocIncInfo.postTokens,
            preprocIncInfo.tokenOrder,
            preprocIncInfo.macroChanges == undefined ? undefined : preprocIncInfo.macroChanges.map(m => [m.action, m.macroName, SystemVerilogPreprocessor.macroInfoToJSON(m.macroInfo)]),
            preprocIncInfo.macroChangeOrder,
            preprocIncInfo.includes == undefined ? undefined : [...preprocIncInfo.includes]
        ];
    }

    public static preprocIncInfoFromJSON(fileUri: string, preprocIncInfoJSON: PreprocIncInfoJSON): PreprocIncInfo {
        return {
            symbols: preprocIncInfoJSON[0] == undefined ? undefined : preprocIncInfoJSON[0].map(s => SystemVerilogSymbol.fromJSON(fileUri, s)),
            postTokens: preprocIncInfoJSON[1],
            tokenOrder: preprocIncInfoJSON[2],
            macroChanges: preprocIncInfoJSON[3] == undefined ? undefined : preprocIncInfoJSON[3].map(m => { return {action: m[0], macroName: m[1], macroInfo: SystemVerilogPreprocessor.macroInfoFromJSON(m[2])}; }),
            macroChangeOrder: preprocIncInfoJSON[4],
            includes: preprocIncInfoJSON[5] == undefined ? undefined : new Set(preprocIncInfoJSON[5])
        };
    }
}
