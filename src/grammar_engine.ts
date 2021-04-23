import {
    ConnectionLogger
} from './genutils';

enum TokenRegExpPatternActionType {
    None,
    Push,
    Pop,
    PushScopes,
    PopScopes
}

enum StateActionType {
    None,
    Save,
    Restore,
    Delete
}

interface TokenRegExpPatternAction {
    kind: TokenRegExpPatternActionType;
}

class TokenRegExpPatternActionNone implements TokenRegExpPatternAction {
    kind: TokenRegExpPatternActionType;

    constructor() {
        this.kind = TokenRegExpPatternActionType.None;
    }
}

class TokenRegExpPatternActionPush implements TokenRegExpPatternAction {
    kind: TokenRegExpPatternActionType;
    context: Context;

    constructor(context: Context) {
        this.kind = TokenRegExpPatternActionType.Push;
        this.context = context;
    }
}

class TokenRegExpPatternActionPop implements TokenRegExpPatternAction {
    kind: TokenRegExpPatternActionType;
    context: Context | null;

    constructor(context?: Context) {
        this.kind = TokenRegExpPatternActionType.Pop;
        this.context = (context == undefined) ? null : context;
    }
}

class TokenRegExpPatternActionPushScopes implements TokenRegExpPatternAction {
    kind: TokenRegExpPatternActionType;
    scopes: string[];

    constructor(scopes: string[]) {
        this.kind = TokenRegExpPatternActionType.PushScopes;
        this.scopes = scopes;
    }
}

class TokenRegExpPatternActionPopScopes implements TokenRegExpPatternAction {
    kind: TokenRegExpPatternActionType;
    scopes: string[];

    constructor(scopes: string[]) {
        this.kind = TokenRegExpPatternActionType.PopScopes;
        this.scopes = scopes;
    }
}

class TokenRegExpPattern {
    regExp: RegExp;
    tokenNames: string[];
    action: TokenRegExpPatternAction;
    stateAction: StateActionType;

    constructor(regExp: string, tokenNames: string[], action?: TokenRegExpPatternAction, stateAction?: StateActionType) {
        this.regExp = new RegExp(regExp, 'y');
        this.tokenNames = [];
        this.tokenNames = this.tokenNames.concat(tokenNames);
        this.action = (action == undefined) ? new TokenRegExpPatternActionNone : action;
        this.stateAction = (stateAction == undefined) ? StateActionType.None : stateAction;
    }
}

class Context {
    scopeName: string;
    patterns: Array<Context|TokenRegExpPattern>;

    constructor(scopeName: string, patterns?: TokenRegExpPattern[]) {
        this.scopeName = scopeName;
        this.patterns = [];
        if (patterns) {
            this.patterns = this.patterns.concat(patterns);
        }
    }

    add(patterns: TokenRegExpPattern[]) {
        this.patterns = this.patterns.concat(patterns);
    }

    include(contexts: Context[]) {
        this.patterns = this.patterns.concat(contexts);
    }
}

function getContextPatterns(contexts: Context[]): Map<Context, TokenRegExpPattern[]> {
    let result: Map<Context, TokenRegExpPattern[]> = new Map();
    for (let context of contexts) {
        if (result.has(context)) {
            continue;
        }
        result.set(context, []);
        let patterns: TokenRegExpPattern[] = [];
        for (let pattern of context.patterns) {
            if (pattern instanceof TokenRegExpPattern) {
                patterns.push(pattern);
            }
            else if (pattern instanceof Context) {
                let sresult = getContextPatterns([pattern]);
                sresult.forEach((value, key) => {
                    result.set(key, value);
                });
                patterns = patterns.concat(sresult.get(pattern));
            }
            else {
                ConnectionLogger.error("Unsupported pattern");
            }
        }
        result.set(context, patterns);
    }
    return result;
}

