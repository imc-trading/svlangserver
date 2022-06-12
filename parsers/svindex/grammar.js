function get_statement_symbol($, keyword_symbol) {
    return seq(
        keyword_symbol,
        repeat($.base_grammar),
        $.semicolon_operator
    );
}

function get_end_symbol($, end_keyword_symbol) {
    return seq(
        end_keyword_symbol,
        optional(seq($.colon_operator, $._escaped_or_simple_identifier))
    );
}

function get_base_grammar($, exclusion) {
    let canExclude = (sym) => {
        if (!exclusion) {
            return false;
        }
        else if (exclusion.length == 1) {
            return sym == exclusion;
        }
        else {
            return exclusion.indexOf(sym) >= 0;
        }
    };
    let symlist = [
        ["double_quoted_string"  , $.double_quoted_string  ],
        ["attribute_instance"    , $.attribute_instance    ],
        ["numeric_literal"       , $.numeric_literal       ],
        ["identifier"            , $.identifier            ],
        ["simple_operators"      , $.simple_operators      ],
        ["slashed_operators"     , $.slashed_operators     ],
        ["event_control_operator", $.event_control_operator],
        ["event_trigger_operator", $.event_trigger_operator],
        ["hash_operator"         , $.hash_operator         ],
        ["comma_operator"        , $.comma_operator        ],
        ["dot_operator"          , $.dot_operator          ],
        ["square_brackets_block" , $.square_brackets_block ],
        ["curly_brackets_block"  , $.curly_brackets_block  ],
        ["parantheses_block"     , $.parantheses_block     ],
        ["hash_parantheses_block", $.hash_parantheses_block],
        ["event_control_block"   , $.event_control_block   ],
    ];
    return choice.apply(null, symlist.filter(s => !canExclude(s[0])).map(s => s[1]));
}

function get_list_of($, item_symbol) {
    return prec.left(seq(
        item_symbol,
        repeat(seq($.comma_operator, item_symbol)),
    ));
}

function get_implicit_data_type($) {
    return seq(optional($.signing), repeat($.square_brackets_block));
}

function get_data_type_or_implicit($) {
    return choice($.data_type, get_implicit_data_type($));
}

function get_net_port_type($) {
    return choice(
        seq(optional($.net_type), get_data_type_or_implicit($)), // covers net_type_identifier
        seq($.interconnect_keyword, get_implicit_data_type($)),
    );
}

function get_net_port_header($) {
    return seq(optional($.port_direction), get_net_port_type($));
}

function get_function_data_type_or_implicit($) {
    return choice($.data_type_or_void, get_implicit_data_type($));
}

