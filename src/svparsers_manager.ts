import {
    ConnectionLogger,
    resolvedPath
} from './genutils';

import {
    SyntaxNode,
    TreeCursor
} from 'web-tree-sitter';

let treeSitterParser = require('web-tree-sitter');

export let svIdentifiersParser: any = null; //TBD
export let svIndexParser: any = null;
type InitCallbackT = { resolve: () => void, reject: () => void };
export let svIndexParserInitSubscribers: InitCallbackT[] = [];

export function init() {
    setTimeout(() => {
        if (svIndexParser == null) {
            ConnectionLogger.error(`It took too long to initialize index parser. Something is wrong`);
            svIndexParserInitSubscribers.forEach(initCallback => initCallback.reject());
        }
    }, 5000);

    treeSitterParser.init().then(() => {
        return treeSitterParser.Language.load(resolvedPath('../parsers/svindex/tree-sitter-svindex.wasm'));
    }).then((svIndexGrammar: any) => {
        svIndexParser = new treeSitterParser();
        svIndexParser.setLanguage(svIndexGrammar);
        svIndexParserInitSubscribers.forEach(initCallback => initCallback.resolve());
    }).catch((err: any) => {
        ConnectionLogger.error(err);
    });
}

export function visitAllNodes(treeCursor: TreeCursor, callBack: (synNode: SyntaxNode) => void): void {
    if (treeCursor.gotoFirstChild()) {
        do {
            callBack(treeCursor.currentNode());
            visitLeafNodes(treeCursor, callBack);
        } while(treeCursor.gotoNextSibling());
        treeCursor.gotoParent();
    }
}

export function visitLeafNodes(treeCursor: TreeCursor, callBack: (synNode: SyntaxNode) => void): void {
    if (treeCursor.gotoFirstChild()) {
        do {
            visitLeafNodes(treeCursor, callBack);
        } while(treeCursor.gotoNextSibling());
        treeCursor.gotoParent();
    }
    else {
        callBack(treeCursor.currentNode());
    }
}
