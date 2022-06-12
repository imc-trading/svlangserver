const rules = {
    source_file: $ => repeat($._description),

    comment: $ => token(choice(
        seq('//', /.*/),
        seq(
            '/*',
            /[^*]*\*+([^/*][^*]*\*+)*/,
            '/'
        )
    )),

    _description: $ => choice(
        $.double_quoted_string,
        $.macro_identifier,
        $.system_identifier,
        $.escaped_or_simple_identifier,
        $.array_identifier,
        $.parametrized_identifier,
        $.scoped_identifier,
        $.hierarchical_identifier,
        $.scoped_and_hierarchical_identifier,
        $.rest
    ),

    double_quoted_string: $ => seq(
        '"',
        repeat(choice(
            token.immediate(/\\\n/),
            token.immediate(/\\./),
            token.immediate(/[^"\\]+/)
        )),
        '"'
    ),

    macro_identifier: $ => choice(
        /`\\\S+(\s|\n|\r)/,
        /`[a-zA-Z0-9_][a-zA-Z0-9_$]*/
    ),

    system_identifier: $ => /\$[a-zA-Z0-9_$]+/,

    escaped_or_simple_identifier: $ => choice(
        $._escaped_identifier,
        $._simple_identifier
    ),

    _escaped_identifier: $ => 
        /\\\S+(\s|\n|\r)/,

    _simple_identifier: $ =>
        /[a-zA-Z_][a-zA-Z0-9_$]*/,

    array_identifier: $ => $._array_identifier,

    _array_identifier: $ => choice(
        prec(4, seq($.escaped_or_simple_identifier, $.constant_bit_select)),
        prec(4, seq($._array_identifier, $.constant_bit_select))
    ),

    constant_bit_select: $ => seq(
        '[',
        repeat($._description),
        ']'
    ),

    parametrized_identifier: $ => $._parametrized_identifier,

    _parametrized_identifier: $ => choice(
        prec(4, seq($.escaped_or_simple_identifier, $.parameter_value_assignment)),
        prec(4, seq($._parametrized_identifier, $.parameter_value_assignment))
    ),

    parameter_value_assignment: $ => seq(
        '#',
        '(',
        repeat($._description),
        ')',
    ),

    scoped_identifier: $ => prec(2, choice(
        $._unit_scoped_identifier,
        $._non_unit_scoped_identifier,
    )),

    _unit_scoped_identifier: $ => prec(3, choice(
        seq('$unit', $._scoping_operator, $._parametrizable_identifier),
        seq($._unit_scoped_identifier, $._scoping_operator, $._parametrizable_identifier)
    )),

    _non_unit_scoped_identifier: $ => prec(3, choice(
        seq($._parametrizable_identifier, $._scoping_operator, $._parametrizable_identifier),
        seq($._non_unit_scoped_identifier, $._scoping_operator, $._parametrizable_identifier)
    )),

    _scoping_operator: $ => '::',

    _parametrizable_identifier: $ => choice(
        $.escaped_or_simple_identifier,
        $._parametrized_identifier
    ),

    hierarchical_identifier: $ => prec(2, choice(
        $._root_hierarchical_identifier,
        $._non_root_hierarchical_identifier
    )),

    _root_hierarchical_identifier: $=> prec(3, choice(
        seq('$root', $._hierarchy_separator, $._dimensional_identifier),
        seq($._root_hierarchical_identifier, $._hierarchy_separator, $._dimensional_identifier),
    )),

    _non_root_hierarchical_identifier: $ => prec(3, choice(
        seq($._dimensional_identifier, $._hierarchy_separator, $._dimensional_identifier),
        seq($._non_root_hierarchical_identifier, $._hierarchy_separator, $._dimensional_identifier)
    )),

    _hierarchy_separator: $ => '.',

    _dimensional_identifier: $ => choice(
        $.escaped_or_simple_identifier,
        $._array_identifier
    ),

    scoped_and_hierarchical_identifier: $ => choice(
        seq('$unit', $._scoping_operator, $._non_root_hierarchical_identifier),
        seq($._unit_scoped_identifier, $._scoping_operator, $._non_root_hierarchical_identifier),
        seq($._parametrizable_identifier, $._scoping_operator, $._non_root_hierarchical_identifier),
        seq($._non_unit_scoped_identifier, $._scoping_operator, $._non_root_hierarchical_identifier)
    ),

    rest: $ => choice(
        $.constant_bit_select,
        $._parantheses_block,
        /[^\s\n\r\/"\\a-zA-Z_$`\[\]()]+/,
        /\/[^\/]/,
        /\\(\s|\n|\r)/                  //empty escaped identifier
    ),

    _parantheses_block: $ => seq(
        '(',
        repeat($._description),
        ')'
    )
};

module.exports = grammar({
    name: 'svidentifiers',
    rules: rules,
    extras: $ => [/(\s|\n|\r)+/, $.comment],
});
