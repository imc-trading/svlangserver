import {
    CompletionItem,
    CompletionItemKind,
    Position
} from 'vscode-languageserver';

import {
    TextDocument
} from 'vscode-languageserver-textdocument';

import {
    SystemVerilogIndexer
} from './svindexer';

import {
    SystemVerilogParser
} from './svparser';

import {
    SystemVerilogSymbol
} from './svsymbol';

import {
    GrammarToken,
} from './grammar_engine';

import {
    ConnectionLogger
} from './genutils';

const sv_completion_systemtask: string[][] = [
    // Messaging
    ["display"       ,"$display()",        "display(\"$0\",);"           ],
    ["monitor"       ,"$monitor()",        "monitor(\"$0\",);"           ],
    ["monitoron"     ,"$monitoron",        "monitoron;"                  ],
    ["monitoroff"    ,"$monitoroff",       "monitoroff;"                 ],
    ["sformatf"      ,"$sformatf()",       "sformatf(\"$0\",)"           ],
    ["testplusargs"  ,"$test$plusargs()",  "test\\$plusargs(\"$0\")"     ],
    ["valueplusargs" ,"$value$plusargs()", "value\\$plusargs(\"$1\",$2)" ],
    ["finish"        ,"$finish",           "finish;"                     ],
    // variable
    ["time"          ,"$time",             "time()"                      ],
    ["realtime"      ,"$realtime()",       "realtime()"                  ],
    ["random"        ,"$random()",         "random()"                    ],
    ["urandom_range" ,"$urandom_range()",  "urandom_range($1,$2)"        ],
    // cast
    ["cast"          ,"$cast()",           "cast($0)"                    ],
    ["unsigned"      ,"$unsigned()",       "unsigned($0)"                ],
    ["signed"        ,"$signed()",         "signed($0)"                  ],
    ["itor"          ,"$itor()",           "itor($0)"                    ],
    ["rtoi"          ,"$rtoi()",           "rtoi($0)"                    ],
    ["bitstoreal"    ,"$bitstoreal()",     "bitstoreal($0)"              ],
    ["realtobits"    ,"$realtobits()",     "realtobits($0)"              ],
    // assertion
    ["assertoff"     ,"$assertoff()",      "assertoff($0,)"              ],
    ["info"          ,"$info()",           "info(\"$0\");"               ],
    ["error"         ,"$error()",          "error(\"$0\");"              ],
    ["warning"       ,"$warning()",        "warning(\"$0\");"            ],
    ["stable"        ,"$stable()",         "stable($0)"                  ],
    ["fell"          ,"$fell()",           "fell($0)"                    ],
    ["rose"          ,"$rose()",           "rose($0)"                    ],
    ["past"          ,"$past()",           "past($0)"                    ],
    ["isunknown"     ,"$isunknown()",      "isunknown($0)"               ],
    ["onehot"        ,"$onehot()",         "onehot($0)"                  ],
    ["onehot0"       ,"$onehot0()",        "onehot0($0)"                 ],
    // utility
    ["size"          ,"$size()",           "size($0)"                    ],
    ["countones"     ,"$countones()",      "countones($0)"               ],
    ["high"          ,"$high()",           "high($0)"                    ],
    ["low"           ,"$low()",            "low($0)"                     ],
    // math
    ["clog2"         ,"$clog2()",          "clog2($0)"                   ],
    ["log"           ,"$log()",            "ln($0)"                      ],
    ["log10"         ,"$log10()",          "log10($0)"                   ],
    ["exp"           ,"$exp()",            "exp($0)"                     ],
    ["sqrt"          ,"$sqrt()",           "sqrt($0)"                    ],
    ["pow"           ,"$pow()",            "pow($1,$2)"                  ],
    ["floor"         ,"$floor()",          "floor($0)"                   ],
    ["ceil"          ,"$ceil()",           "ceil($0)"                    ],
    ["sin"           ,"$sin()",            "sin($0)"                     ],
    ["cos"           ,"$cos()",            "cos($0)"                     ],
    ["tan"           ,"$tan()",            "tan($0)"                     ],
    ["asin"          ,"$asin()",           "asin($0)"                    ],
    ["acos"          ,"$acos()",           "acos($0)"                    ],
    ["atan"          ,"$atan()",           "atan($0)"                    ],
    ["atan2"         ,"$atan2()",          "atan2($1,$2)"                ],
    ["hypot"         ,"$hypot()",          "hypot($1,$2)"                ],
    ["sinh"          ,"$sinh()",           "sinh($0)"                    ],
    ["cosh"          ,"$cosh()",           "cosh($0)"                    ],
    ["tanh"          ,"$tanh()",           "tanh($0)"                    ],
    ["asinh"         ,"$asinh()",          "asinh($0)"                   ],
    ["acosh"         ,"$acosh()",          "acosh($0)"                   ],
    ["atanh"         ,"$atanh()",          "atanh($0)"                   ],
    // file
    ["fopen"         ,"$fopen()",          "fopen($0,\"r\")"             ],
    ["fclose"        ,"$fclose()",         "fclose($0);"                 ],
    ["fflush"        ,"$fflush()",         "fflush;"                     ],
    ["fgetc"         ,"$fgetc()",          "fgetc($0,)"                  ],
    ["fgets"         ,"$fgets()",          "fgets($0,)"                  ],
    ["fwrite"        ,"$fwrite()",         "fwrite($0,\"\")"             ],
    ["readmemb"      ,"$readmemb()",       "readmemb(\"$1\",$2)"         ],
    ["readmemh"      ,"$readmemh()",       "readmemh(\"$1\",$2)"         ],
    ["sscanf"        ,"$sscanf()",         "sscanf($1,\"$2\",$3)"        ]
];

