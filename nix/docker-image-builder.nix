{
  config,
  lib,
  pkgs,
  ...
}: let
  cfg = config.services.m-ai.dockerImageBuilder;
  buildxSetup = pkgs.writeShellScript "m-ai-buildx-setup" ''
    set -euo pipefail

    ${pkgs.docker}/bin/docker buildx rm --force ${lib.escapeShellArg cfg.builderName} 2>/dev/null || true
    ${pkgs.docker}/bin/docker buildx create \
      --name ${lib.escapeShellArg cfg.builderName} \
      --driver docker-container \
      --buildkitd-config ${lib.escapeShellArg cfg.buildkitdConfig} \
      --use
    ${pkgs.docker}/bin/docker buildx inspect --bootstrap
  '';
in {
  options.services.m-ai.dockerImageBuilder = {
    enable = lib.mkEnableOption "the M-AI Buildx builder";
    user = lib.mkOption {
      type = lib.types.str;
      description = "User whose Docker Buildx configuration owns the builder";
    };
    home = lib.mkOption {
      type = lib.types.str;
      description = "Home directory for the user whose Docker Buildx configuration owns the builder";
    };
    builderName = lib.mkOption {
      type = lib.types.str;
      default = "m-ai-multiarch";
      description = "Name of the Docker Buildx builder";
    };
    buildkitdConfig = lib.mkOption {
      type = lib.types.str;
      default = "/etc/buildkitd.toml";
      description = "Path to the BuildKit daemon configuration passed to Docker Buildx";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.m-ai-buildx = {
      description = "M-AI multi-architecture Docker Buildx builder";
      after = ["docker.service"];
      wants = ["docker.service"];
      wantedBy = ["multi-user.target"];
      environment.HOME = cfg.home;
      serviceConfig = {
        Type = "oneshot";
        User = cfg.user;
        RemainAfterExit = true;
        ExecStart = buildxSetup;
      };
    };
  };
}
