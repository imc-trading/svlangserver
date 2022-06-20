import {
    r
} from './grammar_engine';

function toAssignmentExpression(scopeName: string, listRegExp: string, listTokens: string[], listContext: string, endRegExp: string, endTokens: string[]) {
    return {
        scopeName: scopeName,
        patterns: [
            {
                match: listRegExp,
                tokens: listTokens,
                pop: listContext
            },
            {
                match: endRegExp,
                tokens: endTokens,
                pop: ""
            },
            { include: "BaseGrammar" }
        ]
    };
}

function toPortListBody(scopeNamePrefix: string, termRegExp: string, termTokens: string[], contextName: string) {
    return {
        scopeName: `${scopeNamePrefix}.list.systemverilog`,
        patterns: [
            {
                match: termRegExp,
                tokens: termTokens,
                pop: ""
            },
            {
                match: r`(=)`,
                tokens: ["operator.equals.systemverilog"],
                pop: toAssignmentExpression(
                    `${scopeNamePrefix}.expression.systemverilog`,
                    r`(,)`,
                    ["operator.comma.systemverilog"],
                    contextName,
                    termRegExp,
                    termTokens
                )
            },
            { include: "AllAllow" },
            { include: "AttributeInstance" },
            { include: "CommaOperator" },
            { include: "Dimension" },
            { include: "EnumDeclaration" },
            { include: "GeneralParanthesesBlock" },
            { include: "StructUnionDeclaration" },
            { include: "Identifier" }
        ]
    };
}

function toIgnoreBlock(startRegExp: string, startTokens: string[], endRegExp: string, endTokens: string[], scopeNamePrefix: string, contextName: string) {
    return {
        patterns: [
            {
                match: startRegExp,
                tokens: startTokens,
                push: {
                    scopeName: `${scopeNamePrefix}.declaration.systemverilog`,
                    patterns: [
                        {
                            match: endRegExp,
                            tokens: endTokens,
                            pop: ""
                        },
                        { include: contextName },
                        { include: "BaseGrammar" }
                    ]
                }
            }
        ]
    };
}

function toIgnoreStatement(startRegExp: string, startTokens: string[], scopeNamePrefix: string) {
    return {
        patterns: [
            {
                match: startRegExp,
                tokens: startTokens,
                push: {
                    scopeName: `${scopeNamePrefix}.statement.systemverilog`,
                    patterns: [
                        {
                            match: r`(;)`,
                            tokens: ["operator.semicolon.systemverilog"],
                            pop: ""
                        },
                        { include: "BaseGrammar" }
                    ]
                }
            }
        ]
    }
}

