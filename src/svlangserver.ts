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
    SignatureHelp,
    SymbolInformation,
    TextDocuments,
    TextDocumentPositionParams,
    TextDocumentSyncKind,
    WorkspaceSymbolParams
} from 'vscode-languageserver/node';

import {
    ApplyWorkspaceEditParams
} from 'vscode-languageserver-protocol/node';

import {
    TextDocumentEdit,
} from 'vscode-languageserver-types';

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
    VerilogDiagnostics
} from './diagnostics';

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
    SystemVerilogHierarchyCalculator
} from './svhier';

import {
    ConnectionLogger,
    isStringListEqual,
    uriToPath
} from './genutils';

import {
    default_settings
} from './svutils';

const BuildIndexCommand = "systemverilog.build_index"
const ReportHierarchyCommand = "systemverilog.report_hierarchy"

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
let connection = createConnection(ProposedFeatures.all);
ConnectionLogger.setConnection(connection);

// client capabilities
let clientName: string;
let hasConfigurationCapability: Boolean = false;
let hasShowWindowCapability: Boolean = false;

// Create a simple text document manager.
let documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);
let svindexer: SystemVerilogIndexer = new SystemVerilogIndexer();
let svdefprovider: SystemVerilogDefinitionProvider = new SystemVerilogDefinitionProvider(svindexer);
let diagnostics: VerilogDiagnostics = new VerilogDiagnostics(svindexer);
let svcompleter: SystemVerilogCompleter = new SystemVerilogCompleter(svindexer);
let svsignhelper: SystemVerilogSignatureHelpProvider = new SystemVerilogSignatureHelpProvider(svindexer);
let svformatter: SystemVerilogFormatter = new SystemVerilogFormatter();
let svhiercalculator: SystemVerilogHierarchyCalculator = new SystemVerilogHierarchyCalculator(svindexer);
let settings = default_settings;

connection.onInitialize((params: InitializeParams) => {
    hasConfigurationCapability = params.capabilities.workspace?.configuration == true;
    hasShowWindowCapability = params.capabilities.window?.showDocument?.support == true;
    clientName = params.clientInfo?.name;

    try {
        svindexer.setRoot(uriToPath(params.rootUri));
        if ((clientName.toLowerCase().startsWith("vscode")) ||
            (clientName.toLowerCase().startsWith("visual studio code"))) {
            svindexer.setClientDir(".vscode");
        }
        else if (clientName.toLowerCase().startsWith("coc.nvim")) {
            svindexer.setClientDir(".vim");
        }
        else if (clientName.toLowerCase().startsWith("sublime")) {
            svindexer.setClientDir(".sublime");
        }
        else if (clientName.toLowerCase().startsWith("emacs")) {
            svindexer.setClientDir(".emacs");
        }
        else {
            svindexer.setClientDir(".svlangserver");
        }
        diagnostics.setOptionsFile(svindexer.getLinterOptionsFile());
    } catch (error) {
        ConnectionLogger.error(error);
    }

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
                retriggerCharacters: [ ',' ] //TBD Not supported in CoC!
			},
            executeCommandProvider: {
                commands: [
                    BuildIndexCommand,
                    ReportHierarchyCommand,
                ]
            },
            documentFormattingProvider: true,
            documentRangeFormattingProvider: true,
        }
    };
    return result;
});

function getCurrentSettings(): Object {
    let currentSettings: Object = new Object();
    settings.forEach((val, prop) => { currentSettings[prop] = val; });
    return {settings: currentSettings};
}

function getSettings() : Promise<Object> {
    if (!hasConfigurationCapability) {
        return Promise.resolve(getCurrentSettings());
    }
    else if (clientName == "coc.nvim") {
        return connection.workspace.getConfiguration().then(svSettings => {
            let initSettings: Object = new Object();
            settings.forEach((val, prop) => {
                initSettings[prop] = svSettings[prop] == undefined ? settings[prop] : svSettings[prop];
            });
            return {settings: initSettings};
        }).catch(error => {
            ConnectionLogger.error(error);
            return getCurrentSettings();
        });
    }
    else {
        return connection.workspace.getConfiguration({section: 'systemverilog'}).then(svSettings => {
            let initSettings: Object = new Object();
            settings.forEach((val, prop) => {
                let nprop: string = prop.substring("systemverilog.".length);
                initSettings[prop] = svSettings[nprop] == undefined ? settings[prop] : svSettings[nprop];
            });
            return {settings: initSettings};
        }).catch(error => {
            ConnectionLogger.error(error);
            return getCurrentSettings();
        });
    }
}