function loadGrammar(grammar): Map<string, Context> | null {
    let contexts: Map<string, Context> = new Map();
    let anonContextCount: number = 0;

    for (let [contextName, context] of Object.entries(grammar)) {
        contexts.set(contextName, new Context(context["scopeName"] || ""));
    }

    for (let [contextName, context] of Object.entries(grammar)) {
        _processContext(contextName, context);
    }

    return contexts;

    function _processContext(contextName, context) {
        for (let pattern of context["patterns"]) {
            let stateAction: StateActionType;
            if (pattern.saveState) {
                stateAction = StateActionType.Save;
            }
            else if (pattern.restoreState) {
                stateAction = StateActionType.Restore;
            }
            else if (pattern.deleteState) {
                stateAction = StateActionType.Delete;
            }
            else {
                stateAction = StateActionType.None;
            }

            if (pattern.match != undefined) {
                if (pattern.push != undefined) {
                    let actionContext: Context;
                    if (typeof pattern.push === "string" || pattern.push instanceof String) {
                        if (!contexts.has(pattern.push)) {
                            ConnectionLogger.error(`${pattern.push} is not a valid context`);
                            return null;
                        }
                        actionContext = contexts.get(pattern.push);
                    }
                    else {
                        anonContextCount++;
                        let anonContext: Context = new Context(pattern.push.scopeName || "");
                        let anonContextName: string = "&AnonContext" + anonContextCount.toString();
                        contexts.set(anonContextName, anonContext);
                        _processContext(anonContextName, pattern.push);
                        actionContext = anonContext;
                    }
                    contexts.get(contextName).add([new TokenRegExpPattern(pattern.match, pattern.tokens, new TokenRegExpPatternActionPush(actionContext), stateAction)]);
                }
                else if (pattern.pop != undefined) {
                    let actionContext: Context = undefined;
                    if (typeof pattern.pop === "string" || pattern.pop instanceof String) {
                        if (pattern.pop) {
                            if (!contexts.has(pattern.pop)) {
                                ConnectionLogger.error(`${pattern.pop} is not a valid context`);
                                return null;
                            }
                            actionContext = contexts.get(pattern.pop);
                        }
                    }
                    else {
                        anonContextCount++;
                        let anonContext: Context = new Context(pattern.pop.scopeName || "");
                        let anonContextName: string = "&AnonContext" + anonContextCount.toString();
                        contexts.set(anonContextName, anonContext);
                        _processContext(anonContextName, pattern.pop);
                        actionContext = anonContext;
                    }
                    contexts.get(contextName).add([new TokenRegExpPattern(pattern.match, pattern.tokens, new TokenRegExpPatternActionPop(actionContext), stateAction)]);
                }
                else if (pattern.pushScopes != undefined) {
                    contexts.get(contextName).add([new TokenRegExpPattern(pattern.match, pattern.tokens, new TokenRegExpPatternActionPushScopes(pattern.pushScopes), stateAction)]);
                }
                else if (pattern.popScopes != undefined) {
                    contexts.get(contextName).add([new TokenRegExpPattern(pattern.match, pattern.tokens, new TokenRegExpPatternActionPopScopes(pattern.popScopes), stateAction)]);
                }
                else {
                    contexts.get(contextName).add([new TokenRegExpPattern(pattern.match, pattern.tokens, undefined, stateAction)]);
                }
            }
            else if (pattern.include != undefined) {
                if (!contexts.has(pattern.include)) {
                    ConnectionLogger.error(`${pattern.include} is not a valid context`);
                    return null;
                }
                contexts.get(contextName).include([contexts.get(pattern.include)]);
            }
            else {
                ConnectionLogger.error("Invalid grammar pattern found");
                return null;
            }
        }
    }
}

export class GrammarToken {
    text: string;
    index: number;
    scopes: string[];
}

export class GrammarEngine {
    private _contextMap: Map<string, Context>;
    private _contextPatterns: Map<Context, TokenRegExpPattern[]>;
    private _invalidTokenScope: string;

    public constructor(grammar, invalidTokenScope: string) {
        this._contextMap = loadGrammar(grammar);
        this._contextPatterns = getContextPatterns([...this._contextMap.values()]);
        this._invalidTokenScope = invalidTokenScope
    }

