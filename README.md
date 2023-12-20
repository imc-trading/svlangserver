# SVLangserver
A language server for systemverilog that has been tested to work with coc.nvim, VSCode, Sublime Text 4, emacs, and Neovim

## Features
- Auto completion (no need for ctags or other such mechanisms)
- Go to symbol in document
- Go to symbol in workspace folder (indexed modules/interfaces/packages)
- Go to definition (_works for module/interface/package names and for ports too!_)
- Hover over help
- Signature help
- Fast indexing
- Verilator/Icarus linting on the fly
- Report hierarchy of a module
- Code snippets for many common blocks
- Code formatting with verible-verilog-format
- Elaborate syntax highlighting (for VSCode)

## Versions
The code has been tested to work with below tool versions
- vim 8.2
  * coc.nvim 0.0.80-0b5130ea38
- VSCode 1.52.0
- Sublime Text Build 4126
- emacs 29.0.50
  * lsp-mode lsp-mode-20220328.1429
- Neovim 0.7.0
- Verilator 4.110
- Icarus Verilog Compiler 10.2
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
  * (Optional) Install [verilog-ext](https://github.com/gmlarumbe/verilog-ext.git) to automatically setup `eglot`/`lsp`
- For neovim
  * Install [nvim-lspconfig](https://github.com/neovim/nvim-lspconfig)
  * (Optional) Install [nlsp-settings.nvim](https://github.com/tamago324/nlsp-settings.nvim)
  * `npm install -g @imc-trading/svlangserver`
  * Create .svlangserver directory in your project root directory
  * Update LSP settings

To get the snippets, git clone this repo and copy the snippets directory wherever applicable

For installing from source (not applicable for VSCode)
- `git clone https://github.com/imc-trading/svlangserver.git`
- `cd svlangserver && npm install`
  * Update the settings with the correct command (e.g. `/git/repo/path/svlangserver/bin/main.js`)

NOTE: This has been tested with npm version 6.14.13 and node version 14.17.1

## Settings
- `systemverilog.includeIndexing`: _Array_, Globs defining files to be indexed
- `systemverilog.libraryIndexing`: _Array_, Globs defining library files to be added to linting. It's useful when module name is not equal to filename.
- `systemverilog.excludeIndexing`: _Array_, Exclude files from indexing based on glob
- `systemverilog.linter`: _String_, Select linter
  * Default: _'verilator'_
- `systemverilog.launchConfiguration`: _String_, Command to run for launching linting
  * Default: _verilator --sv --lint-only --Wall_
  * If not in path, replace _verilator_ with the appropriate command
- `systemverilog.lintOnUnsaved`: _Boolean_, Lint even unsaved files
  * Default: _true_
- `systemverilog.defines`: _Array_, Defines for the project. Used by the language server as well as linting
  * Default: _empty_
- `systemverilog.formatCommand`: _String_, verible-verilog-format command for code formatting
  * Default: _verible-verilog-format_
  * If not in path, replace _verible-verilog-format_ with the appropriate command
- `systemverilog.disableCompletionProvider`: _Boolean_, Disable auto completion provided by the language server
  * Default: _false_
- `systemverilog.disableHoverProvider`: _Boolean_, Disable hover over help provided by the language server
  * Default: _false_
- `systemverilog.disableSignatureHelpProvider`: _Boolean_, Disable signature help provided by the language server
  * Default: _false_
- `systemverilog.disableLinting`: _Boolean_, Disable linting
  * Default: _false_
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
- Example coc.nvim settings file (for windows)
    ```json
    {
        "languageserver": {
            "svlangserver": {
                "module": "/usr/lib/node_modules/@imc-trading/svlangserver/bin/main.js",
                "args": ["--node-ipc"],
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
    For project specific settings this file should be at `<WORKSPACE PATH>\.vim\coc-settings.json`
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
  * Configuration using [verilog-ext](https://github.com/gmlarumbe/verilog-ext.git)
    ```elisp
    (require 'verilog-ext)
    (verilog-ext-mode-setup)
    (verilog-ext-eglot-set-server 've-svlangserver) ;`eglot' config
    (verilog-ext-lsp-set-server 've-svlangserver)   ; `lsp' config
    ```
- Example settings for neovim
  * Without nlsp-settings.nvim
    + Update your init.lua
      ```lua
      local nvim_lsp = require('lspconfig')

      nvim_lsp.svlangserver.setup {
        on_init = function(client)
          local path = client.workspace_folders[1].name

          if path == '/path/to/project1' then
            client.config.settings.systemverilog = {
              includeIndexing     = {"**/*.{sv,svh}"},
              excludeIndexing     = {"test/**/*.sv*"},
              defines             = {},
              launchConfiguration = "/tools/verilator -sv -Wall --lint-only",
              formatCommand       = "/tools/verible-verilog-format"
            }
          elseif path == '/path/to/project2' then
            client.config.settings.systemverilog = {
              includeIndexing     = {"**/*.{sv,svh}"},
              excludeIndexing     = {"sim/**/*.sv*"},
              defines             = {},
              launchConfiguration = "/tools/verilator -sv -Wall --lint-only",
              formatCommand       = "/tools/verible-verilog-format"
            }
          end

          client.notify("workspace/didChangeConfiguration")
          return true
        end
      }
      ```
  * With nlsp-settings.nvim
    + Update your init.lua
      ```lua
      local on_attach = function(client, bufnr)
        -- Other settings when LSPs are attached
        -- ...

        -- Update nlsp-settings when LSPs are attached
        require('nlspsettings').update_settings(client.name)
      end

      local nvim_lsp = require('lspconfig')
      local nlspsettings = require('nlspsettings')

      nvim_lsp.svlangserver.setup {
        on_attach = on_attach,
      }
      nlspsettings.setup {}
      ```
    + Example nlsp-settings settings file
      ```json
      {
          "systemverilog.includeIndexing": ["**/*.{sv,svh}"],
          "systemverilog.excludeIndexing": ["test/**/*.sv*"],
          "systemverilog.defines" : [],
          "systemverilog.launchConfiguration": "/tools/verilator -sv -Wall --lint-only",
          "systemverilog.formatCommand": "/tools/verible-verilog-format"
      }
      ```
      For project specific settings this file should be at `<WORKSPACE PATH>/.nlsp-settings/svlangserver.json`

## Commands
* `systemverilog.build_index`: Instructs language server to rerun indexing
* `systemverilog.report_hierarchy`: Generates hierarchy for the given module

### coc.nvim usage
  * The commands should be executed using CocRequest function. An example vim command would be:
  ```vim
  command! SvBuildIndex call CocRequest("svlangserver", 'workspace/executeCommand', {'command': 'systemverilog.build_index'})
  command! -range SvReportHierarchy call CocRequest("svlangserver", 'workspace/executeCommand', {'command': 'systemverilog.report_hierarchy', 'arguments': [input('Module/interface: ', <range> == 0 ? "" : expand("<cword>"))]})
  ```
  If the above SvReportHierarchy command is called with visual selection, then the module name is pre-filled with the selection. Also depending on the coc.nvim version, the generated rpt.json file might not have the focus and user will have to switch buffer manually.

### VSCode usage
  * Typing `build index` in the command palette should invoke the build index command.
  * Typing `get hierarchy` in the command palette should invoke the report hierarchy command. If invoked with an active slection, the module name is pre-filled with the selection.

### Sublime usage
  * A sublime-commands file needs to be created with the below content
  ```json
  [
    {
      "caption": "SvLangserver Build Index",
      "command": "lsp_execute",
      "args": {
        "session_name": "svlangserver",
        "command_name": "systemverilog.build_index",
        "command_args": []
      }
    },
    {
      "caption": "Svlangserver Report Hierarchy",
      "command": "lsp_execute",
      "args": {
        "session_name": "svlangserver",
        "command_name": "systemverilog.report_hierarchy",
        "command_args": ["${selection}"]
      }
    }
  ]
  ```
  This should make the commands available in the command palette. For the report hierarchy command, the module name should be selected before invoking the command.

### Emacs usage
  * `lsp-clients-svlangserver-build-index` command should rerun the indexing.
  * `lsp-clients-svlangserver-report-hierarchy` command should do the job. If invoked with an active slection, the module name is pre-filled with the selection.

  Previous commands can be run with `eglot` and `verilog-ext`:
  * `verilog-ext-eglot-svlangserver-build-index`
  * `verilog-ext-eglot-svlangserver-report-hierarchy`

### Neovim usage
  * `:SvlangserverBuildIndex` command should rerun the indexing.
  * `:SvlangserverReportHierarchy` command will generate hierarchy file of the word under the cursor in normal mode.

## Troubleshooting
- Editor is not able to find language server binary.
    * Make sure the binary is in the system path as exposed to the editor. If the binary is installed in custom directory, expose that path to your editor
- Not getting any diagnostics
    * Make sure the launchConfiguration setting has been properly set to use verilator from the correct installation path
- Diagnostics show _Cannot find file containing module 'module_name'_
    * Make sure all submodules can be found by includeIndexing
    * If the issue still remains, it may due to different naming of module and file, or a file containing multiple modules. Make sure these files can be found by libraryIndexing.
- Check settings used by the language server
    * for coc.nvim: Use the command `:CocCommand workspace.showOutput` and then select svlangserver
    * for vscode: Check the SVLangServer output channel
    * for sublime: Open the command palette in the tools menu and select `LSP: Toggle Log Panel`
    * for emacs: Check the `*lsp-log*` buffer
    * for neovim: Add `vim.lsp.set_log_level("info")` in your init.lua then use the command `:LspLog`

## Known Issues
- Language server doesn't understand most verification specific concepts (e.g. classes).

## Future
Rewrite parser to make it much more robust

## Acknowledgements
Although most of the code is written from scratch, this [VSCode-SystemVerilog extension](https://github.com/eirikpre/VSCode-SystemVerilog/) was what I started with and developed on.

## Release Notes
See the [changelog](CHANGELOG.md) for more details

### 0.4.1
- Support for Neovim client with nvim-lspconfig
- Updated settings for faster indexing
- Bug fixes

### 0.4.0
- Icarus as linting alternative
- Command for reporting hierarchy
- Improved hover over formatting
- Improved symbol resolution
- Bug fixes

### 0.3.5
- Improvements to auto-completion and jump to definition
- Bug fixes

### 0.3.4
- Bug fixes

### 0.3.3
- Updated instructions to use published packages

### 0.3.1
- Add support for Sublime LSP and Emacs

### 0.3.0
- Initial release
