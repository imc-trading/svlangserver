import { commands, DocumentSelector, ExtensionContext, window, workspace } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';
import { default_settings } from './svutils';
import * as path from 'path';

const selector: DocumentSelector = [
    { scheme: 'file', language: 'systemverilog' },
    { scheme: 'file', language: 'verilog' }
];

let client: LanguageClient;
let settings: Map<string, any> = default_settings;

// Below implements coc.nvim style of sending settings
function getSettings(client) {
    let newSettings: Object = new Object();
    let workspaceConfig = workspace.getConfiguration();
    for (let [prop, val] of settings) {
        let newVal = workspaceConfig.get(prop);
        if (newVal != val) {
            newSettings[prop] = newVal;
            settings.set(prop, newVal);
        }
    }
    return { settings: newSettings };
}

export function activate(context: ExtensionContext) {
    let serverModule = context.asAbsolutePath(path.join('dist', 'svlangserver.js'));

    let serverOptions: ServerOptions = {
        run: {module: serverModule, transport: TransportKind.ipc},
        debug: {module: serverModule, transport: TransportKind.ipc}
    }

    let clientOptions: LanguageClientOptions = {
        outputChannelName: "SVLangServer",
        documentSelector: selector as string[]
    }

    client = new LanguageClient('systemverilog', "svlangserver LSP", serverOptions, clientOptions);

    // For debugging only
    //client.trace = Trace.Verbose;

    let getHierCmdHandler = () => {
        let selectedText: string;
        let editor = window.activeTextEditor;
        if (!!editor) {
            selectedText = editor.document.getText(editor.selection);
        }

        window.showInputBox({
            placeHolder: "Module/interface Name",
            prompt: "Hierarchy to be reported for module/interface",
            value: selectedText
        }).then((cntnrName: string) => {
            if (!!cntnrName) {
                client.sendRequest('workspace/executeCommand', {'command': 'systemverilog.report_hierarchy', 'arguments': [cntnrName]});
            }
        });
    };

    context.subscriptions.push(commands.registerCommand('systemverilog.get_hierarchy', getHierCmdHandler));
    context.subscriptions.push(client.start());

    client.onReady().then(() => {
        workspace.onDidChangeConfiguration(() => {
            client.sendNotification('workspace/didChangeConfiguration', getSettings(client));
        });
    });
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}