let sv_completion_systemtask_items: CompletionItem[] = [];
for (let n = 0; n < sv_completion_systemtask.length; n++) {
    sv_completion_systemtask_items.push({
        label: sv_completion_systemtask[n][0],
        kind: CompletionItemKind.Text,
        data: "support.function.systemverilog"
    });
}

const sv_completion_tick: string[][] = [
    ["include"       , "`include …"        , "include \"$0\""                   ],
    ["define"        , "`define …"         , "define $0"                        ],
    ["ifdef"         , "`ifdef …"          , "ifdef $0"                         ],
    ["ifndef"        , "`ifndef …"         , "ifndef $0\n\n`endif"              ],
    ["ifndef"        , "`ifndef … `define" , "ifndef ${1/([A-Za-z0-9_]+).*/$1/}\n\t`define ${1:SYMBOL} ${2:value}\n`endif"],
    ["else"          , "`else "            , "else "                            ],
    ["elsif"         , "`elsif …"          , "elsif $0"                         ],
    ["endif"         , "`endif"            , "endif"                            ],
    ["celldefine"    , "`celldefine …"     , "celldefine\n\t$0\n`endcelldefine" ],
    ["endcelldefine" , "`endcelldefine "   , "endcelldefine "                   ],
    ["line"          , "`line "            , "line "                            ],
    ["resetall"      , "`resetall "        , "resetall"                         ],
    ["timescale"     , "`timescale …"      , "timescale $0"                     ],
    ["undef"         , "`undef …"          , "undef $0"                         ]
];

let sv_completion_tick_items: CompletionItem[] = [];
for (let n = 0; n < sv_completion_tick.length; n++) {
    sv_completion_tick_items.push({
        label: sv_completion_tick[n][0],
        kind: CompletionItemKind.Text,
        data: "constant.other.define.systemverilog"
    });
}

const sv_completion_keywords: string[][] = [
    ["timeunit"],
    ["timeprecision"],
    ["extern"],
    ["static"],
    ["automatic"],
    ["module"],
    ["macromodule"]
    ["endmodule"],
    ["primitive"],
    ["endprimitive"],
    ["interface"],
    ["endinterface"],
    ["program"],
    ["endprogram"],
    ["package"],
    ["endpackage"],
];

export class SystemVerilogCompleter {
    private _indexer: SystemVerilogIndexer;

    constructor(indexer: SystemVerilogIndexer) {
        this._indexer = indexer;
    }

    private _stringlistToCompletionItems(syms: string[], kind: CompletionItemKind, data: string): CompletionItem[] {
        let result: CompletionItem[] = [];
        for (let sym of syms) {
            result.push({
                label: sym,
                kind: kind,
                data: data
            });
        }
        return result;
    }

