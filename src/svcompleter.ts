import {
    CompletionItem,
    CompletionItemKind,
    InsertTextFormat,
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
    // Compilation units
    ["unit", "$unit::variable_name", "unit::${1:variable_name}"],
    // Module instances (hierarchy)
    ["root", "$root", "root"],
    // Random number system functions and methods
    ["urandom", "$urandom(seed)", "urandom${1:(${2:seed})}"],
    ["urandom_range", "$urandom_range(maxval, minval)", "urandom_range(${1:maxval}${2:, ${3:minval}})"],
    // Global clocking
    ["global_clock", "$global_clock", "global_clock"],
    // Inferred value functions
    ["inferred_clock", "$inferred_clock", "inferred_clock"],
    ["inferred_disable", "$inferred_disable", "inferred_disable"],
    // Simulation control tasks
    ["finish", "$finish(n);", "finish${1:(${2|0,1,2|})};"],
    ["stop", "$stop(n);", "stop${1:(${2|0,1,2|})};"],
    ["exit", "$exit;", "exit;"],
    // Simulation time functions
    ["realtime", "$realtime", "realtime"],
    ["stime", "$stime", "stime"],
    ["time", "$time", "time"],
    // Timescale tasks
    ["printtimescale", "$printtimescale(hierarchical_identifier);", "printtimescale${1:(${2:hierarchical_identifier})};"],
    ["timeformat", "$timeformat(units_number, precision_number, suffix_string, minimum_field_width);", "timeformat${1:(${2:units_number}, ${3:precision_number}, ${4:suffix_string}, ${5:minimum_field_width})};"],
    // Conversion functions
    ["bitstoreal", "$bitstoreal(bit_val)", "bitstoreal(${1:bit_val})"],
    ["realtobits", "$realtobits(real_val)", "realtobits(${1:real_val})"],
    ["bitstoshortreal", "$bitstoshortreal(bit_val)", "bitstoshortreal(${1:bit_val})"],
    ["shortrealtobits", "$shortrealtobits(shortreal_val)", "shortrealtobits(${1:shortreal_val})"],
    ["itor", "$itor(int_val)", "itor(${1:int_val})"],
    ["rtoi", "$rtoi(real_val)", "rtoi(${1:real_val})"],
    ["signed", "$signed(val)", "signed(${1:val})"],
    ["unsigned", "$unsigned(val)", "unsigned(${1:val})"],
    ["cast", "$cast(singular_dest_val, singular_source_exp)", "cast(${1:singular_dest_val}, ${2:singular_source_exp})"],
    // Data query functions
    ["bits", "$bits(expression_or_data_type)", "bits(${1:expression_or_data_type})"],
    ["isbounded", "$isbounded(constant_expression)", "isbounded(${1:constant_expression})"],
    ["typename", "$typename(expression_or_data_type)", "typename(${1:expression_or_data_type})"],
    // Array query functions
    ["unpacked_dimensions", "$unpacked_dimensions(array_expression_or_data_type, dimension_expression)", "unpacked_dimensions(${1:array_expression_or_data_type}${2:, ${3:dimension_expression}})"],
    ["dimensions", "$dimensions(array_expression_or_data_type, dimension_expression)", "dimensions(${1:array_expression_or_data_type}${2:, ${3:dimension_expression}})"],
    ["left", "$left(array_expression_or_data_type, dimension_expression)", "left(${1:array_expression_or_data_type}${2:, ${3:dimension_expression}})"],
    ["right", "$right(array_expression_or_data_type, dimension_expression)", "right(${1:array_expression_or_data_type}${2:, ${3:dimension_expression}})"],
    ["low", "$low(array_expression_or_data_type, dimension_expression)", "low(${1:array_expression_or_data_type}${2:, ${3:dimension_expression}})"],
    ["high", "$high(array_expression_or_data_type, dimension_expression)", "high(${1:array_expression_or_data_type}${2:, ${3:dimension_expression}})"],
    ["increment", "$increment(array_expression_or_data_type, dimension_expression)", "increment(${1:array_expression_or_data_type}${2:, ${3:dimension_expression}})"],
    ["size", "$size(array_expression_or_data_type, dimension_expression)", "size(${1:array_expression_or_data_type}${2:, ${3:dimension_expression}})"],
    // Math functions
    ["clog2", "$clog2(constant_expression)", "clog2(${1:constant_expression})"],
    ["asin", "$asin(constant_expression)", "asin(${1:constant_expression})"],
    ["ln", "$ln(constant_expression)", "ln(${1:constant_expression})"],
    ["acos", "$acos(constant_expression)", "acos(${1:constant_expression})"],
    ["log10", "$log10(constant_expression)", "log10(${1:constant_expression})"],
    ["atan", "$atan(constant_expression)", "atan(${1:constant_expression})"],
    ["exp", "$exp(constant_expression)", "exp(${1:constant_expression})"],
    ["atan2", "$atan2(constant_expression)", "atan2(${1:constant_expression})"],
    ["sqrt", "$sqrt(constant_expression)", "sqrt(${1:constant_expression})"],
    ["hypot", "$hypot(constant_expression)", "hypot(${1:constant_expression})"],
    ["pow", "$pow(constant_expression)", "pow(${1:constant_expression})"],
    ["sinh", "$sinh(constant_expression)", "sinh(${1:constant_expression})"],
    ["floor", "$floor(constant_expression)", "floor(${1:constant_expression})"],
    ["cosh", "$cosh(constant_expression)", "cosh(${1:constant_expression})"],
    ["ceil", "$ceil(constant_expression)", "ceil(${1:constant_expression})"],
    ["tanh", "$tanh(constant_expression)", "tanh(${1:constant_expression})"],
    ["sin", "$sin(constant_expression)", "sin(${1:constant_expression})"],
    ["asinh", "$asinh(constant_expression)", "asinh(${1:constant_expression})"],
    ["cos", "$cos(constant_expression)", "cos(${1:constant_expression})"],
    ["acosh", "$acosh(constant_expression)", "acosh(${1:constant_expression})"],
    ["tan", "$tan(constant_expression)", "tan(${1:constant_expression})"],
    ["atanh", "$atanh(constant_expression)", "atanh(${1:constant_expression})"],
    // Bit vector system functions
    ["countbits", "$countbits(constant_expression)", "countbits(${1:constant_expression})"],
    ["countones", "$countones(constant_expression)", "countones(${1:constant_expression})"],
    ["onehot", "$onehot(constant_expression)", "onehot(${1:constant_expression})"],
    ["onehot0", "$onehot0(constant_expression)", "onehot0(${1:constant_expression})"],
    ["isunknown", "$isunknown(constant_expression)", "isunknown(${1:constant_expression})"],
    // Severity tasks / Elaboration tasks
    ["fatal", "$fatal(finish_number, list_of_arguments);", "fatal${1:(${2|0,1,2|}${3:, ${4:list_of_arguments}})};"],
    ["error", "$error(list_of_arguments);", "error${1:(${2:list_of_arguments})};"],
    ["warning", "$warning(list_of_arguments);", "warning${1:(${2:list_of_arguments})};"],
    ["info", "$info(list_of_arguments);", "info${1:(${2:list_of_arguments})};"],
    // Assertion control tasks
    ["asserton", "$asserton(levels, list_of_scopes_or_assertions);", "asserton${1:(${2:levels}${3:, ${4:list_of_scopes_or_assertions}})};"],
    ["assertoff", "$assertoff(levels, list_of_scopes_or_assertions);", "assertoff${1:(${2:levels}${3:, ${4:list_of_scopes_or_assertions}})};"],
    ["assertkill", "$assertkill(levels, list_of_scopes_or_assertions);", "assertkill${1:(${2:levels}${3:, ${4:list_of_scopes_or_assertions}})};"],
    ["assertcontrol", "$assertcontrol(control_type, assertion_type, directive_type, levels, list_of_scopes_or_assertions);", "assertcontrol(${1:control_type}${2:, ${3:assertion_type${4:, ${5:directive_type${6:, ${7:levels${8:, ${9:list_of_scopes_or_assertions}}}}}}}});"],
    ["assertpasson", "$assertpasson(levels, list_of_scopes_or_assertions);", "assertpasson${1:(${2:levels}${3:, ${4:list_of_scopes_or_assertions}})};"],
    ["assertpassoff", "$assertpassoff(levels, list_of_scopes_or_assertions);", "assertpassoff${1:(${2:levels}${3:, ${4:list_of_scopes_or_assertions}})};"],
    ["assertfailon", "$assertfailon(levels, list_of_scopes_or_assertions);", "assertfailon${1:(${2:levels}${3:, ${4:list_of_scopes_or_assertions}})};"],
    ["assertfailoff", "$assertfailoff(levels, list_of_scopes_or_assertions);", "assertfailoff${1:(${2:levels}${3:, ${4:list_of_scopes_or_assertions}})};"],
    ["assertnonvacuouson", "$assertnonvacuouson(levels, list_of_scopes_or_assertions);", "assertnonvacuouson${1:(${2:levels}${3:, ${4:list_of_scopes_or_assertions}})};"],
    ["assertvacuousoff", "$assertvacuousoff(levels, list_of_scopes_or_assertions);", "assertvacuousoff${1:(${2:levels}${3:, ${4:list_of_scopes_or_assertions}})};"],
    // Sampled value system functions
    ["sampled", "$sampled(expression)", "sampled(${1:expression})"],
    ["rose", "$rose(expression, clocking_event)", "rose(${1:expression}${2:, ${3:clocking_event}})"],
    ["fell", "$fell(expression, clocking_event)", "fell(${1:expression}${2:, ${3:clocking_event}})"],
    ["stable", "$stable(expression, clocking_event)", "stable(${1:expression}${2:, ${3:clocking_event}})"],
    ["changed", "$changed(expression, clocking_event)", "changed(${1:expression}${2:, ${3:clocking_event}})"],
    ["past", "$past(expression, number_of_ticks, expression2, clocking_event)", "past(${1:expression}${2:, ${3:clocking_event${4:, ${5:expression2${6:, ${7:clocking_event}}}}}})"],
    ["past_gclk", "$past_gclk(expression)", "past_gclk(${1:expression})"],
    ["rose_gclk", "$rose_gclk(expression)", "rose_gclk(${1:expression})"],
    ["fell_gclk", "$fell_gclk(expression)", "fell_gclk(${1:expression})"],
    ["stable_gclk", "$stable_gclk(expression)", "stable_gclk(${1:expression})"],
    ["changed_gclk", "$changed_gclk(expression)", "changed_gclk(${1:expression})"],
    ["future_gclk", "$future_gclk(expression)", "future_gclk(${1:expression})"],
    ["rising_gclk", "$rising_gclk(expression)", "rising_gclk(${1:expression})"],
    ["falling_gclk", "$falling_gclk(expression)", "falling_gclk(${1:expression})"],
    ["steady_gclk", "$steady_gclk(expression)", "steady_gclk(${1:expression})"],
    ["changing_gclk", "$changing_gclk(expression)", "changing_gclk(${1:expression})"],
    // Coverage control functions
    ["coverage_control", "$coverage_control(control_constant, coverage_type, scope_def, modules_or_instance)", "coverage_control(`SV_COV_${1|START,STOP,RESET,CHECK|}, `SV_COV_${2|ASSERTION,FSM_STATE,STATEMENT,TOGGLE|}, `SV_COV_${3|MODULE,HIER|}, ${4:modules_or_instance})"],
    ["coverage_get_max", "$coverage_get_max(coverage_type, scope_def, modules_or_instance)", "coverage_get_max(`SV_COV_${1|ASSERTION,FSM_STATE,STATEMENT,TOGGLE|}, `SV_COV_${2|MODULE,HIER|}, ${3:modules_or_instance})"],
    ["coverage_get", "$coverage_get(coverage_type, scope_def, modules_or_instance)", "coverage_get(`SV_COV_${1|ASSERTION,FSM_STATE,STATEMENT,TOGGLE|}, `SV_COV_${2|MODULE,HIER|}, ${3:modules_or_instance})"],
    ["coverage_merge", "$coverage_merge(coverage_type, name)", "coverage_merge(`SV_COV_${1|ASSERTION,FSM_STATE,STATEMENT,TOGGLE|}, ${2:name})"],
    ["coverage_save", "$coverage_save(coverage_type, name)", "coverage_save(`SV_COV_${1|ASSERTION,FSM_STATE,STATEMENT,TOGGLE|}, ${2:name})"],
    ["get_coverage", "$get_coverage()", "get_coverage()"],
    ["set_coverage_db_name", "$set_coverage_db_name(filename)", "set_coverage_db_name(${1:filename})"],
    ["load_coverage_db", "$load_coverage_db(filename)", "load_coverage_db(${1:filename})"],
    // Probabilistic distribution functions
    ["random", "$random(seed)", "random(${1:seed})"],
    ["dist_chi_square", "$dist_chi_square(seed, degree_of_freedom)", "dist_chi_square(${1:seed}, ${2:degree_of_freedom})"],
    ["dist_erlang", "$dist_erlang(seed, k_stage, mean)", "dist_erlang(${1:seed}, ${2:k_stage}, ${3:mean})"],
    ["dist_exponential", "$dist_exponential(seed, mean)", "dist_exponential(${1:seed}, ${2:mean})"],
    ["dist_normal", "$dist_normal(seed, mean, standard_deviation)", "dist_normal(${1:seed}, ${2:mean}, ${3:standard_deviation})"],
    ["dist_poisson", "$dist_poisson(seed, mean)", "dist_poisson(${1:seed}, ${2:mean})"],
    ["dist_t", "$dist_t(seed, degree_of_freedom)", "dist_t(${1:seed}, ${2:degree_of_freedom})"],
    ["dist_uniform", "$dist_uniform(seed, start, end)", "dist_uniform(${1:seed}, ${2:start}, ${3:end})"],
    // Stochastic analysis tasks and functions
    ["q_initialize", "$q_initialize(q_id, q_type, max_length, status);", "q_initialize(${1:q_id}, ${2|1,2|}, ${3:max_length}, ${4:status});"],
    ["q_add", "$q_add(q_id, job_id, inform_id, status);", "q_add(${1:q_id}, ${2:job_id}, ${3:inform_id}, ${4:status});"],
    ["q_remove", "$q_remove(q_id, job_id, inform_id, status);", "q_remove(${1:q_id}, ${2:job_id}, ${3:inform_id}, ${4:status});"],
    ["q_full", "$q_full(q_id, status);", "q_full(${1:q_id}, ${2:status});"],
    ["q_exam", "$q_exam(q_id, q_stat_code, q_stat_value, status);", "q_exam(${1:q_id}, ${2:q_stat_code}, ${3:q_stat_value}, ${4:status});"],
    // PLA modeling tasks
    ["async$and$array", "$async$and$array(memory_identifier, input_terms, output_terms);", "async\\$and\\$array(${1:memory_identifier}, ${2:input_terms}, ${3:output_terms});"],
    ["async$and$plane", "$async$and$plane(memory_identifier, input_terms, output_terms);", "async\\$and\\$plane(${1:memory_identifier}, ${2:input_terms}, ${3:output_terms});"],
    ["async$nand$array", "$async$nand$array(memory_identifier, input_terms, output_terms);", "async\\$nand\\$array(${1:memory_identifier}, ${2:input_terms}, ${3:output_terms});"],
    ["async$nand$plane", "$async$nand$plane(memory_identifier, input_terms, output_terms);", "async\\$nand\\$plane(${1:memory_identifier}, ${2:input_terms}, ${3:output_terms});"],
    ["async$or$array", "$async$or$array(memory_identifier, input_terms, output_terms);", "async\\$or\\$array(${1:memory_identifier}, ${2:input_terms}, ${3:output_terms});"],
    ["async$or$plane", "$async$or$plane(memory_identifier, input_terms, output_terms);", "async\\$or\\$plane(${1:memory_identifier}, ${2:input_terms}, ${3:output_terms});"],
    ["async$nor$array", "$async$nor$array(memory_identifier, input_terms, output_terms);", "async\\$nor\\$array(${1:memory_identifier}, ${2:input_terms}, ${3:output_terms});"],
    ["async$nor$plane", "$async$nor$plane(memory_identifier, input_terms, output_terms);", "async\\$nor\\$plane(${1:memory_identifier}, ${2:input_terms}, ${3:output_terms});"],
    ["sync$and$array", "$sync$and$array(memory_identifier, input_terms, output_terms);", "sync\\$and\\$array(${1:memory_identifier}, ${2:input_terms}, ${3:output_terms});"],
    ["sync$and$plane", "$sync$and$plane(memory_identifier, input_terms, output_terms);", "sync\\$and\\$plane(${1:memory_identifier}, ${2:input_terms}, ${3:output_terms});"],
    ["sync$nand$array", "$sync$nand$array(memory_identifier, input_terms, output_terms);", "sync\\$nand\\$array(${1:memory_identifier}, ${2:input_terms}, ${3:output_terms});"],
    ["sync$nand$plane", "$sync$nand$plane(memory_identifier, input_terms, output_terms);", "sync\\$nand\\$plane(${1:memory_identifier}, ${2:input_terms}, ${3:output_terms});"],
    ["sync$or$array", "$sync$or$array(memory_identifier, input_terms, output_terms);", "sync\\$or\\$array(${1:memory_identifier}, ${2:input_terms}, ${3:output_terms});"],
    ["sync$or$plane", "$sync$or$plane(memory_identifier, input_terms, output_terms);", "sync\\$or\\$plane(${1:memory_identifier}, ${2:input_terms}, ${3:output_terms});"],
    ["sync$nor$array", "$sync$nor$array(memory_identifier, input_terms, output_terms);", "sync\\$nor\\$array(${1:memory_identifier}, ${2:input_terms}, ${3:output_terms});"],
    ["sync$nor$plane", "$sync$nor$plane(memory_identifier, input_terms, output_terms);", "sync\\$nor\\$plane(${1:memory_identifier}, ${2:input_terms}, ${3:output_terms});"],
    // Miscellaneous tasks and functions
    ["system", "$system(\"terminal_command_line\");", "system(${1:\"${2:terminal_command_line}\"});"],
    // Display tasks
    ["display", "$display(list_of_arguments);", "display${1:(${2:list_of_arguments})};"],
    ["write", "$write(list_of_arguments);", "write${1:(${2:list_of_arguments})};"],
    ["displayb", "$displayb(list_of_arguments);", "displayb${1:(${2:list_of_arguments})};"],
    ["writeb", "$writeb(list_of_arguments);", "writeb${1:(${2:list_of_arguments})};"],
    ["displayh", "$displayh(list_of_arguments);", "displayh${1:(${2:list_of_arguments})};"],
    ["writeh", "$writeh(list_of_arguments);", "writeh${1:(${2:list_of_arguments})};"],
    ["displayo", "$displayo(list_of_arguments);", "displayo${1:(${2:list_of_arguments})};"],
    ["writeo", "$writeo(list_of_arguments);", "writeo${1:(${2:list_of_arguments})};"],
    ["monitor", "$monitor(list_of_arguments);", "monitor${1:(${2:list_of_arguments})};"],
    ["strobe", "$strobe(list_of_arguments);", "strobe${1:(${2:list_of_arguments})};"],
    ["monitorb", "$monitorb(list_of_arguments);", "monitorb${1:(${2:list_of_arguments})};"],
    ["strobeb", "$strobeb(list_of_arguments);", "strobeb${1:(${2:list_of_arguments})};"],
    ["monitorh", "$monitorh(list_of_arguments);", "monitorh${1:(${2:list_of_arguments})};"],
    ["strobeh", "$strobeh(list_of_arguments);", "strobeh${1:(${2:list_of_arguments})};"],
    ["monitoro", "$monitoro(list_of_arguments);", "monitoro${1:(${2:list_of_arguments})};"],
    ["strobeo", "$strobeo(list_of_arguments);", "strobeo${1:(${2:list_of_arguments})};"],
    ["monitoroff", "$monitoroff;", "monitoroff;"],
    ["monitoron", "$monitoron;", "monitoron;"],
    // File I/O tasks and functions
    ["fclose", "$fclose(multi_channel_descriptor_or_fd);", "fclose(${1:multi_channel_descriptor_or_fd});"],
    ["fopen", "$fopen(filename, type);", "fopen(${1:filename}${2:, ${3:type}});"],
    ["fdisplay", "$fdisplay(multi_channel_descriptor_or_fd, list_of_arguments);", "fdisplay(${1:multi_channel_descriptor_or_fd}${2:, ${3:list_of_arguments}});"],
    ["fwrite", "$fwrite(multi_channel_descriptor_or_fd, list_of_arguments);", "fwrite(${1:multi_channel_descriptor_or_fd}${2:, ${3:list_of_arguments}});"],
    ["fdisplayb", "$fdisplayb(multi_channel_descriptor_or_fd, list_of_arguments);", "fdisplayb(${1:multi_channel_descriptor_or_fd}${2:, ${3:list_of_arguments}});"],
    ["fwriteb", "$fwriteb(multi_channel_descriptor_or_fd, list_of_arguments);", "fwriteb(${1:multi_channel_descriptor_or_fd}${2:, ${3:list_of_arguments}});"],
    ["fdisplayh", "$fdisplayh(multi_channel_descriptor_or_fd, list_of_arguments);", "fdisplayh(${1:multi_channel_descriptor_or_fd}${2:, ${3:list_of_arguments}});"],
    ["fwriteh", "$fwriteh(multi_channel_descriptor_or_fd, list_of_arguments);", "fwriteh(${1:multi_channel_descriptor_or_fd}${2:, ${3:list_of_arguments}});"],
    ["fdisplayo", "$fdisplayo(multi_channel_descriptor_or_fd, list_of_arguments);", "fdisplayo(${1:multi_channel_descriptor_or_fd}${2:, ${3:list_of_arguments}});"],
    ["fwriteo", "$fwriteo(multi_channel_descriptor_or_fd, list_of_arguments);", "fwriteo(${1:multi_channel_descriptor_or_fd}${2:, ${3:list_of_arguments}});"],
    ["fstrobe", "$fstrobe(multi_channel_descriptor_or_fd, list_of_arguments);", "fstrobe(${1:multi_channel_descriptor_or_fd}${2:, ${3:list_of_arguments}});"],
    ["fmonitor", "$fmonitor(multi_channel_descriptor_or_fd, list_of_arguments);", "fmonitor(${1:multi_channel_descriptor_or_fd}${2:, ${3:list_of_arguments}});"],
    ["fstrobeb", "$fstrobeb(multi_channel_descriptor_or_fd, list_of_arguments);", "fstrobeb(${1:multi_channel_descriptor_or_fd}${2:, ${3:list_of_arguments}});"],
    ["fmonitorb", "$fmonitorb(multi_channel_descriptor_or_fd, list_of_arguments);", "fmonitorb(${1:multi_channel_descriptor_or_fd}${2:, ${3:list_of_arguments}});"],
    ["fstrobeh", "$fstrobeh(multi_channel_descriptor_or_fd, list_of_arguments);", "fstrobeh(${1:multi_channel_descriptor_or_fd}${2:, ${3:list_of_arguments}});"],
    ["fmonitorh", "$fmonitorh(multi_channel_descriptor_or_fd, list_of_arguments);", "fmonitorh(${1:multi_channel_descriptor_or_fd}${2:, ${3:list_of_arguments}});"],
    ["fstrobeo", "$fstrobeo(multi_channel_descriptor_or_fd, list_of_arguments);", "fstrobeo(${1:multi_channel_descriptor_or_fd}${2:, ${3:list_of_arguments}});"],
    ["fmonitoro", "$fmonitoro(multi_channel_descriptor_or_fd, list_of_arguments);", "fmonitoro(${1:multi_channel_descriptor_or_fd}${2:, ${3:list_of_arguments}});"],
    ["swrite", "$swrite(output_var, list_of_arguments);", "swrite(${1:output_var}${2:, ${3:list_of_arguments}});"],
    ["swriteb", "$swriteb(output_var, list_of_arguments);", "swriteb(${1:output_var}${2:, ${3:list_of_arguments}});"],
    ["swriteh", "$swriteh(output_var, list_of_arguments);", "swriteh(${1:output_var}${2:, ${3:list_of_arguments}});"],
    ["swriteo", "$swriteo(output_var, list_of_arguments);", "swriteo(${1:output_var}${2:, ${3:list_of_arguments}});"],
    ["sformat", "$sformat(output_var, format_string, list_of_arguments);", "sformat(${1:output_var}, ${2:format_string}${3:, ${4:list_of_arguments}});"],
    ["sformatf", "$sformatf(format_string, list_of_arguments)", "sformatf(${1:format_string}${2:, ${3:list_of_arguments}})"],
    ["fgetc", "$fgetc(fd)", "fgetc(${1:fd})"],
    ["ungetc", "$ungetc(c, fd)", "ungetc(${1:c}, ${2:fd})"],
    ["fgets", "$fgets(str, fd)", "fgets(${1:str}, ${2:fd})"],
    ["fscanf", "$fscanf(fd, format, args)", "fscanf(${1:fd}, ${2:format}, ${3:args})"],
    ["sscanf", "$sscanf(str, format, args)", "sscanf(${1:str}, ${2:format}, ${3:args})"],
    ["fread", "$fread(integral_var_or_mem, fd, start, count)", "fread(${1:integral_var_or_mem}, ${2:fd}${3:, ${4:start${5:, ${6:count}}}})"],
    ["ftell", "$ftell(fd)", "ftell(${1:fd})"],
    ["fseek", "$fseek(fd, offset, operatioin)", "fseek(${1:fd}, ${2:offset}, ${3:operation})"],
    ["rewind", "$rewind(fd)", "rewind(${1:fd})"],
    ["fflush", "$fflush(multi_channel_descriptor_or_fd);", "fflush(${1:multi_channel_descriptor_or_fd});"],
    ["ferror", "$ferror(fd, str)", "ferror(${1:fd}, ${2:str})"],
    ["feof", "$feof(fd)", "feof(${1:fd})"],
    // Memory load tasks
    ["readmemb", "$readmemb(filename, memory_name, start_addr, finish_addr);", "readmemb(${1:filename}, ${2:memory_name}${3:, ${4:start_addr${5:, ${6:finish_addr}}}});"],
    ["readmemh", "$readmemh(filename, memory_name, start_addr, finish_addr);", "readmemh(${1:filename}, ${2:memory_name}${3:, ${4:start_addr${5:, ${6:finish_addr}}}});"],
    // Memory dump tasks
    ["writememb", "$writememb(filename, memory_name, start_addr, finish_addr);", "writememb(${1:filename}, ${2:memory_name}${3:, ${4:start_addr${5:, ${6:finish_addr}}}});"],
    ["writememh", "$writememh(filename, memory_name, start_addr, finish_addr);", "writememh(${1:filename}, ${2:memory_name}${3:, ${4:start_addr${5:, ${6:finish_addr}}}});"],
    // Command line input
    ["test$plusargs", "$test$plusargs(string)", "test\\$plusargs(${1:String})"],
    ["value$plusargs", "$value$plusargs(user_string, variable)", "value\\$plusargs(${1:String}, ${2:value})"],
    // VCD tasks
    ["dumpfile", "$dumpfile(filename);", "dumpfile(${1:filename});"],
    ["dumpvars", "$dumpvars(levels, list_of_modules_or_variables);", "dumpvars${1:(${2:levels}${3:, ${4:list_of_modules_or_variables}})};"],
    ["dumpoff", "$dumpoff;", "dumpoff;"],
    ["dumpon", "$dumpon;", "dumpon;"],
    ["dumpall", "$dumpall;", "dumpall;"],
    ["dumplimit", "$dumplimit(filesize);", "dumplimit(${1:filesize});"],
    ["dumpflush", "$dumpflush;", "dumpflush;"],
    ["dumpports", "$dumpports(scope_list, filename);", "dumpports(${1:scope_list}, ${2:filename});"],
    ["dumpportsoff", "$dumpportsoff(filename);", "dumpportsoff(${1:filename});"],
    ["dumpportson", "$dumpportson(filename);", "dumpportson(${1:filename});"],
    ["dumpportsall", "$dumpportsall(filename);", "dumpportsall(${1:filename});"],
    ["dumpportslimit", "$dumpportslimit(filesize, filename);", "dumpportslimit(${1:filesize}, ${2:filename});"],
    ["dumpportsflush", "$dumpportsflush(filename);", "dumpportsflush(${1:filename});"],
    // Timing checks
    ["setup", "$setup(data_event, reference_event, timing_check_limit, notifier);", "setup(${1:data_event}, ${2:reference_event}, ${3:timing_check_limit}${4:, ${5:notifier}});"],
    ["hold", "$hold(reference_event, data_event, timing_check_limit, notifier);", "hold(${1:reference_event}, ${2:data_event}, ${3:timing_check_limit}${4:, ${5:notifier}});"],
    ["setuphold", "$setuphold(reference_event, data_event, timing_check_limit, timing_check_limit, notifier, timestamp_condition, timecheck_condition, delayed_reference, delayed_data);", "setuphold(${1:reference_event}, ${2:data_event}, ${3:timing_check_limit}, ${4:timing_check_limit}${5:, ${6:notifier${7:, ${8:timestamp_condition${9:, ${10:timecheck_condition${11:, ${12:delayed_reference${13:, ${14:delayed_data}}}}}}}}}});"],
    ["recovery", "$recovery(reference_event, data_event, timing_check_limit, notifier);", "recovery(${1:reference_event}, ${2:data_event}, ${3:timing_check_limit}${4:, ${5:notifier}});"],
    ["removal", "$removal(reference_event, data_event, timing_check_limit, notifier);", "removal(${1:reference_event}, ${2:data_event}, ${3:timing_check_limit}${4:, ${5:notifier}});"],
    ["recrem", "$recrem(reference_event, data_event, timing_check_limit, timing_check_limit, notifier, timestamp_condition, timecheck_condition, delayed_reference, delayed_data);", "recrem(${1:reference_event}, ${2:data_event}, ${3:timing_check_limit}, ${4:timing_check_limit}${5:, ${6:notifier${7:, ${8:timestamp_condition${9:, ${10:timecheck_condition${11:, ${12:delayed_reference${13:, ${14:delayed_data}}}}}}}}}});"],
    ["skew", "$skew(reference_event, data_event, timing_check_limit, notifier);", "skew(${1:reference_event}, ${2:data_event}, ${3:timing_check_limit}${4:, ${5:notifier}});"],
    ["timeskew", "$timeskew(reference_event, data_event, timing_check_limit, notifier, event_based_flag, remain_active_flag);", "timeskew(${1:reference_event}, ${2:data_event}, ${3:timing_check_limit}${4:, ${5:notifier}${6:, ${7:event_based_flag}${8:, ${9:remain_active_flag}}}});"],
    ["fullskew", "$fullskew(reference_event, data_event, timing_check_limit, notifier, event_based_flag, remain_active_flag);", "fullskew(${1:reference_event}, ${2:data_event}, ${3:timing_check_limit}, ${4:timing_check_limit}${5:, ${6:notifier}${7:, ${8:event_based_flag}${9:, ${10:remain_active_flag}}}});"],
    ["period", "$period(controlled_reference_event, timing_check_limit, notifier);", "period(${1:controlled_reference_event}, ${2:timing_check_limit}${3:, ${4:notifier}});"],
    ["width", "$width(controlled_reference_event, timing_check_limit, threshold, notifier);", "width(${1:controlled_reference_event}, ${2:timing_check_limit}, ${3:threshold}${4:, ${5:notifier}});"],
    ["nochange", "$nochange(reference_event, data_event, start_edge_offset, end_edge_offset, notifier);", "nochange(${1:reference_event}, ${2:data_event}, ${3:start_edge_offset}, ${4:end_edge_offset}${5:, ${6:notifier}});"],
    // Loading timing data from an SDF file
    ["sdf_annotate", "$sdf_annotate(sdf_file, module_instance, config_file, log_file, mtm_spec, scale_factors, scale_type);", "|});"],
    // Optional system tasks and system functions
    ["countdrivers", "$countdrivers(net, net_is_forced, number_of_01x_drivers, number_of_0_drivers, number_of_1_drivers, number_of_x_drivers);", "countdrivers(${1:net}${2:, ${3:net_is_forced}, ${4:number_of_01x_drivers}, ${5:number_of_0_drivers}, ${6:number_of_1_drivers}, ${7:number_of_x_drivers}});"],
    ["getpattern", "$getpattern(mem_element);", "getpattern(${1:mem_element});"],
    ["input", "$input(filename);", "input(${1:filename});"],
    ["key", "$key(filename);", "key${1:(${2:filename})};"],
    ["nokey", "$nokey;", "nokey;"],
    ["list", "$list(hierarchy_name);", "list${1:(${2:hierarchy_name})};"],
    ["log", "$log(filename);", "log${1:(${2:filename})};"],
    ["nolog", "$nolog;", "nolog;"],
    ["reset", "$reset(stop_value, reset_value, diagnositics_value);", "reset${1:(${2:stop_value}${3:, ${4:reset_value${5:, ${6:reset_value}}}})};"],
    ["reset_count", "$reset_count;", "reset_count;"],
    ["reset_value", "$reset_value;", "reset_value;"],
    ["save", "$save(filename);", "save(${1:filename});"],
    ["restart", "$restart(filename);", "restart(${1:filename});"],
    ["incsave", "$incsave(incremental_filename);", "incsave(${1:incremental_filename});"],
    ["scale", "$scale(hierarchical_name);", "scale(${1:incremental_filename});"],
    ["scope", "$scope(hierarchical_name);", "scope(${1:incremental_filename});"],
    ["showscopes", "$showscopes(n);", "showscopes${1:(${2:n})};"],
    ["showvars", "$showvars(list_of_variables);", "showvars${1:(${2:list_of_variables})};"],
    ["sreadmemb", "$sreadmemb(memory_name, start_addr, finish_addr, strings);", "sreadmemb(${1:memory_name}, ${2:start_addr}, ${3:finish_addr}, ${4:strings});"],
    ["sreadmemh", "$sreadmemh(memory_name, start_addr, finish_addr, strings);", "sreadmemh(${1:memory_name}, ${2:start_addr}, ${3:finish_addr}, ${4:strings});"]
];

