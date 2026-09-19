{
  description = "svlangserver for Helix";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        packages = {
          svlangserver = pkgs.buildNpmPackage {
            pname = "svlangserver";
            version = "0.3.5";

            src = ./.;
            npmDepsHash = "sha256-7j9TE1QkqymOWKjE1tSA8n9AJ2nSyjQoDq/8jptIPwY=";

            meta = {
              description = "SystemVerilog language server";
              homepage = "https://github.com/imc-trading/svlangserver";
              license = pkgs.lib.licenses.mit;
              mainProgram = "svlangserver";
            };
          };

          default = self.packages.${system}.svlangserver;
        };
      });
}