let settingsInitialized: Boolean = false;
function updateSettings(change, updateIfNotInitialized: Boolean = false) {
    let oldSettings: Map<string, any> = new Map<string, any>();
    for (let [prop, val] of settings.entries()) {
        oldSettings.set(prop, val);
        if (change.settings[prop] == undefined) {
            let hierParts: string[] = prop.split(".");
            let newVal = change.settings;
            for (let i: number = 0; i < hierParts.length; i++) {
                newVal = newVal[hierParts[i]];
                if (newVal == undefined) {
                    break;
                }
            }
            settings.set(prop, newVal == undefined ? val : newVal);
        }
        else {
            settings.set(prop, change.settings[prop]);
        }
    }
    for (let [prop, val] of settings.entries()) {
        ConnectionLogger.log(`INFO: settings[${prop}] = ${settings.get(prop)}`);
    }

    let forceUpdate: Boolean = !settingsInitialized && updateIfNotInitialized;
    let definesChanged: Boolean = forceUpdate || !isStringListEqual(oldSettings.get("systemverilog.defines"), settings.get("systemverilog.defines"))
    if (forceUpdate || definesChanged ||
        !isStringListEqual(oldSettings.get("systemverilog.includeIndexing"), settings.get("systemverilog.includeIndexing")) ||
        !isStringListEqual(oldSettings.get("systemverilog.mustIncludeIndexing"), settings.get("systemverilog.mustIncludeIndexing")) ||
        !isStringListEqual(oldSettings.get("systemverilog.excludeIndexing"), settings.get("systemverilog.excludeIndexing"))) {
        if (definesChanged) {
            svindexer.setDefines(settings.get("systemverilog.defines"));
        }
        svindexer.index(settings.get("systemverilog.includeIndexing"), settings.get("systemverilog.mustIncludeIndexing"), settings.get("systemverilog.excludeIndexing"));
    }

    if (forceUpdate ||
        !isStringListEqual(oldSettings.get("systemverilog.libraryIndexing"), settings.get("systemverilog.libraryIndexing"))) {
        svindexer.setLibraries(settings.get("systemverilog.libraryIndexing"), settings.get("systemverilog.excludeIndexing"));
    }

    diagnostics.setLinter(settings.get("systemverilog.linter"));
    diagnostics.setCommand(settings.get("systemverilog.launchConfiguration"));
    diagnostics.setDefines(settings.get("systemverilog.defines"));
    diagnostics.setWhitelistedMessages(settings.get("systemverilog.linterWhitelist"));

    svformatter.setCommand(settings.get("systemverilog.formatCommand"));
    settingsInitialized = true;
}

connection.onInitialized(() => {
    try {
        getSettings()
            .then(initSettings => updateSettings(initSettings, true))
            .catch(error => {
                ConnectionLogger.error(error);
            });
    } catch (error) {
        ConnectionLogger.error(error);
    }
});

connection.onDidChangeConfiguration(change => {
    try {
        updateSettings(change);
    } catch (error) {
        ConnectionLogger.error(error);
    }
});