const rules = {
    source_file: $ => repeat($._description),

    comment: $ => token(choice(
        seq('//', /.*(\n|\r)?/),
        seq(
            '/*',
            /[^*]*\*+([^/*][^*]*\*+)*/,
            '/'
        )
    )),

    macro_identifier: $ => token(choice(
        /`\\\S+(\s|\n|\r)?/,
        /`[a-zA-Z0-9_][a-zA-Z0-9_$]*/
    )),

    // A.1.2
    _description: $ => choice(
        $.timeunits_declaration,
        $.module_declaration,
        $.udp_declaration,
        $.interface_declaration,
        $.program_declaration,
        $.package_declaration,
        $._unique_package_item,
        $.bind_directive,
        $.config_declaration,
        $._base_grammar_or_semicolon, // covers: custom_type net_declaration, implicit/custom_type data_declaration, null_statement //seq(repeat($.attribute_instance), repeat(seq(get_base_grammar($, ["attribute_instance"]), repeat($.attribute_instance))), $.semicolon_operator)
    ),

    module_declaration: $ => choice(
        seq($.module_header, repeat($.module_item), $.endmodule_declaration),
        seq($.extern_keyword, repeat($.attribute_instance), $.module_header),
    ),

    endmodule_declaration: $ => get_end_symbol($, $.endmodule_keyword),

    module_header: $ => // covers module_ansi_header and module_nonansi_header
        seq($.module_keyword, optional($.lifetime), $._escaped_or_simple_identifier,
            repeat($.package_import_declaration), optional($.parameter_port_list), optional(choice($.list_of_port_declarations, $.empty_port_declaration)), $.semicolon_operator),

    timeunits_declaration: $ => get_statement_symbol($, $.timeunits_keyword),

    checker_declaration: $ => seq(
        $.checker_keyword, $._escaped_or_simple_identifier, optional($.parantheses_block), $.semicolon_operator,
        repeat(seq(repeat($.attribute_instance), $.checker_or_generate_item)),
        $.endchecker_declaration,
    ),

    endchecker_declaration: $ => get_end_symbol($, $.endchecker_keyword),

    package_declaration: $ => seq(
        $.package_header,
        repeat(seq(repeat($.attribute_instance), $.package_item)),
        $.endpackage_declaration,
    ),

    package_header: $ => seq(
        $.package_keyword, optional($.lifetime), $._escaped_or_simple_identifier, $.semicolon_operator,
    ),

    endpackage_declaration: $ => get_end_symbol($, $.endpackage_keyword),

    interface_declaration: $ => choice(
        seq($.interface_header, repeat($.interface_item), $.endinterface_declaration),
        seq($.extern_keyword, repeat($.attribute_instance), $.interface_header)
    ),

    endinterface_declaration: $ => get_end_symbol($, $.endinterface_keyword),

    interface_header: $ =>
        seq($.interface_keyword, optional($.lifetime), $._escaped_or_simple_identifier,
            repeat($.package_import_declaration), optional($.parameter_port_list), optional(choice($.list_of_port_declarations, $.empty_port_declaration)), $.semicolon_operator),

    program_declaration: $ => choice(
        seq($.program_header, repeat($._program_item), $.endprogram_declaration),
        seq($.extern_keyword, repeat($.attribute_instance), $.program_header),
    ),

    endprogram_declaration: $ => get_end_symbol($, $.endprogram_keyword),

    program_header: $ =>
        seq($.program_keyword, optional($.lifetime), $._escaped_or_simple_identifier,
            repeat($.package_import_declaration), optional($.parameter_port_list), optional(choice($.list_of_port_declarations, $.empty_port_declaration)), $.semicolon_operator),

    class_declaration: $ => seq(
        optional($.virtual_keyword), $.class_keyword, $.lifetime, $._escaped_or_simple_identifier, optional($.parameter_port_list),
        optional(seq($.extends_keyword, $._custom_type, optional($.parantheses_block))),
        optional(seq($.implements_keyword, $._interface_class_type_list)), $.semicolon_operator,
        repeat($.class_item),
        $.endclass_declaration,
    ),

    _interface_class_type_list: $ => get_list_of($, $.interface_class_type),

    endclass_declaration: $ => get_end_symbol($, $.endclass_keyword),

    interface_class_type : $ => seq($.package_scope, $._escaped_or_simple_identifier, optional($.parameter_value_assignment)),

    // A.1.3
    port_declaration: $ => choice(
        seq(repeat($.attribute_instance), $.inout_declaration),
        seq(repeat($.attribute_instance), $.input_declaration),
        seq(repeat($.attribute_instance), $.output_declaration),
        seq(repeat($.attribute_instance), $.ref_declaration),
    ),

    parameter_port_list: $ => choice(
        seq($.hash_operator, $.open_parantheses, $._list_of_param_assignments, repeat(seq($.comma_operator, $._parameter_port_declaration)), $.close_parantheses),
        seq($.hash_operator, $.open_parantheses, $._list_of_parameter_port_declaration, $.close_parantheses),
        seq($.hash_operator, $.open_parantheses, $.close_parantheses)
    ),

    _parameter_port_declaration: $ => choice(
        $.parameter_declaration,
        $.localparam_declaration,
        seq($.data_type, $._list_of_param_assignments),
        seq($.type_keyword, $._list_of_type_assignments)
    ),

    _list_of_parameter_port_declaration: $ => get_list_of($, $._parameter_port_declaration),

    list_of_port_declarations: $ => // covers list_of_ports
        seq($.open_parantheses, optional($._ansi_or_non_ansi_port_declarations_list), $.close_parantheses),

    empty_port_declaration: $ => seq($.open_parantheses, $.dot_operator, $.star_operator, $.close_parantheses),

    _ansi_or_non_ansi_port_declarations_list: $ => get_list_of($, $.ansi_or_nonansi_port_declaration),

    ansi_or_nonansi_port_declaration: $ => seq(repeat($.attribute_instance), choice( // covers ansi_port_declaration and port
        seq(optional(choice(get_net_port_header($), $.variable_port_header, $.interface_port_header)), $._dimensional_identifier, optional(seq($.equals_operator, $.constant_expression))),
        seq(optional($.port_direction), $.dot_operator, $._escaped_or_simple_identifier, $.parantheses_block),
        $.curly_brackets_block,
    )),

    variable_port_header: $ => seq(optional($.port_direction), $.variable_port_type),
    interface_port_header: $ => choice(
        seq($._escaped_or_simple_identifier, $.dot_operator, $._escaped_or_simple_identifier),
        seq($.interface_keyword, $.dot_operator, $._escaped_or_simple_identifier),
    ),

    port_direction: $ => choice($.input_keyword, $.output_keyword, $.inout_keyword, $.ref_keyword),

    // A.1.4
    module_item: $ => choice(
        seq($.port_declaration, $.semicolon_operator),
        $.non_port_module_item,
    ),

    non_port_module_item: $ => choice(
        $.generate_region,
        $.module_or_generate_item,
        $.specify_block,
        seq(repeat($.attribute_instance), $.specparam_declaration),
        $.program_declaration,
        $.module_declaration,
        $.interface_declaration,
        $.timeunits_declaration
    ),

    module_or_generate_item: $ => choice(
        seq(repeat($.attribute_instance), $.parameter_override),
        seq(repeat($.attribute_instance), $.gate_instantiation),
        seq(repeat($.attribute_instance), $.module_common_item),
        $.base_module_or_generate_item_statement, // covers: udp_instantiation, module_instantiation, custom_type net_declaration, implicit/custom_type data_declaration, interface_instantiation, program_instantiation, checker_instantiation, null_statement
    ),

    base_module_or_generate_item_statement: $ => seq(repeat($.attribute_instance), repeat($._base_grammar_without_attributes), $.semicolon_operator),

    module_common_item: $ => choice(
        $.module_or_generate_item_declaration,
        $.assertion_item,
        $.bind_directive,
        $.continuous_assign,
        $.net_alias,
        $.initial_construct,
        $.final_construct,
        $.always_construct,
        $.loop_generate_construct,
        $.conditional_generate_construct,
    ),

    module_or_generate_item_declaration: $ => choice(
        $.package_or_generate_item_declaration,
        $.genvar_declaration,
        $.clocking_declaration,
        $.default_clocking_declaration,
        $.default_disable_declaration,
    ),

    default_clocking_declaration: $ =>
        seq($.default_keyword, $.clocking_keyword, $._escaped_or_simple_identifier, $.semicolon_operator),

    default_disable_declaration: $ =>
        seq($.default_keyword, $.disable_keyword, $.iff_keyword, repeat($.base_grammar), $.semicolon_operator),

    bind_directive: $ => get_statement_symbol($, $.bind_keyword),

    parameter_override: $ => get_statement_symbol($, $.defparam_keyword),

    elaboration_system_task: $ => choice(
        $._fatal_system_task,
        $._error_system_task,
        $._warning_system_task,
        $._info_system_task,
    ),

    _fatal_system_task: $ => get_statement_symbol($, $.fatal_system_keyword),
    _error_system_task: $ => get_statement_symbol($, $.error_system_keyword),
    _warning_system_task: $ => get_statement_symbol($, $.warning_system_keyword),
    _info_system_task: $ => get_statement_symbol($, $.info_system_keyword),

    // A.1.5
    config_declaration: $ => seq(
        $.config_keyword, $._escaped_or_simple_identifier, $.semicolon_operator,
        repeat(seq($.localparam_declaration, $.semicolon_operator)),
        $.design_statement,
        repeat($.config_rule_statement),
        $.endconfig_declaration,
    ),

    endconfig_declaration: $ => get_end_symbol($, $.endconfig_keyword),

    design_statement: $ =>
        seq($.design_keyword, repeat(seq(optional(seq($._escaped_or_simple_identifier, $.dot_operator)), $._escaped_or_simple_identifier)), $.semicolon_operator),

    config_rule_statement: $ => choice(
        $._config_rule_default_statement,
        $._config_rule_instance_statement,
        $._config_rule_cell_statement,
    ),

    _config_rule_default_statement: $ => get_statement_symbol($, $.default_keyword),
    _config_rule_instance_statement: $ => get_statement_symbol($, $.instance_keyword),
    _config_rule_cell_statement: $ => get_statement_symbol($, $.cell_keyword),

    // A.1.6
    unique_interface_or_generate_item: $ => choice(
        seq(repeat($.attribute_instance), $.extern_tf_declaration),
    ),

    interface_or_generate_item: $ => choice(
        seq(repeat($.attribute_instance), $.module_common_item),
        seq(repeat($.attribute_instance), $.extern_tf_declaration),
        $.base_module_or_generate_item_statement, // covers: custom_type net_declaration, implicit/custom_type data_declaration, interface_instantiation, program_instantiation, checker_instantiation, null_statement
    ),

    extern_tf_declaration: $ => choice(
        seq($.extern_keyword, $.method_prototype, $.semicolon_operator),
        seq($.extern_keyword, $.forkjoin_keyword, $.task_prototype, $.semicolon_operator),
    ),

    interface_item: $ => choice(
        seq($.port_declaration, $.semicolon_operator),
        $.non_port_interface_item,
    ),

    non_port_interface_item: $ => choice(
        $.generate_region,
        $.interface_or_generate_item,
        $.program_declaration,
        $.modport_declaration,
        $.interface_declaration,
        $.timeunits_declaration,
    ),

    // A.1.7
    _program_item: $ => choice(
        seq($.port_declaration, $.semicolon_operator),
        $.non_port_program_item,
    ),

    non_port_program_item: $ => choice(
        seq(repeat($.attribute_instance), $.continuous_assign),
        seq(repeat($.attribute_instance), $.module_or_generate_item_declaration),
        seq(repeat($.attribute_instance), $.initial_construct),
        seq(repeat($.attribute_instance), $.final_construct),
        seq(repeat($.attribute_instance), $.concurrent_assertion_item),
        $.timeunits_declaration,
        $.program_generate_item,
        $._base_generic_expression, // covers: custom_type net_declaration, implicit/custom_type data_declaration, checker_instantiation, null_statement
    ),

    program_generate_item: $ => choice(
        $.loop_generate_construct,
        $.conditional_generate_construct,
        $.generate_region,
    ),

    // A.1.8
    unique_checker_or_generate_item: $ => choice(
        seq($.rand_keyword, $.data_declaration),
        $.generate_region,
        $.elaboration_system_task,
    ),

    checker_or_generate_item: $ => choice(
        $.explicit_data_declaration,
        $.checker_or_generate_item_declaration,
        $.initial_construct,
        $.always_construct,
        $.final_construct,
        $.assertion_item,
        $.continuous_assign,
        $.checker_generate_item,
    ),

    checker_or_generate_item_declaration: $ => choice(
        $.function_declaration,
        $.checker_declaration,
        $.assertion_item_declaration,
        $.covergroup_declaration,
        $.genvar_declaration,
        $.clocking_declaration,
        seq($.default_keyword, $.clocking_keyword, $._escaped_or_simple_identifier, $.semicolon_operator),
        seq($.default_keyword, $.disable_keyword, $.iff_keyword, repeat($.base_grammar), $.semicolon_operator),
        $._base_generic_expression_without_attributes, // covers: udp_instantiation, module_instantiation, custom_type net_declaration, implicit/custom_type data_declaration, interface_instantiation, program_instantiation, checker_instantiation, null_statement
    ),

    checker_generate_item: $ => choice(
        $.loop_generate_construct,
        $.conditional_generate_construct,
        $.unique_checker_or_generate_item,
    ),

    // A.1.9
    random_qualifier: $ => choice($.rand_keyword, 'randc'),

    method_prototype: $ => choice($.task_prototype, $.function_prototype),

    class_item : $ => choice(
        seq(repeat($.attribute_instance), $.class_property),
        seq(repeat($.attribute_instance), $.class_method),
        seq(repeat($.attribute_instance), $.class_constraint),
        seq(repeat($.attribute_instance), $.covergroup_declaration),
        seq($.localparam_declaration, $.semicolon_operator),
        seq($.parameter_declaration, $.semicolon_operator),
        $._base_generic_expression, // covers: custom_type class_property, null_statement
    ),

    class_property: $ => choice(
        seq(repeat($.property_qualifier), $.explicit_data_declaration),
        seq($.const_keyword, repeat1($.class_item_qualifier), $.data_type, $._escaped_or_simple_identifier, $.equals_operator, repeat($.base_grammar), $.semicolon_operator),
    ),

    class_constraint: $ => choice(
        $.constraint_prototype,
        $.constraint_declaration,
    ),

    property_qualifier: $ => prec(1, choice($.random_qualifier, $.class_item_qualifier)), // higher precedence than lifetime
    class_item_qualifier: $ => prec(1, choice($.static_keyword, $.protected_keyword, $.local_keyword)), // higher precedence than lifetime

    class_method: $ => choice(
        seq(repeat($.impure_method_qualifier), $.task_declaration),
        seq(repeat($.impure_method_qualifier), $.function_declaration), // covers class_constructor_declaration
        seq($.pure_keyword, $.virtual_keyword, repeat($.class_item_qualifier), $.method_prototype, $.semicolon_operator),
        seq($.extern_keyword, repeat($.method_qualifier), $.method_prototype, $.semicolon_operator),
        $.class_constructor_prototype,
    ),

    class_constructor_prototype: $ =>
        seq($.function_keyword, $.new_keyword, $.open_parantheses, optional($._tf_port_list), $.close_parantheses, $.semicolon_operator),

    impure_method_qualifier: $ => choice($.virtual_keyword, $.class_item_qualifier),
    method_qualifier: $ => choice(seq(optional($.pure_keyword), $.virtual_keyword), $.class_item_qualifier),

    // A.1.10
    extern_constraint_declaration: $ =>
        seq(optional($.static_keyword), $.constraint_keyword, $.class_scope, $.constraint_identifier, $.curly_brackets_block),

    constraint_prototype: $ => seq(optional(choice($.extern_keyword, $.pure_keyword)), optional($.static_keyword), $.constraint_keyword, $._escaped_or_simple_identifier, $.semicolon_operator),

    constraint_declaration: $ => seq(optional($.static_keyword), $.constraint_keyword, $._escaped_or_simple_identifier, $.curly_brackets_block),

    // A.1.11
    package_or_generate_item_declaration: $ => choice(
        $.net_declaration,
        $.explicit_data_declaration,
        $.task_declaration,
        $.function_declaration, // covers: class_constructor_declaration
        $.checker_declaration,
        $.dpi_import_export,
        $.extern_constraint_declaration,
        $.class_declaration,
        seq($.localparam_declaration, $.semicolon_operator),
        seq($.parameter_declaration, $.semicolon_operator),
        $.covergroup_declaration,
        $.assertion_item_declaration,
    ),

    _unique_package_item: $ => choice(
        $.package_or_generate_item_declaration,
        $.anonymous_program,
        $.package_export_declaration,
    ),

    package_item: $ => choice(
        $.package_or_generate_item_declaration,
        $.anonymous_program,
        $.package_export_declaration,
        $.timeunits_declaration,
        $._base_generic_expression_without_attributes, // covers: udp_instantiation, module_instantiation, custom_type net_declaration, implicit/custom_type data_declaration, interface_instantiation, program_instantiation, checker_instantiation, null_statement
    ),

    anonymous_program: $ => seq($.program_keyword, $.semicolon_operator, repeat($.anonymous_program_item), $.endprogram_keyword),
    anonymous_program_item: $ => choice(
        $.task_declaration,
        $.function_declaration, // covers: class_constructor_declaration,
        $.class_declaration,
        $.covergroup_declaration,
        $.semicolon_operator, //null_statement
    ),

    // A.2.1.1
    parameter_declaration: $ => choice(
        $.parameter_nontype_declaration,
        $.parameter_type_declaration,
    ),

    parameter_nontype_declaration: $ => seq($.parameter_keyword, get_data_type_or_implicit($), $._list_of_param_assignments),
    parameter_type_declaration: $ => seq($.parameter_keyword, $.type_keyword, $._list_of_type_assignments),

    localparam_declaration: $ => choice(
        $.localparam_nontype_declaration,
        $.localparam_type_declaration,
    ),

    localparam_nontype_declaration: $ => seq($.localparam_keyword, get_data_type_or_implicit($), $._list_of_param_assignments),
    localparam_type_declaration: $ => seq($.localparam_keyword, $.type_keyword, $._list_of_type_assignments),

    specparam_declaration: $ => get_statement_symbol($, $.specparam_keyword),

    // A.2.1.2
    inout_declaration: $ => seq($.inout_keyword, get_net_port_type($), $._unpacked_array_list),
    input_declaration: $ => seq($.input_keyword, choice(get_net_port_type($), $.variable_port_type), $._unpacked_array_list),
    output_declaration: $ => seq($.output_keyword, choice(get_net_port_type($), $.variable_port_type), $._unpacked_array_list),
    ref_declaration: $ => seq($.ref_keyword, $.variable_port_type, $._unpacked_array_list),

    _unpacked_array_list: $ => get_list_of($, $._dimensional_identifier),

    // A.2.1.3
    package_import_declaration: $ => seq($.import_keyword, $._package_import_item_list, $.semicolon_operator),
    _package_import_item_list: $ => get_list_of($, $._package_import_item),
    _package_import_item: $ => choice(
        seq($._escaped_or_simple_identifier, $.double_colon_operator, $._escaped_or_simple_identifier),
        seq($._escaped_or_simple_identifier, $.double_colon_operator, $.star_operator),
    ),

    genvar_declaration: $ =>
        seq($.genvar_keyword, $._genvars_list, $.semicolon_operator),

    _genvars_list: $ => get_list_of($, $._escaped_or_simple_identifier),

    net_declaration: $ => choice(
        $._net_type_statement,
        $._interconnect_statement,
    ),

    _net_type_statement: $ => seq(
        $.net_type, optional($.parantheses_block), optional(choice($.vectored_keyword, $.scalared_keyword)), 
        get_data_type_or_implicit($), optional($.delay3), $._list_of_net_decl_assignments, $.semicolon_operator,
    ),

    _interconnect_statement: $ => seq($.interconnect_keyword, get_implicit_data_type($), optional(seq($.hash_operator, $.delay_value)), $.net_identifier, repeat($.square_brackets_block), optional(seq($.comma_operator, $.net_identifier, repeat($.square_brackets_block))), $.semicolon_operator),

    explicit_data_declaration: $ => choice(
        seq($.explicit_data_indicator, get_data_type_or_implicit($), $.list_of_variable_decl_assignments, $.semicolon_operator),
        seq($.explicit_data_type, $.list_of_variable_decl_assignments, $.semicolon_operator),
        $.type_declaration,
        $.package_import_declaration,
        $.net_type_declaration,
    ),

    explicit_data_type: $ => $._explicit_data_type,

    data_declaration: $ => choice(
        seq(optional($.const_keyword), optional($.var_keyword), optional($.lifetime), get_data_type_or_implicit($), $.list_of_variable_decl_assignments, $.semicolon_operator),
        $.type_declaration,
        $.package_import_declaration,
        $.net_type_declaration,
    ),

    explicit_data_indicator: $ => choice(
        seq($.const_keyword, optional($.var_keyword), optional($.lifetime)),
        seq($.var_keyword, optional($.lifetime)),
        $.lifetime
    ),

    type_declaration: $ => choice($.typedef1_declaration, $.typedef2_declaration, $.typedef3_declaration),

    typedef1_declaration: $ => seq($.typedef_keyword, $.data_type, $._dimensional_identifier, $.semicolon_operator),
    typedef2_declaration: $ => seq($.typedef_keyword, $._dimensional_identifier, $.dot_operator, $._escaped_or_simple_identifier, $._escaped_or_simple_identifier, $.semicolon_operator),
    typedef3_declaration: $ => seq($.typedef_keyword, optional(choice($.enum_keyword, $.struct_keyword, $.union_keyword, $.class_keyword, seq($.interface_keyword, $.class_keyword))), $._escaped_or_simple_identifier, $.semicolon_operator),

    net_type_declaration: $ => choice(
        seq($.nettype_keyword, $.data_type, $.net_type_identifier, optional(seq($.with_keyword, optional(choice($.package_scope, $.class_scope)), $.tf_identifier)), $.semicolon_operator),
        seq($.nettype_keyword, optional(choice($.package_scope, $.class_scope)), $.net_type_identifier, $.net_type_identifier, $.semicolon_operator),
    ),

    package_export_declaration: $ => choice(
        seq($.export_keyword, $.star_operator, $.double_colon_operator, $.star_operator, $.semicolon_operator),
        seq($.export_keyword, $._package_import_item_list, $.semicolon_operator),
    ),

    lifetime: $ => choice($.static_keyword, $.automatic_keyword),

    // A.2.2.1
    net_type: $ => choice('supply0', 'supply1', 'tri', 'triand', 'trior', 'trireg', 'tri0', 'tri1', 'uwire', 'wire', 'wand', 'wor'),

    signing: $ => choice('signed', 'unsigned'),

    variable_port_type: $ => prec.left(choice($.data_type, seq($.var_keyword, get_data_type_or_implicit($)))),

    _custom_type: $ => choice(
        seq(optional(choice($.class_scope, $.package_scope)), $._dimensional_identifier),
        $.class_type, // covers ps_covergroup_identifier
    ),

    data_type: $ => choice(
        $._explicit_data_type,
        $._custom_type,
    ),

    _explicit_data_type: $ => choice(
        seq($.integer_vector_type, optional($.signing), repeat($.square_brackets_block)),
        seq($.integer_atom_type, optional($.signing)),
        $.non_integer_type,
        seq($.struct_union, optional(seq($.packed_keyword, optional($.signing))), $.open_curly_braces, repeat1($.struct_union_member), $.close_curly_braces, repeat($.square_brackets_block)),
        seq($.enum_keyword, optional($.enum_base_type), $.open_curly_braces, $._enum_name_declarations_list, $.close_curly_braces, repeat($.square_brackets_block)),
        $.string_keyword,
        $.chandle_keyword,
        prec.right(seq($.virtual_keyword, optional($.interface_keyword), $._escaped_or_simple_identifier, optional($.parameter_value_assignment), optional(seq($.dot_operator, $._escaped_or_simple_identifier)))), // prec.right because collides with net_type delay3
        $.event_keyword,
        $.type_reference,
    ),

    data_type_or_void: $ => choice($.data_type, $.void_keyword),

    struct_union: $ => seq(choice($.struct_keyword, $.union_keyword), optional($.tagged_keyword)),
    struct_union_member: $ => seq(
        repeat($.attribute_instance),
        optional($.random_qualifier),
        $.data_type_or_void,
        $.list_of_variable_decl_assignments,
        $.semicolon_operator
    ),

    enum_base_type: $ => choice(
        seq($.integer_atom_type, optional($.signing)),
        seq($.integer_vector_type, optional($.signing), optional($.square_brackets_block)),
        seq($._escaped_or_simple_identifier, optional($.square_brackets_block))
    ),
    enum_name_declaration: $ => seq($._escaped_or_simple_identifier, optional(seq($.open_square_brackets, $.integral_number, optional(seq($.colon_operator, $.integral_number)), $.close_square_brackets)), optional(seq($.equals_operator, $.constant_expression))),
    _enum_name_declarations_list: $ => get_list_of($, $.enum_name_declaration),

    type_reference: $ => seq($.type_keyword, $.parantheses_block),

    integer_vector_type: $ => choice('bit', 'logic', 'reg'),
    integer_atom_type: $ => choice('byte', 'shortint', 'int', 'longint', 'integer', 'time'),
    non_integer_type: $ => choice('shortreal', 'real', 'realtime'),

    class_scope: $ => seq($.class_type, $.double_colon_operator),

    class_type: $ => prec.left(seq(
        $.ps_identifier, optional($.parameter_value_assignment), repeat(seq($.double_colon_operator, $._escaped_or_simple_identifier, optional($.parameter_value_assignment))),
    )),

    // A.2.2.3
    delay3: $ => seq($.hash_operator, choice($.delay_value, $.parantheses_block)),

    delay_value: $ => choice(
        $.unsigned_number,
        $.real_number,
        $.ps_identifier,
        $.time_literal,
        $.one_step_keyword,
    ),

    // A.2.3
    _list_of_param_assignments: $ => get_list_of($, $.param_assignment),
    _list_of_type_assignments: $ => get_list_of($, $.type_assignment),
    list_of_variable_decl_assignments: $ => get_list_of($, $.variable_decl_assignment),
    list_of_tf_variable_identifiers: $ => get_list_of($, seq($._dimensional_identifier, optional(seq($.equals_operator, $.expression)))),
    list_of_udp_port_identifiers: $ => get_list_of($, $._escaped_or_simple_identifier),
    _list_of_net_decl_assignments: $ => get_list_of($, $.net_decl_assignment),

    // A.2.4
    param_assignment: $ => seq($._dimensional_identifier, optional(seq($.equals_operator, $.constant_param_expression))),
    type_assignment: $ => seq($._escaped_or_simple_identifier, optional(seq($.equals_operator, $.data_type))),

    variable_decl_assignment: $ => 
        seq($._dimensional_identifier, optional(seq($.equals_operator, $.expression))), // covers dynamic_array and class_new

    net_decl_assignment: $ => seq($.net_identifier, repeat($.square_brackets_block), optional(seq($.equals_operator, $.expression))),

    // A.2.6
    function_declaration: $ => seq($.function_keyword, optional($.lifetime), $.function_body_declaration),

    function_body_declaration: $ => choice(
        seq(
            $.function_non_port_header,
            repeat($._tf_item_declaration_or_statement_or_null),
            $.endfunction_declaration,
        ),
        seq(
            $.function_header,
            repeat($._block_item_declaration_or_statement_or_null),
            $.endfunction_declaration,
        ),
    ),

    endfunction_declaration: $ => get_end_symbol($, $.endfunction_keyword),

    function_non_port_header: $ => seq(
        get_function_data_type_or_implicit($),
        optional(choice(seq($._escaped_or_simple_identifier, $.dot_operator), $.class_scope)), $.function_identifier, $.semicolon_operator,
    ),

    function_header: $ => seq(
        get_function_data_type_or_implicit($),
        optional(choice(seq($._escaped_or_simple_identifier, $.dot_operator), $.class_scope)), $.function_identifier, $.open_parantheses, optional($._tf_port_list), $.close_parantheses, $.semicolon_operator,
    ),

    dpi_import_export: $ => choice(
        seq($.import_keyword, $.dpi_spec_string, optional(choice($.context_keyword, $.pure_keyword)), optional(seq($._escaped_or_simple_identifier, $.equals_operator)), $.function_prototype, $.semicolon_operator),
        seq($.import_keyword, $.dpi_spec_string, optional($.context_keyword), optional(seq($._escaped_or_simple_identifier, $.equals_operator)), $.task_prototype, $.semicolon_operator),
        seq($.export_keyword, $.dpi_spec_string, optional(seq($._escaped_or_simple_identifier, $.equals_operator)), $.function_keyword, $._escaped_or_simple_identifier, $.semicolon_operator),
        seq($.export_keyword, $.dpi_spec_string, optional(seq($._escaped_or_simple_identifier, $.equals_operator)), $.task_keyword, $._escaped_or_simple_identifier, $.semicolon_operator),
    ),

    dpi_spec_string: $ => choice("DPI-C", "DPI"),

    function_prototype: $ =>
        seq($.function_keyword, $.data_type_or_void, $._escaped_or_simple_identifier, optional(seq($.open_parantheses, optional($._tf_port_list), $.close_parantheses))),

    // A.2.7
    task_declaration: $ => seq($.task_keyword, optional($.lifetime), $.task_body_declaration),

    task_body_declaration: $ => choice(
        seq(
            $.task_non_port_header,
            repeat($._tf_item_declaration_or_statement_or_null),
            $.endtask_declaration,
        ),
        seq(
            $.task_header,
            repeat($._block_item_declaration_or_statement_or_null),
            $.endtask_declaration,
        ),
    ),

    endtask_declaration: $ => get_end_symbol($, $.endtask_keyword),

    task_non_port_header: $ =>
        seq(optional(choice(seq($._escaped_or_simple_identifier, $.dot_operator), $.class_scope)), $.task_identifier, $.semicolon_operator),

    task_header: $ =>
        seq(optional(choice(seq($._escaped_or_simple_identifier, $.dot_operator), $.class_scope)), $.task_identifier, $.open_parantheses, optional($._tf_port_list), $.close_parantheses, $.semicolon_operator),

    tf_item_declaration: $ => choice(
        $.block_item_declaration,
        $.tf_port_declaration,
    ),

    tf_port_declaration: $ =>
        seq(repeat($.attribute_instance), $.tf_port_direction, optional($.var_keyword), get_data_type_or_implicit($), $.list_of_tf_variable_identifiers, $.semicolon_operator),
    tf_port_direction: $ => choice($.port_direction, seq($.const_keyword, $.ref_keyword)),

    tf_port_item: $ => seq(
        repeat($.attribute_instance),
        optional($.tf_port_direction),
        optional($.var_keyword),
        get_data_type_or_implicit($),
        $._dimensional_identifier,
        optional(seq($.equals_operator, $.expression)),
    ),

    _tf_port_list: $ => get_list_of($, $.tf_port_item),

    task_prototype: $ =>
        seq($.task_keyword, $._escaped_or_simple_identifier, optional(seq($.open_parantheses, optional($._tf_port_list), $.close_parantheses))),

    // A.2.8
    block_item_declaration: $ => choice(
        seq(repeat($.attribute_instance), $.explicit_data_declaration),
        seq(repeat($.attribute_instance), $.localparam_declaration, $.semicolon_operator),
        seq(repeat($.attribute_instance), $.parameter_declaration, $.semicolon_operator),
        seq(repeat($.attribute_instance), $.let_declaration),
    ),

    // A.2.9
    modport_declaration: $ => seq($.modport_keyword, $._modport_items_list, $.semicolon_operator),
    modport_item: $ => seq($._escaped_or_simple_identifier, $.open_parantheses, get_list_of($, $.modport_ports_declaration), $.close_parantheses),
    modport_ports_declaration: $ => choice(
        seq(repeat($.attribute_instance), $.modport_simple_ports_declaration),
        seq(repeat($.attribute_instance), $.modport_tf_ports_declaration),
        seq(repeat($.attribute_instance), $.modport_clocking_declaration),
    ),
    modport_simple_ports_declaration: $ => seq($.port_direction, get_list_of($, $.modport_simple_port)),
    modport_simple_port: $ => choice($._escaped_or_simple_identifier, seq($.dot_operator, $._escaped_or_simple_identifier, $.parantheses_block)),
    modport_tf_ports_declaration: $ => seq(choice($.import_keyword, $.export_keyword), get_list_of($, $.modport_tf_port)),
    modport_tf_port: $ => choice($.method_prototype, $._escaped_or_simple_identifier),
    modport_clocking_declaration: $ => seq($.clocking_keyword, $._escaped_or_simple_identifier),

    _modport_items_list: $ => get_list_of($, $.modport_item),

    // A.2.10
    expect_property_statement: $ => seq($.expect_keyword, $.parantheses_block, $.action_block),

    concurrent_assertion_statement: $ => choice(
        $.assert_property_statement,
        $.assume_property_statement,
        $.cover_property_statement,
        $.cover_sequence_statement,
        $.restrict_property_statement,
    ),

    assert_property_statement: $ =>
        seq($.assert_keyword, $.property_keyword, $.parantheses_block, $.action_block),

    assume_property_statement: $ =>
        seq($.assume_keyword, $.property_keyword, $.parantheses_block, $.action_block),

    cover_property_statement: $ =>
        seq($.cover_keyword, $.property_keyword, $.parantheses_block, $.statement_or_null),

    cover_sequence_statement: $ =>
        seq($.cover_keyword, $.sequence_keyword, $.parantheses_block, $.statement_or_null),

    restrict_property_statement: $ =>
        seq($.restrict_keyword, $.property_keyword, $.parantheses_block, $.semicolon_operator),

    concurrent_assertion_item: $ => seq(optional(seq($._escaped_or_simple_identifier, $.colon_operator)), $.concurrent_assertion_statement),

    assertion_item_declaration: $ => choice(
        $.property_declaration,
        $.sequence_declaration,
        $.let_declaration,
    ),

    property_declaration: $ => seq(
        $.property_keyword, $._escaped_or_simple_identifier, optional($.parantheses_block), $.semicolon_operator,
        repeat($._base_grammar_or_semicolon),
        $.endproperty_declaration,
    ),

    endproperty_declaration: $ => get_end_symbol($, $.endproperty_keyword),

    sequence_declaration: $ => seq(
        $.sequence_keyword, $._escaped_or_simple_identifier, optional($.parantheses_block), $.semicolon_operator,
        repeat($._base_grammar_or_semicolon),
        $.endsequence_declaration,
    ),

    endsequence_declaration: $ => get_end_symbol($, $.endsequence_keyword),

    assertion_variable_declaration: $ => seq($.variable_port_type, $.list_of_variable_decl_assignments, $.semicolon_operator),

    // A.2.11
    covergroup_declaration: $ => seq(
        $.covergroup_keyword, $._escaped_or_simple_identifier, optional($.parantheses_block), optional($.coverage_event), $.semicolon_operator,
        repeat($._base_grammar_or_semicolon),
        $.endcovergroup_declaration,
    ),

    endcovergroup_declaration: $ => get_end_symbol($, $.endgroup_keyword),

    coverage_event: $ => choice(
        $.clocking_event,
        seq($.with_keyword, $.function_keyword, $.sample_keyword, $.parantheses_block),
        seq($.event_control_operator, $.event_control_operator, $.parantheses_block),
    ),

    // A.2.12
    let_declaration: $ =>
        seq($.let_keyword, $._escaped_or_simple_identifier, optional(seq($.parantheses_block)), $.equals_operator, repeat($.base_grammar), $.semicolon_operator),

    // A.3.1
    gate_instantiation: $ => get_statement_symbol($, $.gate_type),
    gate_type: $ => choice(
        'cmos', 'rcmos',
        'bufif0', 'bufif1', 'notif0', 'notif1',
        'nmos', 'pmos', 'rnmos', 'rpmos',
        'and', 'nand', 'or', 'nor', 'xor', 'xnor',
        'buf', 'not',
        'tranif0', 'tranif1', 'rtranif1', 'rtranif0',
        'tran', 'rtran',
        'pulldown',
        'pullup',
    ),

    // A.4.1.1
    parameter_value_assignment: $ => seq($.hash_operator, $.open_parantheses, $.list_of_parameter_assignments, $.close_parantheses),
    list_of_parameter_assignments: $ => choice(
        seq($.ordered_parameter_assignment, repeat(seq($.comma_operator, $.ordered_parameter_assignment))),
        seq($.named_parameter_assignment, repeat(seq($.comma_operator, $.named_parameter_assignment))),
    ),
    ordered_parameter_assignment: $ => $._base_grammar_without_comma,
    named_parameter_assignment: $ => seq($.dot_operator, $._escaped_or_simple_identifier, $.parantheses_block),

    // A.4.1.4
    //TBD checker_instantiation: $ => seq($.ps_identifier, $._dimensional_identifier, $.parantheses_block),
    checker_instantiation: $ => seq($.identifier, $._dimensional_identifier, $.parantheses_block), //TBD use above once base_statement is removed

    // A.4.2
    generate_region: $ => seq(
        $.generate_keyword,
        repeat($.generate_item),
        $.endgenerate_keyword
    ),

    generate_item: $ => choice(
        $.module_or_generate_item,
        $.unique_interface_or_generate_item,
        $.unique_checker_or_generate_item,
        $.generate_block, // out of spec but common
    ),

    loop_generate_construct: $ =>
        seq($.for_keyword, $.open_parantheses, $.genvar_initialization, $.semicolon_operator, repeat($.base_grammar), $.semicolon_operator, repeat($.base_grammar), $.close_parantheses, $.generate_item),

    genvar_initialization: $ => seq(optional($.genvar_keyword), $._escaped_or_simple_identifier, $.equals_operator, repeat($.base_grammar)),

    generate_block: $ =>
        seq(optional(seq($._escaped_or_simple_identifier, $.colon_operator)), $.begin_keyword, optional(seq($.colon_operator, $._escaped_or_simple_identifier)), repeat($.generate_item), $.end_keyword, optional(seq($.colon_operator, $._escaped_or_simple_identifier))),

    conditional_generate_construct: $ => choice(
        $.if_generate_construct,
        $.case_generate_construct,
    ),

    if_generate_construct: $ =>
        prec.right(seq($.if_keyword, $.parantheses_block, $.generate_item, optional(seq($.else_keyword, $.generate_item)))),

    case_generate_construct: $ =>
        seq($.case_keyword, $.parantheses_block, repeat($.case_generate_item), $.endcase_keyword),

    case_generate_item: $ => choice(
        seq(repeat1($.base_grammar), $.colon_operator, $.generate_item),
        seq($.default_keyword, optional($.colon_operator), $.generate_item),
    ),

    // A.5.1
    udp_declaration: $ => choice(
        seq($.udp_ansi_or_nonansi_declaration, repeat($.udp_port_declaration), $.udp_body, $.endprimitive_declaration),
        seq($.extern_keyword, repeat($.attribute_instance), $.udp_ansi_or_nonansi_declaration),
    ),

    udp_ansi_or_nonansi_declaration: $ =>
        seq($.primitive_keyword, $._escaped_or_simple_identifier,
            choice(seq($.open_parantheses, choice($.udp_port_list, $.udp_declaration_port_list), $.close_parantheses), $.empty_port_declaration), $.semicolon_operator),

    endprimitive_declaration: $ => get_end_symbol($, $.endprimitive_keyword),

    // A.5.2
    udp_port_list: $ => get_list_of($, $._escaped_or_simple_identifier),

    udp_declaration_port_list: $ => seq($.udp_output_declaration, repeat1(seq($.comma_operator, $.udp_input_declaration))),
    udp_output_declaration: $ => choice(
        seq(repeat($.attribute_instance), $.output_keyword, $._escaped_or_simple_identifier),
        seq(repeat($.attribute_instance), $.output_keyword, $.reg_keyword, $._escaped_or_simple_identifier, optional(seq($.equals_operator, $.expression))),
    ),
    udp_input_declaration: $ => seq(repeat($.attribute_instance), $.input_keyword, $.list_of_udp_port_identifiers),
    udp_reg_declaration: $ => seq(repeat($.attribute_instance), $.reg_keyword, $._escaped_or_simple_identifier),

    udp_port_declaration : $ => choice(
        seq($.udp_output_declaration, $.semicolon_operator),
        seq($.udp_input_declaration, $.semicolon_operator),
        seq($.udp_reg_declaration, $.semicolon_operator),
    ),

    // A.5.3
    udp_body: $ => choice(
        $.combinational_or_sequential_body,
        $.udp_initial_statement,
    ),

    combinational_or_sequential_body: $ => seq($.table_keyword, repeat1($.combinational_or_sequential_entry), $.endtable_keyword),
    combinational_or_sequential_entry: $ => seq(repeat($.base_grammar), $.semicolon_operator),
    udp_initial_statement: $ => get_statement_symbol($, $.initial_keyword),

    // A.6.1
    continuous_assign : $ => get_statement_symbol($, $.assign_keyword),

    net_alias: $ => get_statement_symbol($, $.alias_keyword),

    // A.6.2
    procedural_continuous_assignment: $ => get_statement_symbol($, choice($.assign_keyword, $.deassign_keyword, $.force_keyword, $.release_keyword)),

    initial_construct: $ => seq($.initial_keyword, $.statement_or_null),

    final_construct: $ => seq($.final_keyword, $.statement_or_null),

    always_construct: $ => seq($.always_keywords, $.statement_or_null),

    // A.6.3
    par_block: $ => seq(
        $.fork_keyword, optional(seq($.colon_operator, $._escaped_or_simple_identifier)),
        repeat($._block_item_declaration_or_statement_or_null),
        $.join_keywords, optional(seq($.colon_operator, $._escaped_or_simple_identifier))
    ),

    seq_block: $ => seq(
        $.begin_keyword, optional(seq($.colon_operator, $._escaped_or_simple_identifier)), repeat($._block_item_declaration_or_statement_or_null),
        $.end_keyword, optional(seq($.colon_operator, $._escaped_or_simple_identifier)),
    ),

    action_block: $ => prec.right(choice(
        $.statement_or_null,
        seq(optional($.statement_or_null), $.else_keyword, $.statement_or_null),
    )),

    // A.6.4
    statement_or_null: $ => 
        seq(optional(seq($._escaped_or_simple_identifier, $.colon_operator)), repeat($.attribute_instance), $.statement_item),

    statement_item: $ => choice(
        $.procedural_continuous_assignment,
        $.case_statement,
        $.conditional_statement,
        $.disable_statement,
        $.loop_statement,
        $.jump_statement,
        $.par_block,
        $.seq_block,
        $.wait_statement,
        $.procedural_assertion_statement,
        $.randsequence_statement,
        $.randcase_statement,
        $.expect_property_statement,
        $.procedural_timing_control_statement,
        $.event_trigger,
        $.semicolon_operator, //covers null_statement
        $.checker_instantiation,
        $.base_statement //covers blocking_assignment ;, nonblocking_assignment ;, inc_or_dec_expression ;, subroutine_call_statement, clocking_drive ;
    ),

    base_statement : $ => seq(
        get_base_grammar($, ["attribute_instance", "hash_operator", "hash_parantheses_block", "event_control_operator", "event_control_block", "event_trigger_operator"]), repeat($._base_grammar), $.semicolon_operator,
    ),

    // A.6.5
    disable_statement: $ => get_statement_symbol($, $.disable_keyword),

    jump_statement: $ => choice(
        $._return_statement,
        seq($.break_keyword, $.semicolon_operator),
        seq($.continue_keyword, $.semicolon_operator),
    ),

    _return_statement: $ => get_statement_symbol($, $.return_keyword),

    wait_statement: $ => choice(
        seq($.wait_keyword, $.parantheses_block, $.statement_or_null),
        seq($.wait_keyword, $.fork_keyword, $.semicolon_operator),
        seq($.wait_order_keyword, $.parantheses_block, $.action_block),
    ),

    procedural_timing_control_statement: $ => seq($.procedural_timing_control, $.statement_or_null),

    procedural_timing_control: $ => choice(
        $.delay_control,
        $.event_control,
        $.cycle_delay,
    ),

    delay_control: $ => choice(
        seq($.hash_operator, $.delay_value),
        $.hash_parantheses_block,
    ),

    event_control: $ => choice(
        seq($.event_control_operator, $.identifier), // covers @ hierarchical_event_identifier, @ ps_or_hierarchical_sequence_identifier
        $.event_control_block, // covers @(*)
        seq($.event_control_operator, $.star_operator),
    ),

    event_trigger: $ => choice(
        seq($.blocking_event_trigger_operator, $.hierarchical_identifier, $.semicolon_operator),
        seq($.nonblocking_event_trigger_operator, optional($.delay_or_event_control), $.hierarchical_identifier, $.semicolon_operator),
    ),

    delay_or_event_control: $ => choice(
        $.delay_control,
        $.event_control,
        seq($.repeat_keyword, $.parantheses_block, $.event_control),
    ),

    // A.6.6
    unique_priority: $ => choice('unique', 'unique0', 'priority'),

    conditional_statement: $ => prec.right(seq(
        optional($.unique_priority), $.if_keyword, $.parantheses_block, $.statement_or_null,
        repeat(prec(1, seq($.else_keyword, $.if_keyword, $.parantheses_block, $.statement_or_null))), // higher precedence that 'else'
        optional(seq($.else_keyword, $.statement_or_null)))
    ),

    // A.6.7
    case_statement: $ =>
        seq(optional($.unique_priority), $.case_keywords, $.parantheses_block, optional($.case_match_keywords), repeat($.case_item), $.endcase_keyword),

    case_item: $ => choice(
        seq(repeat1($.base_grammar), $.colon_operator, $.statement_or_null),
        seq($.default_keyword, optional($.colon_operator), $.statement_or_null),
    ),

    randcase_statement: $ => seq($.randcase_keyword, repeat($.case_item), $.endcase_keyword),

    // A.6.8
    loop_statement: $ => choice(
        seq($.forever_keyword, $.statement_or_null),
        seq($.repeat_keyword, $.parantheses_block, $.statement_or_null),
        seq($.while_keyword, $.parantheses_block, $.statement_or_null),
        seq($.for_keyword, $.open_parantheses, repeat($.base_grammar), $.semicolon_operator, repeat($.base_grammar), $.semicolon_operator, repeat($.base_grammar), $.close_parantheses, $.statement_or_null), //TBHIP initialized variables
        seq($.do_keyword, $.statement_or_null, $.while_keyword, $.parantheses_block, $.semicolon_operator),
        seq($.foreach_keyword, $.parantheses_block, $.statement_or_null),
    ),

    // A.6.10
    procedural_assertion_statement: $ => choice(
        $.concurrent_assertion_statement,
        $.immediate_assertion_statement,
    ),

    immediate_assertion_statement: $ => choice(
        $.simple_immediate_assertion_statement,
        $.deferred_immediate_assertion_statement,
    ),

    simple_immediate_assertion_statement: $ => choice(
        $.simple_immediate_assert_statement,
        $.simple_immediate_assume_statement,
        $.simple_immediate_cover_statement,
    ),

    deferred_immediate_assertion_statement: $ => choice(
        $.deferred_immediate_assert_statement,
        $.deferred_immediate_assume_statement,
        $.deferred_immediate_cover_statement,
    ),

    simple_immediate_assert_statement: $ =>
        seq($.assert_keyword, $.parantheses_block, $.action_block),

    simple_immediate_assume_statement: $ =>
        seq($.assume_keyword, $.parantheses_block, $.action_block),

    simple_immediate_cover_statement: $ =>
        seq($.cover_keyword, $.parantheses_block, $.statement_or_null),

    deferred_immediate_assert_statement: $ =>
        seq($.assert_keyword, choice($.zero_delay, $.final_keyword), $.parantheses_block, $.action_block),

    deferred_immediate_assume_statement: $ =>
        seq($.assume_keyword, choice($.zero_delay, $.final_keyword), $.parantheses_block, $.action_block),

    deferred_immediate_cover_statement: $ =>
        seq($.cover_keyword, choice($.zero_delay, $.final_keyword), $.parantheses_block, $.statement_or_null),

    assertion_item: $ => choice(
        $.concurrent_assertion_item,
        $.deferred_immediate_assertion_item,
    ),

    deferred_immediate_assertion_item: $ => seq(optional(seq($._escaped_or_simple_identifier, $.colon_operator)), $.deferred_immediate_assertion_statement),

    // A.6.11
    clocking_declaration: $ => choice(
        seq(optional($.default_keyword), $.clocking_keyword, optional($._escaped_or_simple_identifier), $.clocking_event, $.semicolon_operator, repeat($.clocking_item), $.endclocking_declaration),
        seq($.global_keyword, $.clocking_keyword, optional($._escaped_or_simple_identifier), $.clocking_event, $.semicolon_operator, $.endclocking_declaration),
    ),

    endclocking_declaration: $ => get_end_symbol($, $.endclocking_keyword),

    clocking_event: $ => choice(
        seq($.event_control_operator, $._escaped_or_simple_identifier),
        seq($.event_control_operator, $.parantheses_block),
    ),

    clocking_item: $ => choice(
        $._default_clocking_item,
        $._port_clocking_item,
        seq(repeat($.attribute_instance), $.assertion_item_declaration),
    ),

    _default_clocking_item: $ => get_statement_symbol($, $.default_keyword),
    _port_clocking_item: $ => get_statement_symbol($, $.port_clocking_direction),
    port_clocking_direction: $ => choice($.input_keyword, $.output_keyword, $.inout_keyword),

    cycle_delay: $ => choice(
        seq($.hash_operator, $.hash_operator, $.integral_number),
        seq($.hash_operator, $.hash_operator, $._escaped_or_simple_identifier),
        seq($.hash_operator, $.hash_parantheses_block),
    ),

    // A.6.12
    randsequence_statement: $ =>
        seq($.randsequence_keyword, $.parantheses_block, repeat($.production), $.endsequence_keyword),

    production: $ => seq(repeat($.base_grammar), $.semicolon_operator),

    // A.7.1
    specify_block: $ => seq($.specify_keyword, repeat($.specify_item), $.endspecify_keyword),

    specify_item: $ => choice(
        $.specparam_declaration,
        $.pulsestyle_declaration,
        $.showcancelled_declaration,
        $.path_declaration,
        $.system_timing_check
    ),

    pulsestyle_declaration: $ => choice(
        $._pulsestyle_onevent,
        $._pulsestyle_ondetect,
    ),

    _pulsestyle_onevent: $ =>  get_statement_symbol($, $.pulsestyle_onevent_keyword),
    _pulsestyle_ondetect: $ =>  get_statement_symbol($, $.pulsestyle_ondetect_keyword),

    showcancelled_declaration: $ => choice(
        $._showcancelled,
        $._noshowcancelled,
    ),

    _showcancelled: $ => get_statement_symbol($, $.showcancelled_keyword),
    _noshowcancelled: $ => get_statement_symbol($, $.noshowcancelled_keyword),

    // A.7.2
    path_declaration: $ => seq(repeat($.base_grammar), $.semicolon_operator),

    // A.7.5.1
    system_timing_check: $ => choice(
        $.setup_timing_check,
        $.hold_timing_check,
        $.setuphold_timing_check,
        $.recovery_timing_check,
        $.removal_timing_check,
        $.recrem_timing_check,
        $.skew_timing_check,
        $.timeskew_timing_check,
        $.fullskew_timing_check,
        $.period_timing_check,
        $.width_timing_check,
        $.nochange_timing_check,
    ),

    setup_timing_check: $ => seq($.setup_system_keyword, $.parantheses_block, $.semicolon_operator),
    hold_timing_check: $ => seq($.hold_system_keyword, $.parantheses_block, $.semicolon_operator),
    setuphold_timing_check: $ => seq($.setuphold_system_keyword, $.parantheses_block, $.semicolon_operator),
    recovery_timing_check: $ => seq($.recovery_system_keyword, $.parantheses_block, $.semicolon_operator),
    removal_timing_check: $ => seq($.removal_system_keyword, $.parantheses_block, $.semicolon_operator),
    recrem_timing_check: $ => seq($.recrem_system_keyword, $.parantheses_block, $.semicolon_operator),
    skew_timing_check: $ => seq($.skew_system_keyword, $.parantheses_block, $.semicolon_operator),
    timeskew_timing_check: $ => seq($.timeskew_system_keyword, $.parantheses_block, $.semicolon_operator),
    fullskew_timing_check: $ => seq($.fullskew_system_keyword, $.parantheses_block, $.semicolon_operator),
    period_timing_check: $ => seq($.period_system_keyword, $.parantheses_block, $.semicolon_operator),
    width_timing_check: $ => seq($.width_system_keyword, $.parantheses_block, $.semicolon_operator),
    nochange_timing_check: $ => seq($.nochange_system_keyword, $.parantheses_block, $.semicolon_operator),

    // A.8.3
    constant_param_expression: $ => repeat1($._base_grammar_without_comma),

    expression: $ => repeat1($._base_grammar_without_comma),

    constant_expression: $ => repeat1($._base_grammar_without_comma),

    // A.8.4
    time_literal: $ => choice(seq($.unsigned_number, $.time_unit), seq($.fixed_point_number, $.time_unit)),
    time_unit: $ => choice('s', 'ms', 'us', 'ns', 'ps', 'fs'),

    // A.8.6
    event_control_operator: $ => '@',
    event_trigger_operator: $ => choice($.blocking_event_trigger_operator, $.nonblocking_event_trigger_operator),
    blocking_event_trigger_operator: $ => '->',
    nonblocking_event_trigger_operator: $ => '->>',
    hash_operator: $ => '#',
    comma_operator: $ => ',',
    semicolon_operator: $ => ';',
    dot_operator: $ => '.',
    colon_operator: $ => ':',
    double_colon_operator: $ => '::',
    star_operator: $ => '*',
    equals_operator: $ => '=',
    open_parantheses: $ => '(',
    close_parantheses: $ => ')',
    open_curly_braces: $ => '{',
    close_curly_braces: $ => '}',
    open_square_brackets: $ => '[',
    close_square_brackets: $ => ']',

    simple_operators: $ => /[=!<>+\-*%|&^~?:']+/,
    slashed_operators: $ => /\/[=!<>+\-*%|&^~?:'@#,;.]*/,

    // A.8.7
    integral_number: $ => choice($.decimal_number, $.octal_number, $.binary_number, $.hex_number),
    decimal_number: $ => choice(
        $.unsigned_number,
        seq(optional($.non_zero_unsigned_number), $.decimal_base, $.unsigned_number),
        seq(optional($.non_zero_unsigned_number), $.decimal_base, $.x_value),
        seq(optional($.non_zero_unsigned_number), $.decimal_base, $.z_value),
    ),
    unsigned_number: $ => /[0-9][0-9_]*/,
    non_zero_unsigned_number: $ => /[1-9][0-9_]*/,
    fixed_point_number: $ => prec(1, seq($.unsigned_number, $.dot_operator, $.unsigned_number)),
    real_number: $ => choice(
        $.fixed_point_number,
        seq($.unsigned_number, optional(seq($.dot_operator, $.unsigned_number)), $.exp, optional($.sign), $.unsigned_number),
    ),
    decimal_base: $ => choice(/'[dD]/, /'[sS][dD]/),
    octal_number: $ => seq(optional($.non_zero_unsigned_number), $.octal_base, $.octal_value),
    octal_base: $ => choice(/'[oO]/, /'[sS][oO]/),
    octal_value: $ => /[xXzZ?0-8][xXzZ?0-8_]*/,
    binary_number: $ => seq(optional($.non_zero_unsigned_number), $.binary_base, $.binary_value),
    binary_base: $ => choice(/'[bB]/, /'[sS][bB]/),
    binary_value: $ => /[xXzZ?01][xXzZ?01_]*/,
    hex_number: $ => seq(optional($.non_zero_unsigned_number), $.hex_base, $.hex_value),
    hex_base: $ => choice(/'[hH]/, /'[sS][hH]/),
    hex_value: $ => /[xXzZ?0-9a-fA-F][xXzZ?0-9a-fA-F_]*/,
    x_value: $ => /[xX]_+/,
    z_value: $ => /[zZ?]_+/,
    exp: $ => /[eE]/,
    sign: $ => choice('+', '-'),

    // A.9.1
    attribute_instance: $ => seq(
        $.attribute_instance_begin,
        repeat($._base_grammar_or_semicolon),
        $.attribute_instance_end
    ),
    attribute_instance_begin: $ => /\(\s*\*/,
    attribute_instance_end: $ => /\*\s*\)/,

    // A.9.3
    ps_identifier: $ => seq(optional($.package_scope), $._escaped_or_simple_identifier),

    package_scope: $ => prec(1, choice(
        seq($._escaped_or_simple_identifier, $.double_colon_operator),
        seq($.unit_system_keyword, $.double_colon_operator),
    )),

    constraint_identifier: $ => alias($._escaped_or_simple_identifier, $.constraint_identifier),
    function_identifier: $ => alias($._escaped_or_simple_identifier, $.function_identifier),
    net_identifier: $ => alias($._escaped_or_simple_identifier, $.net_identifier),
    net_type_identifier: $ => alias($._escaped_or_simple_identifier, $.net_type_identifier),
    task_identifier: $ => alias($._escaped_or_simple_identifier, $.task_identifier),
    tf_identifier: $ => alias($._escaped_or_simple_identifier, $.tf_identifier),

    identifier: $ => choice(
        $.system_identifier,
        $._escaped_or_simple_identifier,
        $.array_identifier,
        $.parametrized_identifier,
        $.scoped_identifier,
        $.hierarchical_identifier,
        $.scoped_and_hierarchical_identifier,
    ),

    system_identifier: $ => /\$[a-zA-Z0-9_$]+/,

    _escaped_or_simple_identifier: $ => choice(
        $.escaped_identifier,
        $.simple_identifier
    ),

    escaped_identifier: $ => /\\\S+(\s|\n|\r)?/,
    simple_identifier: $ => /[a-zA-Z_][a-zA-Z0-9_$]*/,

    array_identifier: $ => $._array_identifier,
    _array_identifier: $ => choice(
        prec(4, seq($._escaped_or_simple_identifier, $.square_brackets_block)),
        prec.left(4, seq($._array_identifier, $.square_brackets_block)),
    ),

    parametrized_identifier: $ => $._parametrized_identifier,
    _parametrized_identifier: $ =>
        prec(4, seq($._escaped_or_simple_identifier, $.hash_parantheses_block)),

    scoped_identifier: $ => prec(2, choice(
        $._unit_scoped_identifier,
        $._non_unit_scoped_identifier,
    )),

    _unit_scoped_identifier: $ => prec(3, seq($.unit_system_keyword, repeat1(seq($.double_colon_operator, $._parametrizable_identifier)))),
    _non_unit_scoped_identifier: $ => prec(3, seq($._parametrizable_identifier, repeat1(seq($.double_colon_operator, $._parametrizable_identifier)))),

    _parametrizable_identifier: $ => prec(2, choice(
        $._escaped_or_simple_identifier,
        $._array_identifier,
        $._parametrized_identifier
    )),

    hierarchical_identifier: $ => prec(2, choice(
        $._root_hierarchical_identifier,
        $._non_root_hierarchical_identifier
    )),

    _root_hierarchical_identifier: $=> prec(3, seq($.root_system_keyword, repeat1(seq($.dot_operator, $._dimensional_identifier)))),
    _non_root_hierarchical_identifier: $ => prec(3, seq($._dimensional_identifier, repeat1(seq($.dot_operator, $._dimensional_identifier)))),

    _dimensional_identifier: $ => prec(1, choice(
        $._escaped_or_simple_identifier,
        $._array_identifier
    )),

    scoped_and_hierarchical_identifier: $ => choice(
        seq($.unit_system_keyword, $.double_colon_operator, $._non_root_hierarchical_identifier),
        seq($._unit_scoped_identifier, $.double_colon_operator, $._non_root_hierarchical_identifier),
        seq($._parametrizable_identifier, $.double_colon_operator, $._non_root_hierarchical_identifier),
        seq($._non_unit_scoped_identifier, $.double_colon_operator, $._non_root_hierarchical_identifier)
    ),

    // Keywords
    interconnect_keyword: $ => 'interconnect',
    extern_keyword: $ => 'extern',
    module_keyword: $ => choice('module', 'macromodule'),
    endmodule_keyword: $ => 'endmodule',
    timeunits_keyword: $ => choice('timeunit', 'timeprecision'),
    checker_keyword: $ => 'checker',
    endchecker_keyword: $ => 'endchecker',
    package_keyword: $ => 'package',
    endpackage_keyword: $ => 'endpackage',
    interface_keyword: $ => 'interface',
    endinterface_keyword: $ => 'endinterface',
    program_keyword: $ => 'program',
    endprogram_keyword: $ => 'endprogram',
    virtual_keyword: $ => 'virtual',
    class_keyword: $ => 'class',
    endclass_keyword: $ => 'endclass',
    extends_keyword: $ => 'extends',
    implements_keyword: $ => 'implements',
    type_keyword: $ => 'type',
    default_keyword: $ => 'default',
    clocking_keyword: $ => 'clocking',
    endclocking_keyword: $ => 'endclocking',
    disable_keyword: $ => 'disable',
    iff_keyword: $ => 'iff',
    bind_keyword: $ => 'bind',
    defparam_keyword: $ => 'defparam',
    fatal_system_keyword: $ => '$fatal',
    error_system_keyword: $ => '$error',
    warning_system_keyword: $ => '$warning',
    info_system_keyword: $ => '$info',
    config_keyword: $ => 'config',
    endconfig_keyword: $ => 'endconfig',
    design_keyword: $ => 'design',
    instance_keyword: $ => 'instance',
    cell_keyword: $ => 'cell',
    forkjoin_keyword: $ => 'forkjoin',
    rand_keyword: $ => 'rand',
    const_keyword: $ => 'const',
    static_keyword: $ => 'static',
    automatic_keyword: $ => 'automatic',
    protected_keyword: $ => 'protected',
    local_keyword: $ => 'local',
    pure_keyword: $ => 'pure',
    function_keyword: $ => 'function',
    endfunction_keyword: $ => 'endfunction',
    task_keyword: $ => 'task',
    endtask_keyword: $ => 'endtask',
    new_keyword: $ => 'new',
    constraint_keyword: $ => 'constraint',
    parameter_keyword: $ => 'parameter',
    localparam_keyword: $ => 'localparam',
    specparam_keyword: $ => 'specparam',
    inout_keyword: $ => 'inout',
    input_keyword: $ => 'input',
    output_keyword: $ => 'output',
    ref_keyword: $ => 'ref',
    import_keyword: $ => 'import',
    genvar_keyword: $ => 'genvar',
    var_keyword: $ => 'var',
    typedef_keyword: $ => 'typedef',
    enum_keyword: $ => 'enum',
    struct_keyword: $ => 'struct',
    union_keyword: $ => 'union',
    tagged_keyword: $ => 'tagged',
    nettype_keyword: $ => 'nettype',
    with_keyword: $ => 'with',
    export_keyword: $ => 'export',
    packed_keyword: $ => 'packed',
    string_keyword: $ => 'string',
    chandle_keyword: $ => 'chandle',
    event_keyword: $ => 'event',
    void_keyword: $ => 'void',
    context_keyword: $ => 'context',
    modport_keyword: $ => 'modport',
    expect_keyword: $ => 'expect',
    assert_keyword: $ => 'assert',
    assume_keyword: $ => 'assume',
    cover_keyword: $ => 'cover',
    restrict_keyword: $ => 'restrict',
    property_keyword: $ => 'property',
    endproperty_keyword: $ => 'endproperty',
    sequence_keyword: $ => 'sequence',
    endsequence_keyword: $ => 'endsequence',
    covergroup_keyword: $ => 'covergroup',
    endgroup_keyword: $ => 'endgroup',
    sample_keyword: $ => 'sample',
    let_keyword: $ => 'let',
    generate_keyword: $ => 'generate',
    endgenerate_keyword: $ => 'endgenerate',
    begin_keyword: $ => 'begin',
    end_keyword: $ => 'end',
    if_keyword: $ => 'if',
    else_keyword: $ => 'else',
    case_keyword: $ => 'case',
    endcase_keyword: $ => 'endcase',
    case_keywords: $ => choice('case', 'casez', 'casex'),
    for_keyword: $ => 'for',
    primitive_keyword: $ => 'primitive',
    endprimitive_keyword: $ => 'endprimitive',
    reg_keyword: $ => 'reg',
    table_keyword: $ => 'table',
    endtable_keyword: $ => 'endtable',
    initial_keyword: $ => 'initial',
    assign_keyword: $ => 'assign',
    alias_keyword: $ => 'alias',
    deassign_keyword: $ => 'deassign',
    force_keyword: $ => 'force',
    release_keyword: $ => 'release',
    final_keyword: $ => 'final',
    always_keywords: $ => choice('always', 'always_comb', 'always_latch', 'always_ff'),
    fork_keyword: $ => 'fork',
    join_keywords: $ => choice('join', 'join_any', 'join_none'),
    break_keyword: $ => 'break',
    continue_keyword: $ => 'continue',
    return_keyword: $ => 'return',
    wait_keyword: $ => 'wait',
    wait_order_keyword: $ => 'wait_order',
    case_match_keywords: $ => choice('matches', 'inside'),
    randcase_keyword: $ => 'randcase',
    forever_keyword: $ => 'forever',
    repeat_keyword: $ => 'repeat',
    while_keyword: $ => 'while',
    do_keyword: $ => 'do',
    foreach_keyword: $ => 'foreach',
    global_keyword: $ => 'global',
    randsequence_keyword: $ => 'randsequence',
    specify_keyword: $ => 'specify',
    endspecify_keyword: $ => 'endspecify',
    pulsestyle_onevent_keyword: $ => 'pulsestyle_onevent',
    pulsestyle_ondetect_keyword: $ => 'pulsestyle_ondetect',
    showcancelled_keyword: $ => 'showcancelled',
    noshowcancelled_keyword: $ => 'noshowcancelled',
    setup_system_keyword: $ => '$setup',
    hold_system_keyword: $ => '$hold',
    setuphold_system_keyword: $ => '$setuphold',
    recovery_system_keyword: $ => '$recovery',
    removal_system_keyword: $ => '$removal',
    recrem_system_keyword: $ => '$recrem',
    skew_system_keyword: $ => '$skew',
    timeskew_system_keyword: $ => '$timeskew',
    fullskew_system_keyword: $ => '$fullskew',
    period_system_keyword: $ => '$period',
    width_system_keyword: $ => '$width',
    nochange_system_keyword: $ => '$nochange',
    unit_system_keyword: $ => '$unit',
    root_system_keyword: $ => '$root',
    vectored_keyword: $ => 'vectored',
    scalared_keyword: $ => 'scalared',
    one_step_keyword: $ => '1step',

    // Custom
    zero_delay: $ => '#0',

    _base_generic_expression_without_attributes: $ => choice($._base_grammar_without_attributes, $.semicolon_operator),
    _base_generic_expression: $ => seq(repeat($.attribute_instance), $._base_generic_expression_without_attributes),

    _block_item_declaration_or_statement_or_null: $ => choice($.block_item_declaration, $.statement_or_null),
    _tf_item_declaration_or_statement_or_null: $ => choice($.tf_item_declaration, $.statement_or_null),

    _base_grammar_or_semicolon: $ => choice($._base_grammar, $.semicolon_operator),

    base_grammar: $ => get_base_grammar($),
    _base_grammar: $ => get_base_grammar($),

    _base_grammar_without_comma: $ => get_base_grammar($, ["comma_operator"]),
    _base_grammar_without_attributes: $ => get_base_grammar($, ["attribute_instance"]),

    double_quoted_string: $ => seq(
        '"',
        repeat(choice(
            token.immediate(/\\\n/),
            token.immediate(/\\./),
            token.immediate(/[^"\\]+/)
        )),
        '"'
    ),

    numeric_literal: $ => choice(
        /[0-9][0-9_]*(\.[0-9][0-9_]*)?\s*(s|ms|us|ns|ps|fs)/,
        /(\d+)?'[sS]?[bB][01xXzZ?][01xXzZ?_]*/,
        /(\d+)?'[sS]?[oO][0-7xXzZ?][0-7xXzZ?_]*/,
        /(\d+)?'[sS]?[dD][0-9][0-9_]*/,
        /(\d+)?'[sS]?[dD][xXzZ?]_*/,
        /(\d+)?'[sS]?[hH][0-9a-fA-FxXzZ?][0-9a-fA-F_xXzZ?]*/,
        /'[01xXzZ?]/,
        /[0-9][0-9_]*(\.[0-9][0-9_]*)?([eE](\+|-)?[0-9][0-9_]*)?/
    ),

    square_brackets_block: $ => seq(
        $.open_square_brackets,
        repeat($._base_grammar_or_semicolon),
        $.close_square_brackets
    ),

    curly_brackets_block: $ => seq(
        $.open_curly_braces,
        repeat($._base_grammar_or_semicolon),
        $.close_curly_braces
    ),

    parantheses_block: $ => seq(
        $.open_parantheses,
        repeat($._base_grammar_or_semicolon),
        $.close_parantheses
    ),

    hash_parantheses_block: $ => prec(1, seq($.hash_operator, $.parantheses_block)),

    event_control_block: $ => prec(1, seq($.event_control_operator, $.parantheses_block)),
};

module.exports = grammar({
    name: 'svindex',
    rules: rules,
    word: $ => $.simple_identifier,
    extras: $ => [/(\s|\n|\r)+/, $.comment, $.macro_identifier],
});
