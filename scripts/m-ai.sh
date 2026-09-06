#!/usr/bin/env bash

set -euo pipefail

if [[ -f .env ]]; then
  source .env
fi

REGISTRY_HOST="${M_AI_REGISTRY_HOST:-localhost:5000}"
IMAGE_NAME="${M_AI_IMAGE:-$REGISTRY_HOST/m-ai:latest}"
IMAGE_REPOSITORY="${IMAGE_NAME%:*}"
IMAGE_TAGS=(
  latest
  "$(node -p "require('./package.json').version")"
  "$(git rev-parse --short=7 HEAD)"
)
PLATFORMS=("linux/amd64" "linux/arm64")

platform_suffix() {
  case "$1" in
  linux/amd64)
    echo amd64
    ;;
  linux/arm64)
    echo arm64
    ;;
  *)
    echo "Unsupported platform: $1" >&2
    exit 1
    ;;
  esac
}

platform_system() {
  case "$1" in
  linux/amd64)
    echo x86_64-linux
    ;;
  linux/arm64)
    echo aarch64-linux
    ;;
  *)
    echo "Unsupported platform: $1" >&2
    exit 1
    ;;
  esac
}

build_image() {
  for platform in "${PLATFORMS[@]}"; do
    suffix="$(platform_suffix "$platform")"
    system="$(platform_system "$platform")"
    closure_dir="build/m-ai-closure-${suffix}"
    platform_tags=()
    for tag in "${IMAGE_TAGS[@]}"; do
      platform_tags+=("--tag" "${IMAGE_REPOSITORY}:${tag}-${suffix}")
    done

    echo "Building ${IMAGE_REPOSITORY} images for $platform"

    docker run --rm \
      --platform "$platform" \
      -e GIT_CONFIG_COUNT=1 \
      -e GIT_CONFIG_KEY_0=safe.directory \
      -e GIT_CONFIG_VALUE_0=/app \
      -e NIX_PATH= \
      -v "$PWD:/app" \
      -v "$PWD/build/node_modules-$suffix:/app/node_modules" \
      -v "m-ai-bun-cache-$suffix:/root/.bun/install/cache" \
      -v m-ai-nix-cache:/nix \
      nixos/nix:2.32.4 \
      bash -c \
      'git config --system --add safe.directory /app
       cd /app
       closure_dir="$1"
      system="$2"
      system_args=()
      [[ -n "$system" ]] && system_args+=(--system "$system")
      nix run .#bun --no-update-lock-file "${system_args[@]}" --option build-users-group "" --extra-experimental-features "nix-command flakes" -- install --frozen-lockfile
      nix run .#bun --no-update-lock-file "${system_args[@]}" --option build-users-group "" --extra-experimental-features "nix-command flakes" -- node_modules/typescript/bin/tsc --project tsconfig.build.json
      find /app/node_modules -mindepth 1 -maxdepth 1 -exec rm -rf {} +
      nix run .#bun --no-update-lock-file "${system_args[@]}" --option build-users-group "" --extra-experimental-features "nix-command flakes" -- install --production --frozen-lockfile
      nix build .#container-app --no-update-lock-file "${system_args[@]}" --impure --option build-users-group "" --extra-experimental-features "nix-command flakes"
      rm -rf "$closure_dir" "${closure_dir}-index"
      mkdir -p "$closure_dir"
      mapfile -t closure < <(nix-store -qR result/)
      cp -R "${closure[@]}" "$closure_dir/"
      chmod -R a+rw "$closure_dir"
      readlink -f result >"${closure_dir}-index"' \
      -- "/app/$closure_dir" "$system"

    env -u SOURCE_DATE_EPOCH docker buildx build \
      --load \
      --platform "$platform" \
      --build-arg "BUILD_DIR=$closure_dir" \
      "${platform_tags[@]}" .
    echo "Built ${IMAGE_REPOSITORY} images for $platform"
  done
}