    public tokenize(text: string, initScopeStack?: string[]): GrammarToken[] {
        type State = [Context[], string[]];
        let result: GrammarToken[] = [];
        let lastIndex: number = 0;
        let mainContext = this._contextMap.get("Main");
        let contextStack: Context[] = [mainContext];
        let scopeStack: string[] = (initScopeStack == undefined) ? [mainContext.scopeName] : initScopeStack;
        let stateStack: State[] = [];
        let currInvalidToken: string = "";
        let currInvalidTokenIndex = 0;
        while (lastIndex < text.length) {
            let prevLastIndex = lastIndex;
            for (let pattern of this._contextPatterns.get(contextStack[contextStack.length - 1])) {
                pattern.regExp.lastIndex = lastIndex;
                let match = pattern.regExp.exec(text);
                if (match) {
                    if (match[0].length == 0) {
                        ConnectionLogger.error(`Empty length pattern found. Pattern - ${pattern.regExp}`);
                        return [];
                    }
                    else if (pattern.tokenNames.length + 1 != match.length) {
                        ConnectionLogger.error(`Pattern token-names length different than captures. Pattern - ${pattern.regExp}, token-name=${pattern.tokenNames.join(", ")}`);
                        return [];
                    }

                    let offset:number = 0;
                    for (let i = 1; i < match.length; i++) {
                        if (match[i] && match[i].length > 0) {
                            offset += match[i].length;
                        }
                    }
                    if (offset != match[0].length) {
                        ConnectionLogger.error(`captures don't add up. Complete match - ${match[0]}, captures - "${match.slice(1).join('" ')}"`);
                        return [];
                    }

                    if (currInvalidToken) {
                        result.push({text: currInvalidToken, index: currInvalidTokenIndex, scopes: scopeStack.concat([this._invalidTokenScope])});
                    }
                    currInvalidToken = "";

                    offset = 0;
                    for (let i = 1; i < match.length; i++) {
                        if (match[i] && match[i].length > 0) {
                            result.push({text: match[i], index: match.index + offset, scopes: scopeStack.concat([pattern.tokenNames[i-1]])});
                            offset += match[i].length;
                        }
                    }

                    if (pattern.stateAction == StateActionType.Save) {
                        stateStack.push([[...contextStack], [...scopeStack]]);
                    }
                    else if (pattern.stateAction == StateActionType.Restore) {
                        contextStack = [...stateStack[stateStack.length - 1][0]];
                        scopeStack = [...stateStack[stateStack.length - 1][1]];
                    }
                    else if (pattern.stateAction == StateActionType.Delete) {
                        stateStack.pop();
                    }

                    if (pattern.action.kind == TokenRegExpPatternActionType.Push) {
                        let context: Context = (<TokenRegExpPatternActionPush>(pattern.action)).context;
                        contextStack.push(context);
                        if (context.scopeName) {
                            scopeStack.push(context.scopeName);
                        }
                    }
                    else if (pattern.action.kind == TokenRegExpPatternActionType.Pop) {
                        let poppedContext = contextStack.pop();
                        if (poppedContext.scopeName) {
                            scopeStack.pop();
                        }
                        let context: Context = (<TokenRegExpPatternActionPop>(pattern.action)).context;
                        if (context) {
                            contextStack.push(context);
                            if (context.scopeName) {
                                scopeStack.push(context.scopeName);
                            }
                        }
                    }
                    else if (pattern.action.kind == TokenRegExpPatternActionType.PushScopes) {
                        scopeStack = scopeStack.concat((<TokenRegExpPatternActionPushScopes>(pattern.action)).scopes);
                    }
                    else if (pattern.action.kind == TokenRegExpPatternActionType.PopScopes) {
                        for (let scope of (<TokenRegExpPatternActionPopScopes>(pattern.action)).scopes) {
                            let poppedScope: string = "";
                            while ((poppedScope != scope) && (scopeStack.length > 0)) {
                                poppedScope = scopeStack.pop();
                            }
                        }
                    }

                    lastIndex = pattern.regExp.lastIndex;
                    break;
                }
            }
            if (lastIndex == prevLastIndex) {
                if (!currInvalidToken) {
                    currInvalidTokenIndex = lastIndex;
                }
                currInvalidToken += text[lastIndex];
                lastIndex++;
            }
        }

        if (currInvalidToken != "") {
            result.push({text: currInvalidToken, index: currInvalidTokenIndex, scopes: scopeStack.concat([this._invalidTokenScope])});
        }

        return result;
    }
}

export function r(strings) {
    return strings.raw[0];
}
