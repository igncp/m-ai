# M-AI

A project to practice AI and distributed systems using Minecraft as an excuse. It should involve the following topics:

- Coding: enough guardrails to quickly code with the assistance of AI
- Infrastructure: usage of remote or local models
- Operations: deployment of games, agents, bots, backups
- Security
- Performance
- Observability: using grafana dashboards, alerts
- Playing: it should be fun

## Setup

### macOS

- Prism launcher: https://prismlauncher.org/download/macos/

### Kubernetes

Apply the monitoring stack with:

```sh
kubectl apply -k k8s/overlays
```

For local access, run:

```sh
kubectl port-forward deployment/grafana 3000:3000
```

The Prometheus datasource is provisioned automatically from
`http://prometheus-service.default.svc.cluster.local:9090`.

Kubernetes container stdout/stderr logs are collected by Grafana Alloy on every
ready node and retained in Loki for 30 days. Grafana, Prometheus, Loki, and
Alloy run in the `observability` namespace. Before applying the manifests,
label exactly one ready node for the observability workloads and Loki's local
persistent volume:

```sh
kubectl label node NODE_NAME m-ai/observability=true
```

Loki stores data at `/k3s-loki` on that node. Query the provisioned Loki
datasource in Grafana Explore, for example:

```logql
{namespace="default", pod=~"m-ai-bot-.*"}
```

Set `DATABASE_URL` to the PostgreSQL connection URL used for world storage.
For Kubernetes, create `k8s/overlays/local.yaml` from
`k8s/overlays/local.yaml.template` and set the PostgreSQL password, connection
URL, player name, and external node addresses.

Set `image` in `k8s/overlays/local.yaml` to the pushed commit image tag before
applying the overlay.

The daemon applies pending SQL migrations when it starts.

To update the active world's main player from the applied local Kubernetes
configuration, run:

```sh
./scripts/m-ai.sh sync-main-player
```

### Minecraft world management

Export the world data from the running Minecraft pod to a local archive named
`minecraft-world-YYYY-MM-DD-HHMMSS.tar`:

```sh
./scripts/m-ai.sh export-world
```

Import an archive into the running pod, replacing its current world data:

```sh
./scripts/m-ai.sh import-world minecraft-world-YYYY-MM-DD-HHMMSS.tar
```

The world ID is included in each archive. Importing it switches the daemon to
the matching database data. Archives without an ID receive a new one. New
worlds receive a new ID automatically.

Clear the world data and restart the Minecraft deployment to generate a new
world:

```sh
./scripts/m-ai.sh new-world
```

Access pgAdmin locally with:

```sh
kubectl port-forward deployment/pgadmin 8080:80
```

Sign in at `http://localhost:8080` as `admin@m-ai.example` with the
`postgres-password` value from `k8s/overlays/local.yaml`. The `m_ai` server is
preconfigured.

Set `MAIN_PLAYER` to initialize the `mainPlayer` property when a new world is
created. Existing world data is not changed.

### Building the bot image

The image helper builds both `linux/amd64` and `linux/arm64` closures and
images. Run:

```sh
./scripts/m-ai.sh build-image
./scripts/m-ai.sh deploy-image
```

Or run both steps with:

```sh
./scripts/m-ai.sh build-deploy-image
```

List tags by their newest platform image creation time:

```sh
./scripts/m-ai.sh list-image-tags
```

Update `k8s/overlays/local.yaml` to use the newest pushed commit image:

```sh
./scripts/m-ai.sh use-latest-image
```

The architecture-specific images are pushed with `-amd64` and `-arm64`
suffixes, and the full Git commit SHA is published as a multi-platform image
index. Set `M_AI_REGISTRY_HOST` directly or in `.env` to configure the registry
host.
For example:

```sh
M_AI_REGISTRY_HOST=registry.example
```

Copy `.env.example` to `.env` for a local configuration. `M_AI_IMAGE` can still
override the complete image reference. Dependencies are installed separately
for each architecture under `build/node_modules-amd64` and
`build/node_modules-arm64`. Docker must have arm64 emulation enabled when
these commands run on an amd64 host.

For an HTTP registry, configure BuildKit declaratively on NixOS:

```nix
environment.etc."buildkitd.toml".text = ''
  [registry."192.168.1.50:5000"]
    http = true
    insecure = true
'';
```

Apply the NixOS configuration, then create the builder with:

```sh
./scripts/m-ai.sh setup-buildx
```

The script reads `/etc/buildkitd.toml`. Set `M_AI_BUILDKIT_CONFIG` if the
configuration is stored elsewhere.

The dashboard in `k8s/base/grafana-dashboard.json` is generated with the
Grafana Foundation SDK. Regenerate it after changing
`scripts/generate_grafana.ts` with:

```sh
./scripts/m-ai.sh generate-grafana
```

## License

MIT