documents.onDidChangeContent(change => {
    try {
        svindexer.processDocumentChanges(change.document);
        if (settings.get("systemverilog.lintOnUnsaved")) {
            lintDocument(change.document.uri, change.document.getText());
        }
    } catch (error) {
        ConnectionLogger.error(error);
    }
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
    (_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
        try {
            if (settings.get("systemverilog.disableCompletionProvider")) {
                return [];
            }
            return svcompleter.completionItems(documents.get(_textDocumentPosition.textDocument.uri), _textDocumentPosition.position); //TBD try-catch
        } catch (error) {
            ConnectionLogger.error(error);
            return [];
        }
    }
);

connection.onCompletionResolve(
    (item: CompletionItem): CompletionItem => {
        return item;
    }
);

connection.onDocumentSymbol((documentSymbolParams: DocumentSymbolParams): Promise<SymbolInformation[]> => {
    try {
        return svindexer.getDocumentSymbols(documents.get(documentSymbolParams.textDocument.uri));
    } catch (error) {
        ConnectionLogger.error(error);
        return Promise.resolve([]);
    }
});

connection.onWorkspaceSymbol((workspaceSymbolParams: WorkspaceSymbolParams): Promise<SymbolInformation[]> => {
    try {
        return svindexer.getWorkspaceSymbols(workspaceSymbolParams.query);
    } catch (error) {
        ConnectionLogger.error(error);
        return Promise.resolve([]);
    }
});

connection.onDefinition((textDocumentPosition: TextDocumentPositionParams): Promise<Location[]> => {
    try {
        return svdefprovider.getDefinitionSymbolLocation(documents.get(textDocumentPosition.textDocument.uri), textDocumentPosition.position);
    } catch (error) {
        ConnectionLogger.error(error);
        return Promise.resolve([]);
    }
});

connection.onHover((hoverParams: HoverParams): Promise<Hover> => {
    try {
        if (settings.get("systemverilog.disableHoverProvider")) {
            return Promise.resolve(undefined);
        }

        let defText: [string, string[]] = svdefprovider.getDefinitionText(documents.get(hoverParams.textDocument.uri), hoverParams.position);
        if ((defText[0] == undefined) || (defText[1] == undefined)) {
            return Promise.resolve(undefined);
        }

        return Promise.resolve({
            contents: {
                kind: MarkupKind.Markdown,
                value: (defText[0].length > 0 ? [`*${defText[0]}*`] : []).concat([(clientName == "coc.nvim") ? "```systemverilog" : "```"]).concat(defText[1]).concat(["```"]).join('\n'),
            },
        });
    } catch (error) {
        ConnectionLogger.error(error);
        return Promise.resolve(undefined);
    }
});

function lintDocument(uri: string, text?: string) {
    if (settings.get("systemverilog.disableLinting")) {
        return;
    }
    diagnostics.lint(uriToPath(uri), text)
        .then((diagnostics) => {
            connection.sendDiagnostics({ uri: uri, diagnostics });
        })
        .catch((error) => {
            ConnectionLogger.error(error);
        });
}

documents.onDidOpen((event) => {
    try {
        svindexer.indexOpenDocument(event.document);
        lintDocument(event.document.uri);
    } catch (error) {
        ConnectionLogger.error(error);
    }
});

documents.onDidSave((event) => {
    try {
        svindexer.indexOpenDocument(event.document);
        svindexer.updateFileInfoOnSave(event.document);
        lintDocument(event.document.uri);
    } catch (error) {
        ConnectionLogger.error(error);
    }
});

connection.onSignatureHelp((textDocumentPosition: TextDocumentPositionParams): SignatureHelp => {
    try {
        if (settings.get("systemverilog.disableSignatureHelpProvider")) {
            return undefined;
        }
        return svsignhelper.getSignatures(documents.get(textDocumentPosition.textDocument.uri), textDocumentPosition.position.line, textDocumentPosition.position.character);
    } catch (error) {
        ConnectionLogger.error(error);
        return undefined;
    }
});

connection.onExecuteCommand((commandParams) => {
    try {
        if (commandParams.command == BuildIndexCommand) {
            svindexer.index(settings.get("systemverilog.includeIndexing"), settings.get("systemverilog.mustIncludeIndexing"), settings.get("systemverilog.excludeIndexing"));
        }
        else if (commandParams.command == ReportHierarchyCommand) {
            if ((commandParams.arguments == undefined) || (commandParams.arguments.length != 1)) {
                ConnectionLogger.error(`${ReportHierarchyCommand} needs the module/interface name as an argument`);
                return;
            }

            const fileUri: string = svhiercalculator.calcHier(commandParams.arguments[0]);
            ConnectionLogger.log(`Hierarchy for ${commandParams.arguments[0]} available at ${fileUri}`);
            if (hasShowWindowCapability) {
                connection.sendRequest("window/showDocument", {uri: fileUri, takeFocus: true});
            }
            else {
                const editParams: ApplyWorkspaceEditParams = {
                    label: "Hierarchy",
                    edit: {
                        documentChanges: [
                            TextDocumentEdit.create({uri: fileUri, version: null}, []),
                        ]
                    }
                };
                connection.sendRequest("workspace/applyEdit", editParams);
            }
        }
        else {
            ConnectionLogger.error(`Unhandled command ${commandParams.command}`);
        }
    } catch (error) {
        ConnectionLogger.error(error);
    }
});

connection.onDocumentFormatting((formatParams) => {
    try {
        return svformatter.format(documents.get(formatParams.textDocument.uri), null, formatParams.options);
    } catch (error) {
        ConnectionLogger.error(error);
        return Promise.resolve([]);
    }
});

connection.onDocumentRangeFormatting((rangeFormatParams) => {
    try {
        return svformatter.format(documents.get(rangeFormatParams.textDocument.uri), rangeFormatParams.range, rangeFormatParams.options);
    } catch (error) {
        ConnectionLogger.error(error);
        return Promise.resolve([]);
    }
});

connection.onShutdown((token) => {
    diagnostics.cleanupTmpFiles();
    svindexer.saveIndexOnExit();
});

// Save index on exit
connection.onExit(() => {
    diagnostics.cleanupTmpFiles();
    svindexer.saveIndexOnExit();
});

process.on('exit', () => {
    diagnostics.cleanupTmpFiles();
    svindexer.saveIndexOnExit();
});

process.on('SIGTERM', () => {
    diagnostics.cleanupTmpFiles();
    svindexer.saveIndexOnExit();
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
