{
  config,
  lib,
  ...
}: let
  cfg = config.services.m-ai.k3sWorkerNode;
in {
  options.services.m-ai.k3sWorkerNode = {
    enable = lib.mkEnableOption "the M-AI K3s worker node";
  };

  config = lib.mkIf cfg.enable {
    systemd.tmpfiles.rules = [
      "d /btrfs/k3s-pv 0755 root root -"
      "d /k3s-pv 0755 root root -"
    ];
  };
}
