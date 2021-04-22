# SVLangserver
A language server for systemverilog that has been tested to work with coc.nvim and VSCode

## Features
- Auto completion (no need for ctags or other such mechanisms)
- Go to symbol in document
- Go to symbol in workspace folder (indexed modules/interfaces/packages)
- Go to definition (_works for module/interface/package names and for ports too!_)
- Hover over help
- Signature help
- Fast indexing
- Verilator linting on the fly
- Code snippets for many common blocks
- Code formatting with verible-verilog-format
- Elaborate syntax highlighting (for VSCode)

## Versions
The code has been tested to work with below tool versions
- vim 8.2
- coc.nvim 0.0.80-2cece2600a
- VSCode 1.50.1
- Verilator 4.008

## Installation
Plan is to publish this package to VSCode Marketplace and NPM. Until that is done easiest way to install is
- For coc.nvim
  * `cd <INSTALLATION PATH> && git clone https://github.com/imc-trading/svlangserver.git`
  * `cd svlangserver && npm install`
  * Update the .vim/coc-settings.json to reflect the correct installation path
- For VSCode
  * `cd ~/.vscode/extensions && git clone https://github.com/imc-trading/svlangserver.git`
  * `cd svlangserver && npm install`
  * Enable the extension in VSCode

NOTE: This has been tested with npm version 6.14.11

## Settings
- `systemverilog.includeIndexing`: _Array_, Globs defining files to be indexed
- `systemverilog.excludeIndexing`: _String_, Exclude files from indexing based on glob
- `systemverilog.launchConfiguration`: _String_, Command to run when launching verilator
  * Default: _verilator --sv --lint-only --Wall_
  * If not in path, replace _verilator_ with the appropriate command
- `systemverilog.lintOnUnsaved`: _Boolean_, Lint even unsaved files
  * Default: *true*
- `systemverilog.defines`: Defines for the project. Used by the language server as well as verilator linting
  * Default: empty
- `systemverilog.formatCommand`: verible-verilog-format command for code formatting
  * Default: _verible-verilog-format_
  * If not in path, replace _verible-verilog-format_ with the appropriate command
- Example coc.nvim settings file
    ```json
    {
        "languageserver": {
            "svlangserver": {
                "module": "<INSTALLATION PATH>/svlangserver.js",
                "filetypes": ["systemverilog"],
                "settings": {
                    "systemverilog.includeIndexing": ["**/*.sv", "**/*.svh"],
                    "systemverilog.excludeIndexing": ["test/*.sv*"],
                    "systemverilog.defines" : [],
                    "systemverilog.launchConfiguration": "<TOOL PATH>/verilator -sv -Wall --lint-only",
                    "systemverilog.formatCommand": "<TOOL BINARY PATH>/verible-verilog-format"
                }
            }
        }
    }
    ```
    For coc.nvim this file should be at `<WORKSPACE PATH>/.vim/coc-settings.json`
- Example vscode settings file
    ```json
    {
        "systemverilog.includeIndexing": ["**/*.sv", "**/*.svh"],
        "systemverilog.excludeIndexing": ["test/*.sv*"],
        "systemverilog.defines" : [],
        "systemverilog.launchConfiguration": "<TOOL PATH>/verilator -sv -Wall --lint-only",
        "systemverilog.formatCommand": "<TOOL BINARY PATH>/verible-verilog-format"
    }
    ```
    For vscode on linux this file should be at `<WORKSPACE PATH>/.vscode/settings.json`

## Commands
- `systemverilog.build_index`: Instructs language server to rerun indexing

## Known Issues
- Language server doesn't understand most verification specific concepts (e.g. classes).

## Future
Rewrite parser to make it much more robust

## Acknowledgements
Although most of the code is written from scratch, this [VSCode-SystemVerilog extension](https://github.com/eirikpre/VSCode-SystemVerilog/) was what I started with and developed on.

## Release Notes
See the [changelog](CHANGELOG.md) for more details

### 0.3.0
- Initial release
