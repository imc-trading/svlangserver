# SVLangserver
A language server for systemverilog that has been tested to work with coc.nvim, VSCode, Sublime Text 3 and emacs

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
  * coc.nvim 0.0.80-2cece2600a
- VSCode 1.52.0
- Sublime Text 3.2.2
- emacs 26.1
  * lsp-mode 20210513.1723
- Verilator 4.008
- Verible v0.0-1114-ged89c1b

## Installation
- For coc.nvim
  * `npm install -g @imc-trading/svlangserver`
  * Update .vim/coc-settings.json
- For VSCode
  * Install the extension from the marketplace.
  * Update the settings
- For Sublime Text 3
  * Install the systemverilog package in sublime text
  * `npm install -g @imc-trading/svlangserver`
  * Update the LSP settings (`Preferences -> Package Settings -> LSP -> settings`) and the sublime-project files
- For emacs
  * Install lsp-mode
  * `npm install -g @imc-trading/svlangserver`
  * Update .emacs/init.el

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
- `systemverilog.disableCompletionProvider`: Disable auto completion provided by the language server
  * Default: false
- `systemverilog.disableHoverProvider`: Disable hover over help provided by the language server
  * Default: false
- `systemverilog.disableSignatureHelpProvider`: Disable signature help provided by the language server
  * Default: false
- `systemverilog.disableLinting`: Disable verilator linting
  * Default: false
- Example coc.nvim settings file
    ```json
    {
        "languageserver": {
            "svlangserver": {
                "command": "svlangserver",
                "filetypes": ["systemverilog"],
                "settings": {
                    "systemverilog.includeIndexing": ["**/*.{sv,svh}"],
                    "systemverilog.excludeIndexing": ["test/**/*.sv*"],
                    "systemverilog.defines" : [],
                    "systemverilog.launchConfiguration": "/tools/verilator -sv -Wall --lint-only",
                    "systemverilog.formatCommand": "/tools/verible-verilog-format"
                }
            }
        }
    }
    ```
    For project specific settings this file should be at `<WORKSPACE PATH>/.vim/coc-settings.json`
- Example vscode settings file
    ```json
    {
        "systemverilog.includeIndexing": ["**/*.{sv,svh}"],
        "systemverilog.excludeIndexing": ["test/**/*.sv*"],
        "systemverilog.defines" : [],
        "systemverilog.launchConfiguration": "/tools/verilator -sv -Wall --lint-only",
        "systemverilog.formatCommand": "/tools/verible-verilog-format"
    }
    ```
    For project specific settings this file should be at `<WORKSPACE PATH>/.vscode/settings.json`
- Example Sublime Text 3 settings files
  * The global LSP settings file: LSP.sublime-settings
    ```json
    {
        "clients": {
            "svlangserver": {
                "enabled": true,
                "command": ["svlangserver"],
                "languageId": "systemverilog",
                "scopes": ["source.systemverilog"],
                "syntaxes": ["Packages/SystemVerilog/SystemVerilog.sublime-syntax"],
                "settings": {
                    "systemverilog.disableHoverProvider": true,
                    "systemverilog.launchConfiguration": "/tools/verilator -sv --lint-only -Wall",
                    "systemverilog.formatCommand" : "/tools/verible-verilog-format"
                }
            }
        }
    }
    ```
  * The project specific settings go in `<PROJECT>.sublime-project`
    ```json
    {
        "folders":
        [
            {
                "path": "."
            }
        ],
        "settings": {
            "LSP": {
                "svlangserver": {
                    "settings": {
                        "systemverilog.includeIndexing": [ "**/*.{sv,svh}", ],
                        "systemverilog.excludeIndexing": ["test/**/*.sv*"],
                        "systemverilog.defines": [],
                    }
                }
            }
        }
    }
    ```
- Example settings for emacs
  * Below content goes in .emacs or init.el
    ```elisp
    (require 'lsp-verilog)

    (custom-set-variables
      '(lsp-clients-svlangserver-launchConfiguration "/tools/verilator -sv --lint-only -Wall")
      '(lsp-clients-svlangserver-formatCommand "/tools/verible-verilog-format"))

    (add-hook 'verilog-mode-hook #'lsp-deferred)
    ```
  * The project specific settings go in .dir-locals.el
    ```elisp
    ((verilog-mode (lsp-clients-svlangserver-workspace-additional-dirs . ("/some/lib/path"))
                   (lsp-clients-svlangserver-includeIndexing . ("src/**/*.{sv,svh}"))
                   (lsp-clients-svlangserver-excludeIndexing . ("src/test/**/*.{sv,svh}"))))
    ```

## Commands
- `systemverilog.build_index`: Instructs language server to rerun indexing


## Troubleshooting
- Editor is not able to find language server binary.
    * Make sure the binary is in the system path as exposed to the editor. If the binary is installed in custom directory, expost that path to your editor
- Not getting any diagnostics
    * Make sure the launchConfiguration setting has been properly set to use verilator from the correct installation path
- Check settings used by the language server
    * for coc.nvim: Use the command `:CocCommand workspace.showOutput` and then select svlangserver
    * for vscode: Check the SVLangServer output channel
    * for sublime: Open the command palette in the tools menu and select `LSP: Toggle Log Panel`
    * for emacs: Check the `*lsp-log*` buffer


## Known Issues
- Language server doesn't understand most verification specific concepts (e.g. classes).

## Future
Rewrite parser to make it much more robust

## Acknowledgements
Although most of the code is written from scratch, this [VSCode-SystemVerilog extension](https://github.com/eirikpre/VSCode-SystemVerilog/) was what I started with and developed on.

## Release Notes
See the [changelog](CHANGELOG.md) for more details

### 0.3.3
- Updated instructions to use published packages

### 0.3.1
- Add support for Sublime LSP and Emacs

### 0.3.0
- Initial release
