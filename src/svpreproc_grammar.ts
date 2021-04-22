import {
    r
} from './grammar_engine';

const idRegExp: string = r`[a-zA-Z_][0-9a-zA-Z_$]*|\\\S+(?:\s|\n|\r|$)`;

export const svpreproc_grammar = {
    Main: {
        scopeName: "preproc.systemverilog",
        patterns: [
            { include: "All" }
        ]
    },

    All: {
        patterns: [
            {
                match: r`(,)`,
                tokens: ["operator.comma.systemverilog"]
            },
            {
                match: r`(=)`,
                tokens: ["operator.equals.systemverilog"]
            },
            {
                match: r`(` + idRegExp + r`)`,
                tokens: ["identifier.regular.systemverilog"]
            },
            {
                match: r`([0-9]+)`,
                tokens: ["literal.number.systemverilog"]
            },
            {
                match: r`(\`(?:` + idRegExp + r`))`,
                tokens: ["meta.macro.systemverilog"]
            },
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
            },
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
            },
            {
                match: r`(//.*(?:\n|\r))`,
                tokens: ["comment.line.systemverilog"]
            },
            {
                match: r`(/\*(?:.|\n|\r)*?(?:\*/|$))`,
                tokens: ["comment.block.systemverilog"],
            },
            {
                match: r`(\()`,
                tokens: ["parantheses.open.systemverilog"],
                pushScopes: ["parantheses.body.systemverilog"]
            },
            {
                match: r`(\))`,
                tokens: ["parantheses.close.systemverilog"],
                popScopes: ["parantheses.body.systemverilog"]
            },
            {
                match: r`(\{)`,
                tokens: ["braces.open.systemverilog"],
                pushScopes: ["braces.body.systemverilog"]
            },
            {
                match: r`(\})`,
                tokens: ["braces.close.systemverilog"],
                popScopes: ["braces.body.systemverilog"]
            },
            {
                match: r`(\[)`,
                tokens: ["bracket.open.systemverilog"],
                pushScopes: ["bracket.body.systemverilog"]
            },
            {
                match: r`(\])`,
                tokens: ["bracket.close.systemverilog"],
                popScopes: ["bracket.body.systemverilog"]
            },
            {
                match: r`((?:\s|\n|\r)+)`,
                tokens: ["meta.whitespace.systemverilog"]
            },
            {
                match: r`(===|!==|==|!=|<=|>=|<<|>>|<|>)`,
                tokens: ["operator.comparison.systemverilog"]
            },
            {
                match: r`(->[>]?)`,
                tokens: ["operator.trigger.systemverilog"]
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
                match: r`(&|\||\^|~)`,
                tokens: ["operator.bitwise.systemverilog"]
            },
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
    }
}