let sv_completion_systemtask_items: CompletionItem[] = [];
for (let n = 0; n < sv_completion_systemtask.length; n++) {
    sv_completion_systemtask_items.push({
        label: sv_completion_systemtask[n][0],
        kind: CompletionItemKind.Text,
        data: "support.function.systemverilog",
        detail: sv_completion_systemtask[n][1],
        insertText: sv_completion_systemtask[n][2],
        insertTextFormat: InsertTextFormat.Snippet
    });
}

const sv_completion_tick: string[][] = [
    // Compiler directives
    ["__FILE__", "`__FILE__", "__FILE__"],
    ["__LINE__", "`__LINE__", "__LINE__"],
    ["begin_keywords", "version_specifier\"", "\n${0}\n`end_keywords"],
    ["celldefine", "`celldefine", "celldefine\n$TM_SELECTED_TEXT\n`endcelldefine"],
    ["default_nettype", "`default_nettype default_nettype_value", "default_nettype ${1|wire,tri,tri0,tri1,wand,triand,wor,trior,trireg,uwire,none|}"],
    ["define", "`define text_macro_name macro_text", "define ${1:text_macro_name} ${2:macro_text}"],
    ["ifdef", "`ifdef text_macro_name", "ifdef ${1:text_macro_name}\n$TM_SELECTED_TEXT\n`endif"],
    ["ifndef", "`ifndef text_macro_name", "ifndef ${1:text_macro_name}\n$TM_SELECTED_TEXT\n`endif"],
    ["elsif", "`elsif text_macro_name", "elsif ${1:text_macro_name}\n${0}"],
    ["else", "`else", "else\n${0}"],
    ["include", "filename\"", "${1:filename}\""],
    ["line", " level", " ${3:level}"],
    ["unconnected_drive", "`unconnected_drive", "unconnected_drive\n$TM_SELECTED_TEXT\n`nounconnected_drive"],
    ["pragma", "`pragma pragma_name pragma_expression", "pragma ${1:pragma_name}${2: ${3:pragma_expression}}"],
    ["resetall", "`resetall", "resetall"],
    ["timescale", "`timescale time_unit/time_precision", "timescale ${1:time_unit}${2|s,ms,us,ns,ps,fs|}/${3:time_precision}${4|s,ms,us,ns,ps,fs|}"],
    ["undef", "`undef text_macro_identifier", "undef ${1:text_macro_identifier}"],
    ["undefineall", "`undefineall", "undefineall"],
    // Optional compiler directives
    ["default_decay_time", "`default_decay_time value", "default_decay_time ${1:value}"],
    ["default_trireg_strength", "`default_trireg_strength integer_constant", "default_trireg_strength ${1:integer_constant}"],
    ["delay_mode_distributed", "`delay_mode_distributed", "delay_mode_distributed"],
    ["delay_mode_path", "`delay_mode_path", "delay_mode_path"],
    ["delay_mode_unit", "`delay_mode_unit", "delay_mode_unit"],
    ["delay_mode_zero", "`delay_mode_zero", "delay_mode_zero"]
];

