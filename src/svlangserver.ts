/* --------------------------------------------------------------------------------------------
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
    createConnection,
    CompletionItem,
    DocumentSymbolParams,
    Hover,
    HoverParams,
    InitializeParams,
    InitializeResult,
    Location,
    MarkupKind,
    ProposedFeatures,
    Range,
    SignatureHelp,
    SymbolInformation,
    TextDocuments,
    TextDocumentPositionParams,
    TextDocumentSyncKind,
    WorkspaceSymbolParams
} from 'vscode-languageserver';

import {
    TextDocument
} from 'vscode-languageserver-textdocument';

import {
    SystemVerilogIndexer
} from './svindexer';

import {
    SystemVerilogDefinitionProvider
} from './svdefprovider';

import {
    VerilatorDiagnostics
} from './verilator';

import {
    SystemVerilogCompleter
} from './svcompleter';

import {
    SystemVerilogSignatureHelpProvider
} from './svsignhelpprovider';

import {
    SystemVerilogFormatter
} from './svformatter';

import {
    fsReadFile,
    isStringListEqual,
    uriToPath
} from './genutils';

import {
    default_settings
} from './svutils';

const BuildIndexCommand = "systemverilog.build_index"

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
let connection = createConnection(ProposedFeatures.all);

// client capabilities
let clientName: string;
let hasConfigurationCapability: Boolean = false;

// Create a simple text document manager.
let documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);
let svindexer: SystemVerilogIndexer = new SystemVerilogIndexer();
let svdefprovider: SystemVerilogDefinitionProvider = new SystemVerilogDefinitionProvider(svindexer);
let verilator: VerilatorDiagnostics = new VerilatorDiagnostics();
let svcompleter: SystemVerilogCompleter = new SystemVerilogCompleter(svindexer);
let svsignhelper: SystemVerilogSignatureHelpProvider = new SystemVerilogSignatureHelpProvider(svindexer);
let svformatter: SystemVerilogFormatter = new SystemVerilogFormatter();
let settings = default_settings;

connection.onInitialize((params: InitializeParams) => {
    hasConfigurationCapability = !!(params.capabilities.workspace && !!params.capabilities.workspace.configuration);
    clientName = !!params.clientInfo ? params.clientInfo.name : undefined;

    svindexer.setRoot(uriToPath(params.rootUri));
    if (clientName  == "vscode") {
        svindexer.setClientDir(".vscode");
    }
    else {
        svindexer.setClientDir(".vim");
    }
    verilator.setOptionsFile(svindexer.getVerilatorOptionsFile());

    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            // Tell the client that this server supports code completion.
            completionProvider: {
                resolveProvider: true
            },
            documentSymbolProvider: true,
            workspaceSymbolProvider: true,
            definitionProvider: true,
            hoverProvider: true,
            signatureHelpProvider: {
				triggerCharacters: [ '(', '[', ',' ],
                retriggerCharacters: [ ',' ] //TBD Not supported in Coc!
			},
            executeCommandProvider: {
                commands: [
                    BuildIndexCommand,
                ]
            },
            documentFormattingProvider: true,
            documentRangeFormattingProvider: true,
        }
    };
    return result;
});

function getSettings() : Promise<Object> {
    if (!hasConfigurationCapability) {
        let initSettings: Object = new Object();
        settings.forEach((val, prop) => { initSettings[prop] = val; });
        return Promise.resolve({settings: initSettings});
    }
    else if (clientName == "vscode") {
        return connection.workspace.getConfiguration({section: 'systemverilog'}).then(svSettings => {
            let initSettings: Object = new Object();
            settings.forEach((val, prop) => {
                let nprop: string = prop.substring("systemverilog.".length);
                initSettings[prop] = !!svSettings[nprop] ? svSettings[nprop] : settings[prop];
            });
            return {settings: initSettings};
        });
    }
    else {
        return connection.workspace.getConfiguration().then(svSettings => {
            let initSettings: Object = new Object();
            settings.forEach((val, prop) => {
                initSettings[prop] = !!svSettings[prop] ? svSettings[prop] : settings[prop];
            });
            return {settings: initSettings};
        });
    }
}

function updateSettings(change, forceUpdate: Boolean = false) {
    let oldSettings: Map<string, any> = new Map<string, any>();
    for (let [prop, val] of settings.entries()) {
        oldSettings.set(prop, val);
        settings.set(prop, change.settings[prop] == undefined ? val : change.settings[prop]);
    }
    for (let [prop, val] of settings.entries()) {
        console.log(`INFO: settings[${prop}] = ${settings.get(prop)}`);
    }

    let definesChanged: Boolean = forceUpdate || !isStringListEqual(oldSettings.get("systemverilog.defines"), settings.get("systemverilog.defines"))
    if (forceUpdate || definesChanged ||
        !isStringListEqual(oldSettings.get("systemverilog.includeIndexing"), settings.get("systemverilog.includeIndexing")) ||
        !isStringListEqual(oldSettings.get("systemverilog.excludeIndexing"), settings.get("systemverilog.excludeIndexing"))) {
        if (definesChanged) {
            svindexer.setDefines(settings.get("systemverilog.defines"));
        }
        svindexer.index(settings.get("systemverilog.includeIndexing"), settings.get("systemverilog.excludeIndexing"));
    }

    verilator.setCommand(settings.get("systemverilog.launchConfiguration"));
    verilator.setDefines(settings.get("systemverilog.defines"));
    svformatter.setCommand(settings.get("systemverilog.formatCommand"));
}

connection.onInitialized(() => {
    getSettings().then(initSettings => updateSettings(initSettings, true));
});

connection.onDidChangeConfiguration(change => {
    updateSettings(change);
});

function isValidExtension(uri: string): Boolean {
    return (uri.endsWith(".sv") || uri.endsWith(".svh"));
}

documents.onDidChangeContent(change => {
    if (!isValidExtension(change.document.uri)) {
        return;
    }
    svindexer.processDocumentChanges(change.document);
    if (settings.get("systemverilog.lintOnUnsaved")) {
        lintDocument(change.document.uri, change.document.getText());
    }
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
    (_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
        if (!isValidExtension(_textDocumentPosition.textDocument.uri)) {
            return [];
        }
        return svcompleter.completionItems(documents.get(_textDocumentPosition.textDocument.uri), _textDocumentPosition.position);
    }
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
    (item: CompletionItem): CompletionItem => {
        if (item.data === 1) {
            item.detail = 'TypeScript details';
            item.documentation = 'TypeScript documentation';
        } else if (item.data === 2) {
            item.detail = 'JavaScript details';
            item.documentation = 'JavaScript documentation';
        }
        return item;
    }
);

connection.onDocumentSymbol((documentSymbolParams: DocumentSymbolParams): Promise<SymbolInformation[]> => {
    if (!isValidExtension(documentSymbolParams.textDocument.uri)) {
        return Promise.resolve([]);
    }
    return svindexer.getDocumentSymbols(documents.get(documentSymbolParams.textDocument.uri));
});

connection.onWorkspaceSymbol((workspaceSymbolParams: WorkspaceSymbolParams): Promise<SymbolInformation[]> => {
    return svindexer.getWorkspaceSymbols(workspaceSymbolParams.query);
});

connection.onDefinition((textDocumentPosition: TextDocumentPositionParams): Promise<Location[]> => {
    if (!isValidExtension(textDocumentPosition.textDocument.uri)) {
        return Promise.resolve([]);
    }
    return svdefprovider.getDefinitionSymbolLocation(documents.get(textDocumentPosition.textDocument.uri), textDocumentPosition.position);
});

connection.onHover((hoverParams: HoverParams): Promise<Hover> => {
    if (!isValidExtension(hoverParams.textDocument.uri)) {
        return undefined;
    }

    let defText: string = svdefprovider.getDefinitionText(documents.get(hoverParams.textDocument.uri), hoverParams.position);
    if (defText == undefined) {
        return Promise.resolve(undefined);
    }

    return Promise.resolve({
        contents: {
            kind: MarkupKind.Markdown,
            value: ["```"].concat(defText.split(/\r?\n/).map(s => "    " + s.trim())).concat(["```"]).join('\n'),
        },
    });
});

function lintDocument(uri: string, text?: string) {
    verilator.lint(uriToPath(uri), text)
        .then((diagnostics) => {
            connection.sendDiagnostics({ uri: uri, diagnostics });
        });
}

documents.onDidOpen((event) => {
    if (!isValidExtension(event.document.uri)) {
        return;
    }
    svindexer.indexOpenDocument(event.document);
    lintDocument(event.document.uri);
});

documents.onDidSave((event) => {
    if (!isValidExtension(event.document.uri)) {
        return;
    }
    svindexer.indexOpenDocument(event.document);
    svindexer.updateFileInfoOnSave(event.document);
    lintDocument(event.document.uri);
});

connection.onSignatureHelp((textDocumentPosition: TextDocumentPositionParams): SignatureHelp => {
    return svsignhelper.getSignatures(documents.get(textDocumentPosition.textDocument.uri), textDocumentPosition.position.line, textDocumentPosition.position.character);
});

connection.onExecuteCommand((commandParams) => {
    if (commandParams.command == BuildIndexCommand) {
        svindexer.index(settings.get("systemverilog.includeIndexing"), settings.get("systemverilog.excludeIndexing"));
    }
    else {
        console.error(`Unhandled command ${commandParams.command}`);
    }
});

connection.onDocumentFormatting((formatParams) => {
    return svformatter.format(documents.get(formatParams.textDocument.uri), null, formatParams.options);
});

connection.onDocumentRangeFormatting((rangeFormatParams) => {
    return svformatter.format(documents.get(rangeFormatParams.textDocument.uri), rangeFormatParams.range, rangeFormatParams.options);
});

connection.onShutdown((token) => {
    verilator.cleanupTmpFiles();
    svindexer.saveIndexOnExit();
});

// Save index on exit
connection.onExit(() => {
    verilator.cleanupTmpFiles();
    svindexer.saveIndexOnExit();
});

process.on('exit', () => {
    verilator.cleanupTmpFiles();
    svindexer.saveIndexOnExit();
});

process.on('SIGTERM', () => {
    verilator.cleanupTmpFiles();
    svindexer.saveIndexOnExit();
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