export const svcompletion_grammar = {
    Main: {
        scopeName: "source.systemverilog",
        patterns: [
            { include: "AttributeInstance" },
            { include: "ContinuousBlock" },
            { include: "EnumDeclaration" },
            { include: "BeginEndBlock" },
            { include: "ExportDeclaration" },
            { include: "GenerateBlock" },
            { include: "IgnoreBlocksStatements" },
            { include: "ImportDeclaration" },
            { include: "ModPortDeclaration" },
            { include: "ParameterDeclaration" },
            { include: "PortDeclaration" },
            { include: "RoutineDeclaration" },
            { include: "StructUnionDeclaration" },
            { include: "SvContainer" },
            { include: "SvPackage" },
            { include: "TypeDefDeclaration" },
            { include: "BaseGrammar" }
        ]
    },

    AllAllow: {
        patterns: [
            { include: "Macro" },
            { include: "Comment" },
            { include: "Whitespace" }
        ]
    },

    AssignmentExpression: {
        patterns: [
            {
                //TBD match: r`((?:<)?=(?!==?))`, //Non-blocking assignment is confused with less-than-equals operator
                match: r`((?<!<)=(?!==?))`,
                tokens: ["assignment.begin.systemverilog"],
                push: {
                    scopeName: "assignment.expression.systemverilog",
                    patterns: [
                        {
                            match: r`(;)`,
                            tokens: ["assignment.end.systemverilog"],
                            pop: ""
                        },
                        { include: "BaseGrammar" }
                    ]
                }
            }
        ]
    },

    AssignmentPattern: {
        patterns: [
            {
                match: r`('\{)`,
                tokens: ["assignment_pattern.begin.systemverilog"],
                push: {
                    scopeName: "assignment_pattern.expression.systemverilog",
                    patterns: [
                        {
                            match: r`(\})`,
                            tokens: ["assignment_pattern.end.systemverilog"],
                            pop: ""
                        },
                        { include: "BaseGrammar" }
                    ]
                }
            }
        ]
    },

    AttributeInstance: {
        patterns: [
            {
                match: r`((?<!@ *)\(\*)`,
                tokens: ["attribute.begin.systemverilog"],
                push: "AttributeInstanceBody"
            }
        ]
    },

    AttributeInstanceBody: {
        scopeName: "attribute.inst.systemverilog",
        patterns: [
            {
                match: r`(\*\))`,
                tokens: ["attribute.end.systemverilog"],
                pop: ""
            },
            { include: "Identifier" },
            {
                match: r`(=)`,
                tokens: ["operator.equals.systemverilog"],
                pop: toAssignmentExpression(
                    "attribute.expression.systemverilog",
                    r`(,)`,
                    ["operator.comma.systemverilog"],
                    "AttributeInstanceBody",
                    r`(\*\))`,
                    ["attribute.end.systemverilog"]
                )
            },
            { include: "AllAllow" }
        ]
    },

    BaseGrammar: {
        patterns: [
            { include: "AllAllow" },
            { include: "AttributeInstance" },
            //TBC { include: "AssignmentExpression" },
            { include: "AssignmentPattern" },
            { include: "EnumDeclaration" },
            { include: "StructUnionDeclaration" },
            { include: "TypeDefDeclaration" },
            { include: "CaseStatement" },
            { include: "CommaOperator" },
            { include: "CompletionItems" },
            { include: "Dimension" },
            { include: "GeneralBracesBlock" },
            { include: "GeneralParanthesesBlock" },
            { include: "QuotedString" },
            { include: "SpecialTokens" },
            { include: "SvNumber" },
            { include: "SvOperators" }
        ]
    },

    BeginEndBlock: {
        patterns: [
            {
                match: r`\b(begin)\b`,
                tokens: ["keyword.begin.systemverilog"],
                pushScopes: ["begin.block.systemverilog"]
            },
            {
                match: r`\b(end)\b`,
                tokens: ["keyword.end.systemverilog"],
                popScopes: ["begin.block.systemverilog"]
            }
        ]
    },

    CaseStatement: {
        patterns: [
            {
                match: r`\b(case[xz]?|randcase)\b`,
                tokens: ["keyword.case.systemverilog"],
                pushScopes: ["case.body.systemverilog"]
            },
            {
                match: r`\b(endcase)\b`,
                tokens: ["keyword.endcase.systemverilog"],
                popScopes: ["case.body.systemverilog"]
            }
        ]
    },

    CommaOperator: {
        patterns: [
            {
                match: r`(,)`,
                tokens: ["operator.comma.systemverilog"]
            }
        ]
    },

    Comment: {
        patterns: [
            {
                match: r`(/\*(?:.|\n|\r)*?(?:\*/|$))`,
                tokens: ["comment.block.systemverilog"],
            },
            {
                match: r`(//.*(?:\n|\r|$))`,
                tokens: ["comment.line.systemverilog"],
            }
        ]
    },

    CompletionItems: {
        patterns: [
            { include: "Identifier" },
            { include: "SystemTask" }
        ]
    },

    ContinuousBlock: {
        patterns: [
            {
                match: r`\b(assign)\b`,
                tokens: ["keyword.assign.systemverilog"],
                push: "ContinuousBlockBody"
            }
        ]
    },

    ContinuousBlockBody: {
        scopeName: "continuous.block.systemverilog",
        patterns: [
            {
                match: r`(;)`,
                tokens: "operator.semicolon.systemverilog",
                pop: ""
            },
            {
                match: r`(=)`,
                tokens: ["operator.equals.systemverilog"],
                pop: toAssignmentExpression(
                    "continuous.expression.systemverilog",
                    r`(,)`,
                    ["operator.comma.systemverilog"],
                    "ContinuousBlockBody",
                    r`(;)`,
                    ["operaator.semicolon.systemverilog"]
                )
            },
            { include: "BaseGrammar" }
        ]
    },

    Dimension: {
        patterns: [
            {
                match: r`(\[)`,
                tokens: ["operator.open_bracket.systemverilog"],
                push: {
                    scopeName: "dimension.expression.systemverilog",
                    patterns: [
                        {
                            match: r`(\])`,
                            tokens: ["operator.close_bracket.systemverilog"],
                            pop: ""
                        },
                        { include: "RangeOperator" },
                        { include: "BaseGrammar" }
                    ]
                }
            }
        ]
    },

    GenerateBlock: {
        patterns: [
            {
                match: r`\b(generate)\b`,
                tokens: ["keyword.generate.systemverilog"],
                pushScopes: ["generate.block.systemverilog"]
            },
            {
                match: r`\b(endgenerate)\b`,
                tokens: ["keyword.endgenerate.systemverilog"],
                popScopes: ["generate.block.systemverilog"]
            }
        ]
    },

    EnumDeclaration: {
        patterns: [
            {
                match: r`\b(enum)\b`,
                tokens: ["keyword.enum.systemverilog"],
                push: {
                    scopeName: "enum.declaration.systemverilog",
                    patterns: [
                        {
                            match: r`(\{)`,
                            tokens: ["enum_list.begin.systemverilog"],
                            pop: "EnumListBody",
                        },
                        { include: "AllAllow" },
                        { include: "Identifier" },
                        { include: "Dimension" }
                    ]
                }
            },
        ]
    },

    EnumListBody: {
        scopeName: "enum_list.body.systemverilog",
        patterns: [
            {
                match: r`(\})`,
                tokens: ["enum_list.end.systemverilog"],
                pop: ""
            },
            {
                match: r`(=)`,
                tokens: ["operator.equals.systemverilog"],
                pop: toAssignmentExpression(
                    "enum.expression.systemverilog",
                    r`(,)`,
                    ["operator.comma.systemverilog"],
                    "EnumListBody",
                    r`(\})`,
                    ["enum_list.end.systemverilog"]
                )
            },
            { include: "AllAllow" },
            { include: "CommaOperator" },
            { include: "Dimension" },
            { include: "Identifier" }
        ]
    },

    ExportDeclaration: {
        patterns: [
            {
                match: r`(\bexport\b)`,
                tokens: ["keyword.export.systemverilog"],
                push: {
                    scopeName: "export.declaration.systemverilog",
                    patterns: [
                        {
                            match: r`(;)`,
                            tokens: ["operator.semicolon.systemverilog"],
                            pop: ""
                        },
                        {
                            match: r`(\*::\*)`,
                            tokens: ["identifier.scoped.systemverilog"]
                        },
                        { include: "AllAllow" },
                        { include: "Identifier" }
                    ]
                }
            }
        ]
    },

    ForkJoinBlock: {
        patterns: [
            {
                match: r`\b(fork)\b`,
                tokens: ["keyword.fork.systemverilog"],
                push: {
                    scopeName: "fork.body.systemverilog",
                    patterns: [
                        {
                            match: r`\b(join|join_any|join_none)\b`,
                            tokens: ["keyword.join.systemverilog"],
                            pop: ""
                        },
                        { include: "ForkJoinBlock" },
                        { include: "BaseGrammar" }
                    ]
                }
            }
        ]
    },

    GeneralBracesBlock: {
        patterns: [
            {
                match: r`(\{)`,
                tokens: ["braces.begin.systemverilog"],
                push: {
                    scopeName: "braces.block.systemverilog",
                    patterns: [
                        {
                            match: r`(\})`,
                            tokens: ["braces.end.systemverilog"],
                            pop: ""
                        },
                        { include: "BaseGrammar" }
                    ]
                }
            }
        ]
    },

    GeneralParanthesesBlock: {
        patterns: [
            {
                match: r`(\()`,
                tokens: ["parantheses.begin.systemverilog"],
                push: {
                    scopeName: "parantheses.block.systemverilog",
                    patterns: [
                        {
                            match: r`(\))`,
                            tokens: ["parantheses.end.systemverilog"],
                            pop: ""
                        },
                        { include: "BaseGrammar" }
                    ]
                }
            }
        ]
    },

    Identifier: {
        patterns: [
            {
                match: r`([a-zA-Z_][a-zA-Z0-9_$]*::(?:[a-zA-Z_][a-zA-Z0-9_$]*(?:::)?)*\*?)`,
                tokens: ["identifier.scoped.systemverilog"]
            },
            {
                match: r`([a-zA-Z_][a-zA-Z0-9_$]*\.(?:[a-zA-Z_][a-zA-Z0-9_$]*\.?)*)`,
                tokens: ["identifier.hierarchical.systemverilog"]
            },
            {
                match: r`([a-zA-Z_][a-zA-Z0-9_$]*)`,
                tokens: ["identifier.simple.systemverilog"]
            },
            {
                match: r`(\\\S+(?:\s|\n|\r))`,
                tokens: ["identifier.escaped.systemverilog"]
            }
        ]
    },

    IgnoreBlocksStatements: {
        patterns: [
            { include: "IgnoreCheckerDeclaration" },
            { include: "IgnoreClassDeclaration" },
            { include: "IgnoreCoverGroupDeclaration" },
            { include: "IgnoreDefparamStatement" },
            { include: "IgnoreExternConstraintDeclaration" },
            { include: "IgnoreLetStatement" },
            { include: "IgnorePropertyDeclaration" },
            { include: "IgnoreSequenceDeclaration" },
            { include: "IgnoreSpecifyBlock" },
            { include: "IgnoreSpecparamDeclaration" }
        ]
    },

    IgnoreCheckerDeclaration: toIgnoreBlock(
        r`\b(checker)\b`,
        ["keyword.checker.systemverilog"],
        r`\b(endchecker)\b`,
        ["keyword.endchecker.systemverilog"],
        "checker",
        "IgnoreCheckerDeclaration"
    ),

    IgnoreClassDeclaration: toIgnoreBlock(
        r`\b(class)\b`,
        ["keyword.class.systemverilog"],
        r`\b(endclass)\b`,
        ["keyword.endclass.systemverilog"],
        "class",
        "IgnoreClassDeclaration"
    ),

    IgnoreCoverGroupDeclaration: toIgnoreBlock(
        r`\b(covergroup)\b`,
        ["keyword.covergroup.systemverilog"],
        r`\b(endgroup)\b`,
        ["keyword.endgroup.systemverilog"],
        "covergroup",
        "IgnoreCoverGroupDeclaration"
    ),

    IgnoreDefparamStatement: toIgnoreStatement(
        r`\b(defparam)\b`,
        ["keyword.defparam.systemverilog"],
        "defparam"
    ),

    IgnoreExternConstraintDeclaration: {
        patterns: [
            {
                match: r`\b(constraint)\b`,
                tokens: ["keyword.constraint.systemverilog"],
                push: {
                    scopeName: "constraint.declaration.systemverilog",
                    patterns: [
                        {
                            match: r`(\{)`,
                            tokens: ["operator.open_braces.systemverilog"],
                            pop: {
                                scopeName: "constraint.body.systemverilog",
                                patterns: [
                                    {
                                        match: r`(\})`,
                                        tokens: ["operator.close_braces.systemverilog"],
                                        pop: ""
                                    },
                                    { include: "BaseGrammar" }
                                ]
                            }
                        },
                        { include: "AllAllow" },
                        { include: "Identifier" }
                    ]
                }
            }
        ]
    },

    IgnoreLetStatement: toIgnoreStatement(
        r`\b(let)\b`,
        ["keyword.let.systemverilog"],
        "let"
    ),

    IgnorePropertyDeclaration: toIgnoreBlock(
        r`\b(property)\b`,
        ["keyword.property.systemverilog"],
        r`\b(endproperty)\b`,
        ["keyword.endproperty.systemverilog"],
        "property",
        "IgnorePropertyDeclaration"
    ),

    IgnoreSequenceDeclaration: toIgnoreBlock(
        r`\b(sequence)\b`,
        ["keyword.sequence.systemverilog"],
        r`\b(endsequence)\b`,
        ["keyword.endsequence.systemverilog"],
        "sequence",
        "IgnoreSequenceDeclaration"
    ),

    IgnoreSpecifyBlock: toIgnoreBlock(
        r`\b(specify)\b`,
        ["keyword.specify.systemverilog"],
        r`\b(endspecify)\b`,
        ["keyword.endspecify.systemverilog"],
        "specify",
        "IgnoreSpecifyBlock"
    ),

    IgnoreSpecparamDeclaration: toIgnoreStatement(
        r`\b(specparam)\b`,
        ["keyword.specparam.systemverilog"],
        "specparam"
    ),

    ImportDeclaration: {
        patterns: [
            {
                match: r`\b(import)\b`,
                tokens: ["keyword.import.systemverilog"],
                push: {
                    scopeName: "import.statement.systemverilog",
                    patterns: [
                        {
                            match: r`(;)`,
                            tokens: ["operator.semicolon.systemverilog"],
                            pop: ""
                        },
                        { include: "AllAllow" },
                        { include: "CommaOperator" },
                        { include: "Identifier" }
                    ]
                }
            }
        ]
    },

    Macro: {
        patterns: [
            {
                match: r`(\`(?:[a-zA-Z_][a-zA-Z0-9_$]*\s*|\\\S+\s+)\()`,
                tokens: ["macro.call.systemverilog"],
                push: {
                    scopeName: "macro.args.systemverilog",
                    patterns: [
                        {
                            match: r`(\))`,
                            tokens: ["macro.end.systemverilog"],
                            pop: "",
                        },
                        { include: "BaseGrammar" }
                    ]
                }
            },
            //TODO : fix
            {
                match: r`(\`define)\b`,
                tokens: ["preproc.define.systemverilog"],
                push: {
                    scopeName: "preproc.declaration.systemverilog",
                    patterns: [
                        {
                            match: r`(\\\\)`,
                            tokens: ["escaped.backslash.systemverilog"]
                        },
                        {
                            match: r`(\\(?:\n|\r))`,
                            tokens: ["escaped.newline.systemverilog"]
                        },
                        {
                            match: r`(//.*(?:\n|\r|$))`,
                            tokens: ["comment.line.systemverilog"],
                            pop: ""
                        },
                        {
                            match: r`(\n|\r|$)`,
                            tokens: ["meta.whitespace.systemverilog"],
                            pop: ""
                        },
                        { include: "Identifier" },
                        { include: "Macro" },
                        { include: "QuotedString" },
                        { include: "SvNumber" },
                        { include: "SvOperators" },
                        { include: "Whitespace" }
                    ]
                }
            },
            {
                match: r`(\`ifdef|\`ifndef)\b`,
                tokens: ["preproc.if.systemverilog"],
                saveState: true,
                push: {
                    scopeName: "macro.conditional.systemverilog",
                    patterns: [
                        {
                            match: r`([a-zA-Z_][0-9a-zA-Z_$]*|\\\S+\s)`,
                            tokens: ["identifier.macro.systemverilog"],
                            pop: ""
                        },
                        { include: "AllAllow" }
                    ]
                }
            },
            {
                match: r`(\`elsif)\b`,
                tokens : ["preproc.elsif.systemverilog"],
                restoreState: true,
                push: {
                    scopeName: "macro.conditional.systemverilog",
                    patterns: [
                        {
                            match: r`([a-zA-Z_][0-9a-zA-Z_$]*|\\\S+\s)`,
                            tokens: ["identifier.macro.systemverilog"],
                            pop: ""
                        },
                        { include: "AllAllow" }
                    ]
                }
            },
            {
                match: r`(\`else)\b`,
                tokens : ["preproc.else.systemverilog"],
                restoreState: true
            },
            {
                match: r`(\`endif)\b`,
                tokens: ["preproc.endif.systemverilog"],
                deleteState: true
            },
            {
                match: r`(\`(?:[a-zA-Z_][a-zA-Z0-9_$]*|\\\S+\s))`,
                tokens: ["macro.identifier.systemverilog"]
            }
        ]
    },

    ModPortDeclaration: {
        patterns: [
            {
                match: r`\b(modport)\b`,
                tokens: ["keyword.modport.systemverilog"],
                push: {
                    scopeName: "modport.declaration.systemverilog",
                    patterns: [
                        {
                            match: r`(;)`,
                            tokens: ["operator.semicolon.systemverilog"],
                            pop: ""
                        },
                        { include: "PortList" },
                        { include: "BaseGrammar" }
                    ]
                }
            }
        ]
    },

    ParameterDeclaration: {
        patterns: [
            {
                match: r`\b(parameter|localparam)\b`,
                tokens: ["keyword.parameter.systemverilog"],
                push: "ParameterDeclarationBody"
            }
        ]
    },

    ParameterDeclarationBody: {
        scopeName: "parameter.declaration.systemverilog",
        patterns: [
            {
                match: r`(;)`,
                tokens: ["operator.semicolon.systemverilog"],
                pop: "",
            },
            {
                match: r`(=)`,
                tokens: ["operator.equals.systemverilog"],
                pop: toAssignmentExpression(
                    "parameter.expression.systemverilog",
                    r`(,)`,
                    ["operator.comma.systemverilog"],
                    "ParameterDeclarationBody",
                    r`(;)`,
                    ["operator.semicolon.systemverilog"]
                )
            },
            { include: "AllAllow" },
            { include: "Dimension" },
            { include: "EnumDeclaration" },
            { include: "GeneralParanthesesBlock" },
            { include: "StructUnionDeclaration" },
            { include: "Identifier" }
        ]
    },

    ParameterPortList: {
        patterns: [
            {
                match: r`(#\s*\()`,
                tokens: ["operator.hash_open_parantheses.systemverilog"],
                push: "ParameterPortListBody"
            }
        ]
    },

    ParameterPortListBody: toPortListBody("parameter", r`(\))`, ["operator.close_parantheses.systemverilog"], "ParameterPortListBody"),

    PortDeclaration: {
        patterns: [
            {
                match: r`\b(input|output|inout|ref)\b`,
                tokens: ["keyword.port_direction.systemverilog"],
                push: "PortDeclarationBody"
            }
        ]
    },

    PortDeclarationBody: toPortListBody("port_declaration", r`(;)`, ["operator.semicolon.systemverilog"], "PortDeclarationBody"),

    PortList: {
        patterns: [
            {
                match: r`((?<!#\s*)\()`,
                tokens: ["operator.open_parantheses.systemverilog"],
                push: "PortListBody"
            }
        ]
    },

    PortListBody: toPortListBody("port", r`(\))`, ["operator.close_parantheses.systemverilog"], "PortListBody"),

    QuotedString: {
        patterns: [
            {
                match: r`(")`,
                tokens: ["string.begin.systemverilog"],
                push: {
                    scopeName: "string.body.systemverilog",
                    patterns: [
                        {
                            match: r`(")`,
                            tokens: ["string.end.systemverilog"],
                            pop: "",
                        },
                        {
                            match: r`(\\\\)`,
                            tokens: ["escaped.backslash.systemverilog"]
                        },
                        {
                            match: r`(\\")`,
                            tokens: ["escaped.quote.systemverilog"]
                        },
                        {
                            match: r`(\\)`,
                            tokens: ["regular.backslash.systemverilog"]
                        },
                        {
                            match: r`([^"\\]+)`,
                            tokens: ["string.characters.systemverilog"]
                        }
                    ]
                }
            }
        ]
    },

    RandSequenceBlock: {
        patterns: [
            {
                match: r`\b(randsequence)\b`,
                tokens: ["keyword.randsequence.systemverilog"],
                push: {
                    scopeName: "randsequence.body.systemverilog",
                    patterns: [
                        {
                            match: r`\b(endsequence)\b`,
                            tokens: ["keyword.endsequence.systemverilog"],
                            pop: ""
                        },
                        { include: "RandSequenceBlock" },
                        { include: "BaseGrammar" }
                    ]
                }
            }
        ]
    },

    RangeOperator: {
        patterns: [
            {
                match: r`((?:\+|-)?:)`,
                tokens: ["operator.range.systemverilog"]
            }
        ]
    },

    RoutineDeclaration: {
        patterns: [
            {
                match: r`\b(function|task)\b`,
                tokens: ["keyword.routine.systemverilog"],
                push: {
                    scopeName: "routine.header.systemverilog",
                    patterns: [
                        {
                            match: r`(;)`,
                            tokens: ["operator.semicolon.systemverilog"],
                            pop: ""
                        },
                        { include: "AllAllow" },
                        { include: "Dimension" },
                        { include: "Identifier" },
                        { include: "PortList" }
                    ]
                }
            }
        ]
    },

    StructUnionDeclaration: {
        patterns: [
            {
                match: r`\b(struct|union)\b`,
                tokens: ["keyword.struct_union.systemverilog"],
                push: {
                    scopeName: "struct_union.declaration.systemverilog",
                    patterns: [
                        {
                            match: r`(\{)`,
                            tokens: ["struct_union_member_list.begin.systemverilog"],
                            pop: "StructUnionMemberListBody",
                        },
                        { include: "AllAllow" },
                        { include: "Identifier" }
                    ]
                }
            }
        ]
    },

    StructUnionMemberListBody: {
        scopeName: "struct_union_member_list.body.systemverilog",
        patterns: [
            {
                match: r`(\})`,
                tokens: ["struct_union_member_list.end.systemverilog"],
                pop: ""
            },
            {
                match: r`(=)`,
                tokens: ["operator.equals.systemverilog"],
                pop: toAssignmentExpression(
                    "struct_union_member.expression.systemverilog",
                    r`(;)`,
                    ["operator.comma.systemverilog"],
                    "StructUnionMemberListBody",
                    r`(\})`,
                    ["struct_union_member_list.end.systemverilog"]
                )
            },
            {
                match: r`(;)`,
                tokens: ["operator.semicolon.systemverilog"]
            },
            { include: "AllAllow" },
            { include: "Dimension" },
            { include: "StructUnionDeclaration" },
            { include: "EnumDeclaration" },
            { include: "Identifier" }
        ]
    },

    SvContainer: {
        patterns: [
            {
                match: r`\b(module|macromodule|interface|program)\b`,
                tokens: ["keyword.container.systemverilog"],
                push: {
                    scopeName: "container.header.systemverilog",
                    patterns: [
                        {
                            match: r`(;)`,
                            tokens: ["operator.semicolon.systemverilog"],
                            pop: ""
                        },
                        { include: "AllAllow" },
                        { include: "ImportDeclaration" },
                        { include: "Identifier" },
                        { include: "ParameterPortList" },
                        { include: "PortList" }
                    ]
                }
            }
        ]
    },

    SpecialTokens: {
        patterns: [
            {
                match: r`(\'")`,
                tokens: ["macro.quote.systemverilog"]
            },
            {
                match: r`(\`\\")`,
                tokens: ["macro.escaped_quote.systemverilog"]
            },
            {
                match: r`(\`\`)`,
                tokens: ["macro.concat.systemverilog"]
            },
            {
                match: r`(\\\\)`,
                tokens: ["escaped.backslash.systemverilog"]
            },
            {
                match: r`(\\(?:\n|\r))`,
                tokens: ["escaped.new_line.systemverilog"]
            }
        ]
    },

    SvNumber: {
        patterns: [
            {
                match: `([0-9][0-9]*(?:\.[0-9][0-9*])?(?:s|ms|us|ns|ps|fs))`,
                tokens: ["literal.time.systemverilog"]
            },
            {
                match: r`((?:\d+)?'[sS]?[bB][01xXzZ?][01xXzZ?_]*)`,
                tokens: ["literal.number.systemverilog"]
            },
            {
                match: r`((?:\d+)?'[sS]?[oO][0-7xXzZ?][0-7xXzZ?_]*)`,
                tokens: ["literal.number.systemverilog"]
            },
            {
                match: r`((?:\d+)?'[sS]?[dD][0-9][0-9_]*)`,
                tokens: ["literal.number.systemverilog"]
            },
            {
                match: r`((?:\d+)?'[sS]?[dD][xXzZ?]_*)`,
                tokens: ["literal.number.systemverilog"]
            },
            {
                match: r`((?:\d+)?'[sS]?[hH][0-9a-fA-FxXzZ?][0-9a-fA-F_xXzZ?]*)`,
                tokens: ["literal.number.systemverilog"]
            },
            {
                match: r`('[01xXzZ?])`,
                tokens: ["literal.number.systemverilog"]
            },
            {
                match: r`([0-9][0-9_]*(?:\.[0-9][0-9_]*)?(?:[eE](?:\+|-)?[0-9][0-9_]*)?)`,
                tokens: ["literal.number.systemverilog"]
            }
        ]
    },

    SvOperators: {
        patterns: [
            {
                match: r`(===|!==|==|!=|<=|>=|<<|>>|<|>)`,
                tokens: ["operator.comparison.systemverilog"]
            },
            {
                match: r`(->[>]?)`,
                tokens: ["operator.trigger.systemverilog"]
            },
            {
                match: r`(=)`,
                tokens: ["operator.equals.systemverilog"]
            },
            {
                match: r`(:=|:/)`,
                tokens: ["operator.constraint.systemverilog"]
            },
            {
                match: r`(\-\-|\+\+|\-|\+|\*|\/|%)`,
                tokens: ["operator.arithmetic.systemverilog"]
            },
            {
                match: r`(!|&&|\|\|)`,
                tokens: ["operator.logical.systemverilog"]
            },
            {
                match: r`(\bor\b)`,
                tokens: ["operator.logical.systemverilog"]
            },
            {
                match: r`(&|\||\^|~)`,
                tokens: ["operator.bitwise.systemverilog"]
            },
            // GeneralBracesBlock
            //{
            //    match: r`(\{|})`,
            //    tokens: ["operator.other.systemverilog"]
            //},
            {
                match: r`(\?|:)`,
                tokens: ["operator.ternary.systemverilog"]
            },
            {
                match: r`(#)(1step)`,
                tokens: ["operator.delay.systemverilog", "keyword.other.systemverilog"]
            },
            {
                match: r`(##|#|@|\.|')`,
                tokens: ["operator.other.systemverilog"]
            },
            {
                match: r`(;)`,
                tokens: ["operator.semicolon.systemverilog"]
            },
            {
                match: r`(\\)`,
                tokens: ["operator.backslash.systemverilog"]
            }
        ]
    },

    SvPackage: {
        patterns: [
            {
                match: r`\b(package)\b`,
                tokens: ["keyword.package.systemverilog"],
                push: {
                    scopeName: "package.header.systemverilog",
                    patterns: [
                        {
                            match: r`(;)`,
                            tokens: ["operator.semicolon.systemverilog"],
                            pop: ""
                        },
                        { include: "AllAllow" },
                        { include: "Identifier" }
                    ]
                }
            }
        ]
    },

    SystemTask: {
        patterns: [
            {
                match: r`(\$[a-zA-Z_][a-zA-Z0-9_$]*\()`,
                tokens: ["system.task.systemverilog"],
                push: {
                    scopeName: "system.args.systemverilog",
                    patterns: [
                        {
                            match: r`(\))`,
                            tokens: ["system.end.systemverilog"],
                            pop: "",
                        },
                        { include: "BaseGrammar" }
                    ]
                }
            },
            {
                match: r`(\$[a-zA-Z_][a-zA-Z0-9_$]*)`,
                tokens: ["system.identifier.systemverilog"]
            }
        ]
    },

    TypeDefDeclaration: {
        patterns: [
            {
                match: r`\b(typedef)\b`,
                tokens: ["keyword.typedef.systemverilog"],
                push: {
                    scopeName: "typedef.declaration.systemverilog",
                    patterns: [
                        {
                            match: r`(;)`,
                            tokens: ["operator.semicolon.systemverilog"],
                            pop: ""
                        },
                        { include: "BaseGrammar" }
                    ]
                }
            }
        ]
    },

    TypeReference: {
        patterns: [
            {
                match: r`\b(type)\b`,
                tokens: ["keyword.type.systemverilog"],
                push: {
                    scopeName: "type.reference.systemverilog",
                    patterns: [
                        {
                            match: r`(\()`,
                            tokens: ["parantheses.begin.systemverilog"],
                            pop: {
                                scopeName: "type.expression.systemverilog",
                                patterns: [
                                    {
                                        match: r`(\))`,
                                        tokens: ["parantheses.end.systemverilog"],
                                        pop : ""
                                    },
                                    { include: "BaseGrammar" }
                                ]
                            }
                        },
                        { include: "AllAllow" }
                    ]
                }
            }
        ]
    },

    Whitespace: {
        patterns: [
            {
                match: r`((?:\s|\n|\r)+)`,
                tokens: ["meta.whitespace.systemverilog"]
            }
        ]
    }
};
