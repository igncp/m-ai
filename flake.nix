{
  inputs = {
    unstable.url = "github:nixos/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };
  outputs = {
    self,
    unstable,
    flake-utils,
  }:
    flake-utils.lib.eachDefaultSystem (system: let
      pkgs = import unstable {
        inherit system;
        config = {allowUnfree = true;};
      };
      source = builtins.path {
        path = ./.;
        filter = path: type: let
          name = builtins.baseNameOf path;
        in
          name != ".direnv" && name != ".git" && name != "build" && name != "result";
        name = "m-ai-source";
      };
      dependencies = builtins.path {
        path = "${builtins.getEnv "PWD"}/node_modules";
        name = "m-ai-node-modules";
      };
      compiled = builtins.path {
        path = "${builtins.getEnv "PWD"}/dist";
        name = "m-ai-dist";
      };
    in {
      packages.bun = pkgs.bun;

      packages.container-app = pkgs.stdenvNoCC.mkDerivation {
        pname = "m-ai";
        version = "1.0.0";
        inherit source;
        src = source;
        dontBuild = true;
        installPhase = ''
          mkdir -p "$out/bin"
          cp -R ${compiled} "$out/dist"
          cp -R migrations package.json bun.lockb "$out/"
          cp -R ${dependencies} "$out/node_modules"
          mkdir -p "$out/etc/ssl/certs"
          cp ${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt "$out/etc/ssl/certs/ca-bundle.crt"
          cat > "$out/bin/m-ai" <<'EOF'
          #!${pkgs.bash}/bin/bash
          set -euo pipefail
          root="''${BASH_SOURCE[0]%/bin/m-ai}"
          exec ${pkgs.bun}/bin/bun "$root/dist/main.js" "$@"
          EOF
          chmod +x "$out/bin/m-ai"
        '';
      };

      devShell = pkgs.mkShell {
        shellHook = ''
          echo "Nix shell for ${system}"
          export KUBECONFIG=$HOME/.kube/config
          export PATH="$PWD:$PATH"
        '';
        packages = with pkgs; [
          bun
          nodejs
          bash
          coreutils
          curl
          docker
          findutils
          git
          gnugrep
          gnused
          gnutar
          gzip
          jq
          kubectl
          ollama
          shfmt
          util-linux
        ];
      };
    });
}
