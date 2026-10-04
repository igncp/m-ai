{
  config,
  lib,
  pkgs,
  ...
}: let
  cfg = config.services.m-ai.minio;
  credentials-file = "/var/lib/minio/secrets/root-credentials";
  initialize-root-credentials = ''
    mkdir -p /var/lib/minio/secrets
    if [ ! -f ${credentials-file} ]; then
      echo "MINIO_ROOT_USER=${cfg.rootUser}" > ${credentials-file}
      echo "MINIO_ROOT_PASSWORD=${cfg.rootPassword}" >> ${credentials-file}
      chmod 600 ${credentials-file}
      chown -R minio:minio /var/lib/minio/secrets
    fi
  '';
in {
  options.services.m-ai.minio = {
    enable = lib.mkEnableOption "MinIO object storage";

    rootUser = lib.mkOption {
      type = lib.types.str;
      default = "lokiadmin";
      description = "MinIO root user name.";
    };

    rootPassword = lib.mkOption {
      type = lib.types.str;
      description = "MinIO root password.";
    };

    buckets = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [
        "loki"
        "prometheus"
      ];
      description = "Buckets to create after MinIO starts.";
    };
  };

  config = lib.mkIf cfg.enable {
    nixpkgs.config.permittedInsecurePackages = [
      "minio-2025-10-15T17-29-55Z"
    ];

    services.minio = {
      enable = true;
      listenAddress = ":7000";
      consoleAddress = ":7001";
      dataDir = ["/var/lib/minio/data"];
      rootCredentialsFile = credentials-file;
    };

    systemd.services.minio.preStart = initialize-root-credentials;

    systemd.services.minio-create-buckets = {
      description = "Create MinIO buckets";
      after = ["minio.service"];
      requires = ["minio.service"];
      wantedBy = ["multi-user.target"];
      path = [pkgs.getent];
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
      };
      script = ''
        ${initialize-root-credentials}
        . ${credentials-file}
        ${pkgs.minio-client}/bin/mc alias set local http://127.0.0.1:7000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
        # `mc mb` means "make bucket"; each operation is idempotent.
        ${lib.concatMapStringsSep "\n" (bucket: "${pkgs.minio-client}/bin/mc mb --ignore-existing local/${bucket}") cfg.buckets}
      '';
    };

    environment.systemPackages = [pkgs.minio-client];
  };
}
