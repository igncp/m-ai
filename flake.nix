{
  inputs = {
    unstable.url = "github:nixos/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };
  outputs = {
    unstable,
    flake-utils,
    ...
  }: (flake-utils.lib.eachDefaultSystem (
    system: let
      pkgs = import unstable {
        inherit system;
        config = {allowUnfree = true;};
      };
    in {
      devShell = pkgs.mkShell {
        shellHook = ''
          echo "Nix shell for ${system}"
          export KUBECONFIG=$HOME/.kube/config
        '';
        packages = with pkgs; [
          bun
          nodejs
          bash
        ];
      };
    }
  ));
}