let sv_completion_tick_items: CompletionItem[] = [];
for (let n = 0; n < sv_completion_tick.length; n++) {
    sv_completion_tick_items.push({
        label: sv_completion_tick[n][0],
        kind: CompletionItemKind.Text,
        data: "constant.other.define.systemverilog",
        detail: sv_completion_tick[n][1],
        insertText: sv_completion_tick[n][2],
        insertTextFormat: InsertTextFormat.Snippet
    });
}

const sv_completion_keywords: string[][] = [
    ["alias"],
    ["always"],
    ["always_comb"],
    ["always_ff"],
    ["always_latch"],
    ["and"],
    ["assert"],
    ["assign"],
    ["assume"],
    ["automatic"],
    ["before"],
    ["begin"],
    ["bind"],
    ["bins"],
    ["binsof"],
    ["bit"],
    ["break"],
    ["buf"],
    ["bufif0"],
    ["bufif1"],
    ["byte"],
    ["case"],
    ["casex"],
    ["casez"],
    ["cell"],
    ["chandle"],
    ["class"],
    ["clocking"],
    ["cmos"],
    ["config"],
    ["const"],
    ["constraint"],
    ["context"],
    ["continue"],
    ["cover"],
    ["covergroup"],
    ["coverpoint"],
    ["cross"],
    ["deassign"],
    ["default"],
    ["defparam"],
    ["design"],
    ["disable"],
    ["dist"],
    ["do"],
    ["edge"],
    ["else"],
    ["end"],
    ["endcase"],
    ["endclass"],
    ["endclocking"],
    ["endconfig"],
    ["endfunction"],
    ["endgenerate"],
    ["endgroup"],
    ["endinterface"],
    ["endmodule"],
    ["endpackage"],
    ["endprimitive"],
    ["endprogram"],
    ["endproperty"],
    ["endspecify"],
    ["endsequence"],
    ["endtable"],
    ["endtask"],
    ["enum"],
    ["event"],
    ["expect"],
    ["export"],
    ["extends"],
    ["extern"],
    ["final"],
    ["first_match"],
    ["for"],
    ["force"],
    ["foreach"],
    ["forever"],
    ["fork"],
    ["forkjoin"],
    ["function"],
    ["generate"],
    ["genvar"],
    ["highz0"],
    ["highz1"],
    ["if"],
    ["iff"],
    ["ifnone"],
    ["ignore_bins"],
    ["illegal_bins"],
    ["import"],
    ["incdir"],
    ["include"],
    ["initial"],
    ["inout"],
    ["input"],
    ["inside"],
    ["instance"],
    ["int"],
    ["integer"],
    ["interface"],
    ["intersect"],
    ["join"],
    ["join_any"],
    ["join_none"],
    ["large"],
    ["liblist"],
    ["library"],
    ["local"],
    ["localparam"],
    ["logic"],
    ["longint"],
    ["macromodule"],
    ["matches"],
    ["medium"],
    ["modport"],
    ["module"],
    ["nand"],
    ["negedge"],
    ["new"],
    ["nmos"],
    ["nor"],
    ["noshowcancelled"],
    ["not"],
    ["notif0"],
    ["notif1"],
    ["null"],
    ["or"],
    ["output"],
    ["package"],
    ["packed"],
    ["parameter"],
    ["pmos"],
    ["posedge"],
    ["primitive"],
    ["priority"],
    ["program"],
    ["property"],
    ["protected"],
    ["pull0"],
    ["pull1"],
    ["pulldown"],
    ["pullup"],
    ["pulsestyle_onevent"],
    ["pulsestyle_ondetect"],
    ["pure"],
    ["rand"],
    ["randc"],
    ["randcase"],
    ["randsequence"],
    ["rcmos"],
    ["real"],
    ["realtime"],
    ["ref"],
    ["reg"],
    ["release"],
    ["repeat"],
    ["return"],
    ["rnmos"],
    ["rpmos"],
    ["rtran"],
    ["rtranif0"],
    ["rtranif1"],
    ["scalared"],
    ["sequence"],
    ["shortint"],
    ["shortreal"],
    ["showcancelled"],
    ["signed"],
    ["small"],
    ["solve"],
    ["specify"],
    ["specparam"],
    ["static"],
    ["string"],
    ["strong0"],
    ["strong1"],
    ["struct"],
    ["super"],
    ["supply0"],
    ["supply1"],
    ["table"],
    ["tagged"],
    ["task"],
    ["this"],
    ["throughout"],
    ["time"],
    ["timeprecision"],
    ["timeunit"],
    ["tran"],
    ["tranif0"],
    ["tranif1"],
    ["tri"],
    ["tri0"],
    ["tri1"],
    ["triand"],
    ["trior"],
    ["trireg"],
    ["type"],
    ["typedef"],
    ["union"],
    ["unique"],
    ["unsigned"],
    ["use"],
    ["uwire"],
    ["var"],
    ["vectored"],
    ["virtual"],
    ["void"],
    ["wait"],
    ["wait_order"],
    ["wand"],
    ["weak0"],
    ["weak1"],
    ["while"],
    ["wildcard"],
    ["wire"],
    ["with"],
    ["within"],
    ["wor"],
    ["xnor"],
    ["xor"]
];
let sv_completion_keyword_items = [];
for (let n = 0; n < sv_completion_keywords.length; n++) {
    sv_completion_keyword_items.push({
        label: sv_completion_keywords[n][0],
        kind: CompletionItemKind.Text,
        data: "constant.other.define.systemverilog"
    });
}