    completionItems(document: TextDocument, position: Position): CompletionItem[] {
        let items: CompletionItem[] = [];

        const svtokens: GrammarToken[] = this._indexer.getSystemVerilogCompletionTokens(document.uri);
        const svtokennums: number[] = this._indexer.getSystemVerilogCompletionTokenNumber(document, position.line, position.character);
        const svtokennum: number = svtokennums[1];
        const svtoken: GrammarToken | null = (svtokennum > 0) && (svtokennum < svtokens.length) ? svtokens[svtokennum] : null;

        if (!svtoken) {
            return [];
        }

        const scopes : string[] = [svtoken.text].concat(svtoken.scopes); //DEBUG
        //DEBUG const scopes : string[] = svtoken.scopes; //DEBUG
        if (scopes.length > 0) {
            if (scopes[scopes.length - 1] === "system.identifier.systemverilog") {
                return sv_completion_systemtask_items;
            }
            //TBD just $ based completion?
            else if(scopes[scopes.length - 1] === "macro.identifier.systemverilog") {
                let result: CompletionItem[] = sv_completion_tick_items;
                let macroFilesInfo: [string, SystemVerilogSymbol[]][] = this._indexer.getMacros(document.uri);
                for (let macroFileInfo of macroFilesInfo) {
                    result = result.concat(macroFileInfo[1].map(sym => {
                        return {
                            label: sym.name,
                            kind:  CompletionItemKind.Text,
                            data: "macro.systemverilog"
                        };
                    }));
                }
                return result;
            }
            //TBD just ` based completion?
            else {
                if ((svtokennums[0] != svtokennums[1]) || (scopes[scopes.length - 1] == "identifier.hierarchical.systemverilog")) {
                    const symTokens: GrammarToken[] = svtokens.slice(svtokennums[0], svtokennums[1] + 1);
                    let symParts: string[] = this._indexer.getHierParts(symTokens.map(t => t.text).join(''), symTokens, document.offsetAt(position) - svtokens[svtokennums[0]].index);
                    let fileUri: string;
                    let containerInfo: SystemVerilogParser.SystemVerilogContainerInfo = [undefined, undefined];
                    [fileUri, containerInfo[0]] = this._indexer.getHierarchicalSymbol(document.uri, symParts.slice(0, -1));
                    [fileUri, containerInfo[0], containerInfo[1]] = this._indexer.getSymbolTypeContainerInfo(fileUri, containerInfo[0]);
                    return this._stringlistToCompletionItems(SystemVerilogParser.containerAllSymbols(containerInfo, true).map(s => s.name), CompletionItemKind.Text, "identifier.hieararchical.systemverilog");
                }
                else if (scopes[scopes.length - 1] == "identifier.scoped.systemverilog") {
                    let idparts: string[] = svtoken.text.split('::');
                    if ((idparts.length == 1) || (idparts.length == 2)) {
                        return this._stringlistToCompletionItems(this._indexer.getPackageSymbols(idparts[0]).map(sym => sym.name), CompletionItemKind.Text, "import.package_item.systemverilog");
                    }
                }
                else if (scopes[scopes.length - 1] == "identifier.simple.systemverilog") {
                    if (scopes.length >= 2) {
                        if (scopes[scopes.length - 2] == "import.statement.systemverilog") {
                            return this._stringlistToCompletionItems(this._indexer.getPackages(), CompletionItemKind.Text, "import.package.systemverilog");
                        }
                        else if (scopes[scopes.length - 2] == "parantheses.block.systemverilog") {
                            let prevTokenNum: number = this._getPrevTokenNum(svtokens, svtokennum);
                            if ((prevTokenNum >= 0) && (svtokens[prevTokenNum].scopes.length > 0) && (svtokens[prevTokenNum].text == ".")) {
                                return this._getInstanceCompletions(svtokens, prevTokenNum);
                            }
                        }
                        else {
                            let fileCompletionItems: CompletionItem[] = [];
                            // get imported symbols
                            for (let [pkgName, importedSyms] of this._indexer.getFileImports(document.uri)) {
                                fileCompletionItems = fileCompletionItems.concat(importedSyms.map(name => {
                                    return {
                                        label: name,
                                        kind: CompletionItemKind.Text,
                                        data: "identifier.regular.systemverilog"
                                    };
                                }));
                            }
                            // get file symbols
                            fileCompletionItems = fileCompletionItems.concat(this._indexer.getDocumentSystemVerilogSymbols(document.uri, false).map(sym => {
                                return {
                                    label: (sym.type[0] == "macro") ? `\`${sym.name}` : sym.name,
                                    kind: CompletionItemKind.Text,
                                    data: "identifier.regular.systemverilog"
                                };
                            }));
                            return fileCompletionItems;
                        }
                    }
                }
                else if ((svtoken.text == ".") && (scopes.length >= 2)) {
                    return this._getInstanceCompletions(svtokens, svtokennum);
                }
                else {
                    //DEBUG
                    //for (let j = 0; j < scopes.length; j++) {
                    //    items.push({
                    //        label: scopes[0].concat(scopes[j]),
                    //        kind: CompletionItemKind.Text,
                    //        data: j + 2
                    //    });
                    //}
                }
            }
        }

        return items;
    }

    private _getTokenTopScope(svtoken: GrammarToken): string {
        return svtoken.scopes.length > 0 ? svtoken.scopes[svtoken.scopes.length - 1] : "";
    }

