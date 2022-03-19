# Changelog
All notable changes to this repository are documented below.

## [0.4.0] - 2022.03.30
- Support for Icarus as linting alternative
- Added command for reporting hierarchy
- Improved hover over text formatting
- Support symbol resolution in functions and tasks
- Bug fixes
  * for [issue #19](https://github.com/imc-trading/svlangserver/issues/19)
  * Fix verilator crash on linting
  * Fixed verilator diagnostics column number reporting

## [0.3.5] - 2021.10.24
- Extended keyword and snippets completion
- Jump to definition improvements
  * Fix jump to definition for packages
  * Support jump to definition for includes
- Added systemverilog.libraryIndexing property
- Bug fixes
  * for [issue #8](https://github.com/imc-trading/svlangserver/issues/8)
  * for [issue #10](https://github.com/imc-trading/svlangserver/issues/10)
  * Typo fix in verilator.ts that caused some editors to hang on exit

## [0.3.4] - 2021.05.31
- Bug fix for [issue #1](https://github.com/imc-trading/svlangserver/issues/1)
- Refectored code to prevent server crashing because of errors
- Fix verilator linting for systemverilog packages

## [0.3.3] - 2021.05.13
- Updates for publishing to npm
- Updates for publishing to vscode marketplace
- Update installation instructions to use published packages

## [0.3.1] - 2021.04.25
- Support for Sublime Text 3
- Support for Emacs
- Configurable enabling/disabling of language server features viz. Completion, Hover, SignatureHelp
- Misc bug fixes

## [0.3.0] - 2021.04.22
- Initial release