deploy_image() {
  local builder_name="${M_AI_BUILDER_NAME:-m-ai-multiarch}"

  if ! docker buildx inspect "$builder_name" >/dev/null 2>&1; then
    echo "Buildx builder '$builder_name' does not exist; run '$0 setup-buildx' after configuring the registry." >&2
    exit 1
  fi

  for tag in "${IMAGE_TAGS[@]}"; do
    platform_images=()
    for platform in "${PLATFORMS[@]}"; do
      suffix="$(platform_suffix "$platform")"
      platform_image="${IMAGE_REPOSITORY}:${tag}-${suffix}"
      platform_images+=("$platform_image")

      echo "Pushing $platform_image"
      docker push "$platform_image"
    done

    image="${IMAGE_REPOSITORY}:${tag}"
    echo "Creating multi-platform tag $image"
    docker buildx imagetools create \
      --builder "$builder_name" \
      --tag "$image" \
      "${platform_images[@]}"
    echo "Pushed multi-platform tag $image"
  done
}

list_image_tags() {
  local builder_name="${M_AI_BUILDER_NAME:-m-ai-multiarch}"
  local registry_url="http://${REGISTRY_HOST}"
  local repository="${IMAGE_REPOSITORY#"${REGISTRY_HOST}/"}"
  local tags

  if ! docker buildx inspect "$builder_name" >/dev/null 2>&1; then
    echo "Buildx builder '$builder_name' does not exist; run '$0 setup-buildx' after configuring the registry." >&2
    exit 1
  fi

  tags="$(curl --fail --silent --show-error "${registry_url}/v2/${repository}/tags/list" | jq -r '.tags[]?')"

  while IFS= read -r tag; do
    [[ -z "$tag" ]] && continue
    image="${IMAGE_REPOSITORY}:${tag}"
    inspect="$(docker buildx imagetools inspect --builder "$builder_name" --format '{{json .}}' "$image")"
    created="$(jq -r '[.image[]? | objects | .created? | strings] | max // empty' <<<"$inspect")"
    [[ -z "$created" ]] && continue
    manifest="$(curl --fail --silent --show-error \
      --header 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json' \
      "${registry_url}/v2/${repository}/manifests/${tag}")"
    mapfile -t manifest_digests < <(jq -r '.manifests[]?.digest // empty' <<<"$manifest")
    if ((${#manifest_digests[@]} == 0)); then
      manifest_digests=("$tag")
    fi

    size=0
    for digest in "${manifest_digests[@]}"; do
      if [[ "$digest" == "$tag" ]]; then
        platform_manifest="$manifest"
      else
        platform_manifest="$(curl --fail --silent --show-error \
          --header 'Accept: application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json' \
          "${registry_url}/v2/${repository}/manifests/${digest}")"
      fi
      ((size += $(jq '[.config.size, .layers[].size] | add' <<<"$platform_manifest")))
    done

    printf '%s\t%s\t%s\n' "$created" "$(numfmt --to=iec-i --suffix=B "$size")" "$tag"
  done <<<"$tags" | sort -r
}

setup_buildx() {
  builder_name="${M_AI_BUILDER_NAME:-m-ai-multiarch}"
  buildkit_config="${M_AI_BUILDKIT_CONFIG:-/etc/buildkitd.toml}"

  docker buildx rm --force "$builder_name" 2>/dev/null || true

  if [[ ! -f "$buildkit_config" ]]; then
    echo "BuildKit config does not exist: $buildkit_config" >&2
    exit 1
  fi

  docker buildx create \
    --name "$builder_name" \
    --driver docker-container \
    --buildkitd-config "$buildkit_config" \
    --use
  docker buildx inspect --bootstrap
  echo "Buildx builder '$builder_name' created successfully."
}

docker_prune() {
  builder_name="${M_AI_BUILDER_NAME:-m-ai-multiarch}"
  mapfile -t images < <(
    docker image ls --format '{{.Repository}}:{{.Tag}}' "$IMAGE_REPOSITORY"
  )

  docker buildx rm --force "$builder_name" 2>/dev/null || true
  for platform in "${PLATFORMS[@]}"; do
    suffix="$(platform_suffix "$platform")"
    docker volume rm "m-ai-bun-cache-$suffix" 2>/dev/null || true
  done
  docker volume rm m-ai-nix-cache 2>/dev/null || true

  if ((${#images[@]} > 0)); then
    docker image rm --force "${images[@]}" 2>/dev/null || true
  fi

  echo "Removed local M-AI Buildx resources and images."
}

fix() {
  run_fix_step() {
    local name="$1"
    shift
    local output
    local quiet=false

    if [[ "$1" == "--quiet" ]]; then
      quiet=true
      shift
    fi

    echo "Running $name..."
    if [[ "$quiet" == true ]]; then
      output="$(mktemp)"
      if "$@" >"$output" 2>&1; then
        rm "$output"
        return
      fi
      cat "$output" >&2
      rm "$output"
      echo "Fix failed: $name" >&2
      return 1
    fi

    if ! "$@"; then
      echo "Fix failed: $name" >&2
      return 1
    fi
  }

  run_fix_step "Knip" ./node_modules/.bin/knip
  run_fix_step "ESLint" ./node_modules/.bin/eslint --fix src
  run_fix_step "Prettier" --quiet ./node_modules/.bin/prettier --write 'src/**/*.ts' 'k8s/**/*.yaml'
  run_fix_step "shfmt" shfmt -w scripts/*.sh
  run_fix_step "TypeScript" ./node_modules/.bin/tsc --noEmit --project .

  echo "Fixes completed successfully."
}

check_ts() {
  ./node_modules/.bin/tsc --noEmit --project .
}

generate_grafana() {
  ./node_modules/.bin/tsx scripts/generate_grafana.ts
}

setup() {
  cd mindcraft

  git reset --hard
  rm -f profiles/a1.json profiles/a2.json
  git apply ../mindcraft-changes.diff

  if [[ ! -d node_modules ]]; then
    npm i
  fi

  if [[ ! -d ../block/node_modules ]]; then
    (cd ../block && npm i)
  fi

  ollama pull sweaterdog/andy-4:micro-q8_0
  ollama pull embeddinggemma

  echo "Setup succeeded."
}

kube_setup() {
  mkdir -p ~/.kube
  sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
  sudo chown "$(whoami):$(id -gn)" ~/.kube/config
  chmod 600 ~/.kube/config
  kubectl apply --server-side \
    -f 'https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/refs/tags/v0.93.1/bundle.yaml'

  echo "Kubernetes setup finished successfully."
}

get_commands_history() {
  main_player="$(kubectl get --raw '/api/v1/namespaces/default/services/http:m-ai-daemon:50000/proxy/world' | jq -r .mainPlayer)"

  if [[ -z "$main_player" || "$main_player" == "null" ]]; then
    echo "Error: mainPlayer is not set in the daemon world" >&2
    exit 1
  fi

  kubectl exec deployment/minecraft --container minecraft -- \
    env "MAIN_PLAYER=$main_player" /bin/bash -c \
    '(ls -1v logs/*.log.gz | xargs zcat -f; cat logs/latest.log) | grep "$MAIN_PLAYER" | grep "Async Chat Thread"'
}

restart_daemon() {
  kubectl rollout restart deployment/m-ai-daemon
  kubectl rollout status deployment/m-ai-daemon
}

case "${1:-}" in
build-image)
  build_image
  ;;
deploy-image)
  deploy_image
  ;;
list-image-tags)
  list_image_tags
  ;;
build-deploy-image)
  build_image
  deploy_image
  ;;
setup-buildx)
  setup_buildx
  ;;
docker-prune)
  docker_prune
  ;;
get-commands-history)
  get_commands_history
  ;;
restart-daemon)
  restart_daemon
  ;;
fix)
  fix
  ;;
check-ts)
  check_ts
  ;;
generate-grafana)
  generate_grafana
  ;;
setup)
  setup
  ;;
kube-setup)
  kube_setup
  ;;
*)
  cat >&2 <<EOF
Usage: $0 <command>

Commands:
  build-image           Build multi-architecture M-AI images.
  deploy-image          Push built images and create multi-architecture tags.
  list-image-tags       List registry image tags by creation time and size.
  build-deploy-image    Build and deploy images.
  setup-buildx          Create the M-AI multi-architecture Buildx builder.
  docker-prune          Remove local M-AI Buildx resources and images.
  get-commands-history  Print the main player's Minecraft chat commands.
  restart-daemon        Roll out the daemon and pull its latest image.
  fix                   Format and validate the project.
  check-ts              Type-check the project.
  generate-grafana      Generate the Grafana dashboard JSON.
  setup                 Set up the Mindcraft development environment.
  kube-setup            Configure kubectl and install Prometheus Operator.
EOF
  exit 1
  ;;
esac