    private _getPrevTokenNum(svtokens: GrammarToken[], tokenNum: number): number {
        let prevTokenNum: number = -1;
        for (let i = tokenNum - 1; i >= 0; i--) {
            let scope: string = this._getTokenTopScope(svtokens[i]);
            if ((scope != "") && (scope != "meta.whitespace.systemverilog") && (scope != "comment.block.systemverilog") &&
                (scope != "comment.line.systemverilog") && (scope != "macro.identifier.systemverilog") && (scope != "macro.call.systemverilog")) {
                prevTokenNum = i;
                break;
            }
        }
        return prevTokenNum;
    }

    private _getHierInstType(svtokens: GrammarToken[], tokenNum: number): {tokenNum: number, portType: string} {
        let _getParanthesesBegin = (tn: number): number => {
            let ctn: number = tn;
            let openParenLevel: number = -1;
            while (ctn >= 0) {
                ctn = this._getPrevTokenNum(svtokens, ctn);
                if (ctn >= 0) {
                    let scope: string = this._getTokenTopScope(svtokens[ctn]);
                    if (scope == "parantheses.end.systemverilog") {
                        openParenLevel--;
                    }
                    else if (scope == "parantheses.begin.systemverilog") {
                        openParenLevel++;
                        if (openParenLevel == 0) {
                            break;
                        }
                    }
                }
            }
            return ctn < 0 ? -1 : ctn;
        }

        // Find the param/port list instantiation begin
        let currTokenNum: number = _getParanthesesBegin(tokenNum);
        if (currTokenNum < 0) {
            return {tokenNum: -1, portType: ""};
        }

        // Check that prev token is identifier or #
        currTokenNum = this._getPrevTokenNum(svtokens, currTokenNum);
        if (currTokenNum >= 0) {
            let scope: string = this._getTokenTopScope(svtokens[currTokenNum]);
            if (svtokens[currTokenNum].text == "#") {
                currTokenNum = this._getPrevTokenNum(svtokens, currTokenNum);
                if (currTokenNum < 0) {
                    return {tokenNum: -1, portType: ""};
                }
                scope = this._getTokenTopScope(svtokens[currTokenNum]);
                if (scope == "identifier.simple.systemverilog") {
                    return {tokenNum: currTokenNum, portType: "param"};
                }
                else {
                    return {tokenNum: -1, portType: ""};
                }
            }
            else if (scope != "identifier.simple.systemverilog") {
                return {tokenNum: -1, portType: ""};
            }
        }
        else {
            return {tokenNum: -1, portType: ""};
        }

        // Check if parameter port list instantiated
        currTokenNum = this._getPrevTokenNum(svtokens, currTokenNum);
        if (currTokenNum >= 0) {
            let scope: string = this._getTokenTopScope(svtokens[currTokenNum]);
            if (scope == "parantheses.end.systemverilog") {
                currTokenNum = _getParanthesesBegin(currTokenNum);
                if (currTokenNum < 0) {
                    return {tokenNum: -1, portType: ""};
                }

                currTokenNum = this._getPrevTokenNum(svtokens, currTokenNum);
                if (currTokenNum < 0) {
                    return {tokenNum: -1, portType: ""};
                }
                if (svtokens[currTokenNum].text != "#") {
                    return {tokenNum: -1, portType: ""};
                }

                currTokenNum = this._getPrevTokenNum(svtokens, currTokenNum);
                if (currTokenNum < 0) {
                    return {tokenNum: -1, portType: ""};
                }
                scope = this._getTokenTopScope(svtokens[currTokenNum]);
            }

            if (scope == "identifier.simple.systemverilog") {
                return {tokenNum: currTokenNum, portType: "port"};
            }
            else {
                return {tokenNum: -1, portType: ""};
            }
        }
        else {
            return {tokenNum: -1, portType: ""};
        }
    }

    private _getInstanceCompletions(svtokens: GrammarToken[], svtokennum: number): CompletionItem[] {
        let instInfo: {tokenNum: number, portType: string} = this._getHierInstType(svtokens, svtokennum);
        if (instInfo.tokenNum >= 0) {
            //ConnectionLogger.log(`DEBUG: Instantiating module - ${svtokens[instInfo.tokenNum].text} port list type ${instInfo.portType}`);
            if (instInfo.portType == "param") {
                return this._stringlistToCompletionItems(this._indexer.getInstParams(svtokens[instInfo.tokenNum].text).map(sym => sym.name), CompletionItemKind.Text, "inst.params.systemverilog");
            }
            else if (instInfo.portType == "port") {
                return this._stringlistToCompletionItems(this._indexer.getInstPorts(svtokens[instInfo.tokenNum].text).map(sym => sym.name), CompletionItemKind.Text, "inst.params.systemverilog");
            }
            else {
                ConnectionLogger.error(`Invalid port type ${instInfo.portType} returned`);
                return [];
            }
        }
        else {
            ConnectionLogger.warn(`Unable to find module instantiation at - ${svtokennum}`);
            return [];
        }
    }
}
