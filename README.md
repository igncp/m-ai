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

Set `STORAGE_REDIS_HOST` to use Redis for world storage instead of
`world.json`. The value can be a host and port, such as
`redis.example:6379`, or a Redis URL.

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

The architecture-specific images are pushed with `-amd64` and `-arm64`
suffixes, and the repository is published with `latest`, the `package.json`
version, and the short Git commit SHA as multi-platform image indexes. Set `M_AI_REGISTRY_HOST` directly or in `.env` to configure the registry host.
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
