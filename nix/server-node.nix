{
  config,
  lib,
  pkgs,
  ...
}: let
  cfg = config.services.m-ai.serverNode;
  k3sPortForwards = [
    {
      name = "prometheus";
      namespace = "observability";
      resource = "svc/prometheus-service";
      localPort = 9090;
      targetPort = 9090;
    }
    {
      name = "pgadmin";
      namespace = "default";
      resource = "deployments/pgadmin";
      localPort = 8080;
      targetPort = 80;
    }
    {
      name = "grafana";
      namespace = "observability";
      resource = "deployments/grafana";
      localPort = 3000;
      targetPort = 3000;
    }
  ];
  makePortForwardService = forward: {
    name = "k3s-forward-${forward.name}";
    value = {
      description = "M-AI K3s port forward for ${forward.name}";
      after = ["k3s.service"];
      wants = ["k3s.service"];
      wantedBy = ["multi-user.target"];
      serviceConfig = {
        ExecStart = pkgs.writeShellScript "k3s-forward-${forward.name}" ''
          if ! error=$(${pkgs.k3s}/bin/kubectl port-forward \
            --kubeconfig=${cfg.kubeconfig} \
            --request-timeout=10s \
            -n ${forward.namespace} \
            ${forward.resource} \
            ${toString forward.localPort}:${toString forward.targetPort} \
            --address 127.0.0.1 2>&1); then
            printf 'K3s port forward failed; continuing: %s\n' "$error" >&2
          fi
        '';
        Restart = "always";
        RestartSec = "2s";
        StandardOutput = "null";
        StandardError = "journal";
        LogRateLimitIntervalSec = "1min";
        LogRateLimitBurst = 2;
        User = "root";
      };
    };
  };
in {
  options.services.m-ai.serverNode = {
    enable = lib.mkEnableOption "the M-AI server node";
    kubeconfig = lib.mkOption {
      type = lib.types.str;
      description = "Path to the K3s kubeconfig used by M-AI server-node port forwards";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services = builtins.listToAttrs (map makePortForwardService k3sPortForwards);

    virtualisation.oci-containers = {
      backend = "docker";
      containers.local-container-registry = {
        image = "registry:3";
        autoStart = true;
        ports = ["5000:5000"];
        volumes = ["local-container-registry-data:/var/lib/registry"];
        environment = {
          REGISTRY_STORAGE_DELETE_ENABLED = "true";
          REGISTRY_HTTP_ADDR = "0.0.0.0:5000";
        };
      };
    };
  };
}