export class SystemVerilogCompleter {
    private _indexer: SystemVerilogIndexer;

    constructor(indexer: SystemVerilogIndexer) {
        this._indexer = indexer;
    }

    private _stringlistToCompletionItems(syms: string[], kind: CompletionItemKind, data: string): CompletionItem[] {
        let result: CompletionItem[] = [];
        for (let sym of (syms || [])) {
            result.push({
                label: sym,
                kind: kind,
                data: data
            });
        }
        return result;
    }

    completionItems(document: TextDocument, position: Position): CompletionItem[] {
        try {
            const svtokens: GrammarToken[] = this._indexer.getSystemVerilogCompletionTokens(document.uri);
            const svtokennums: number[] = this._indexer.getSystemVerilogCompletionTokenNumber(document, position.line, position.character);
            const svtokennum: number = svtokennums[1];
            const svtoken: GrammarToken | null = (svtokennum >= 0) && (svtokennum < svtokens.length) ? svtokens[svtokennum] : null;

            if (!svtoken) {
                return [];
            }

            const scopes : string[] = svtoken.scopes || [];
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
                        const symTokens: GrammarToken[] = svtokens.slice(svtokennums[0], svtokennums[1] + 1) || [];
                        let symParts: string[] = this._indexer.getHierParts(symTokens.map(t => t.text).join(''), symTokens, document.offsetAt(position) - svtokens[svtokennums[0]].index);
                        let fileUri: string;
                        let containerInfo: SystemVerilogParser.SystemVerilogContainerInfo = [[undefined, undefined], undefined];
                        [fileUri, containerInfo[0][0]] = this._indexer.getHierarchicalSymbol(document.uri, symParts.slice(0, -1));
                        if ((fileUri == undefined) || (containerInfo[0][0] == undefined)) {
                            return [];
                        }
                        [fileUri, containerInfo[0][0], containerInfo[1]] = this._indexer.getSymbolTypeContainerInfo(fileUri, containerInfo[0][0]);
                        return this._stringlistToCompletionItems(SystemVerilogParser.containerAllSymbols(containerInfo, true).map(s => s.name), CompletionItemKind.Text, "identifier.hieararchical.systemverilog");
                    }
                    else if (scopes[scopes.length - 1] == "identifier.scoped.systemverilog") {
                        let idparts: string[] = svtoken.text.split('::') || [];
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
                                for (let [_pkgName, importedSyms] of this._indexer.getFileImports(document.uri)) {
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
                                // get keyword
                                fileCompletionItems = fileCompletionItems.concat(sv_completion_keyword_items);
                                return fileCompletionItems;
                            }
                        }
                    }
                    else if ((svtoken.text == ".") && (scopes.length >= 2)) {
                        return this._getInstanceCompletions(svtokens, svtokennum);
                    }
                }
            }
        } catch (error) {
            ConnectionLogger.error(error);
        }

        return [];
    }

    private _getTokenTopScope(svtoken: GrammarToken): string {
        return !!svtoken && svtoken.scopes.length > 0 ? svtoken.scopes[svtoken.scopes.length - 1] : "";
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
