import {
	TextDocument
} from 'vscode-languageserver-textdocument';

import {
    SystemVerilogSymbol
} from './svsymbol';

import {
    MacroInfo,
    PreprocIncInfo
} from './svpreprocessor';

import {
    SystemVerilogParser
} from './svparser';

import {
    ConnectionLogger,
    fsReadFile,
    pathToUri
} from './genutils';

let _parser: SystemVerilogParser = new SystemVerilogParser();

let _includeCache: Map<string, [string, PreprocIncInfo, TextDocument]> = new Map();
let _includeFilePaths: string[] = [];
let _userDefinesMacroInfo: Map<string, MacroInfo> = new Map();

process.on('message', (args) => {
    if (args[0] == 'exit') {
        process.exit();
    }
    else if (args[0] == 'config') {
        _includeFilePaths = args[1];
        if (args[2] != undefined) {
            _userDefinesMacroInfo = new Map(args[2].map(d => [d[0], { args: undefined, default: undefined, definition: d[1], symbol: undefined, file: "" }]));
        }
    }
    else if (args[0] == 'done') {
        let includeCache = SystemVerilogParser.includeCacheToJSON(_includeCache);
        process.send([includeCache, []]);
    }
    else {
        let file: string = args[1];
        fsReadFile(file).then((data) => {
            let document: TextDocument = TextDocument.create(pathToUri(file), "SystemVerilog", 0, data.toString());
            let fileSymbolsInfo: SystemVerilogParser.SystemVerilogFileSymbolsInfo[];
            let pkgdeps: string[];
            [fileSymbolsInfo, pkgdeps] = _parser.parse(document, _includeFilePaths, _includeCache, _userDefinesMacroInfo, "full");
            //DBG let symbols: SystemVerilogSymbol[] = SystemVerilogParser.fileAllSymbols(fileSymbolsInfo, false);
            //DBG ConnectionLogger.log(`DEBUG: Sending ${symbols.length} symbols and ${pkgdeps.length} pkgdeps for ${file}`);
            process.send([fileSymbolsInfo, pkgdeps]);
        })
        .catch((err) => {
            process.send([[], []]);
        });
    }
});
