#!/usr/bin/env bash

set -euo pipefail

if [[ -f .env ]]; then
  source .env
fi

REGISTRY_HOST="${M_AI_REGISTRY_HOST:-localhost:5000}"
IMAGE_NAME="${M_AI_IMAGE:-$REGISTRY_HOST/m-ai:latest}"
IMAGE_REPOSITORY="${IMAGE_NAME%:*}"
IMAGE_TAGS=(
  "$(git rev-parse HEAD)"
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
      bash /app/scripts/build_image.sh "/app/$closure_dir" "$system"

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

  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Refusing to deploy an image from a worktree with uncommitted changes." >&2
    exit 1
  fi

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
  local registry_url="http://${REGISTRY_HOST}"
  local repository="${IMAGE_REPOSITORY#"${REGISTRY_HOST}/"}"
  local tags
  local -a created_values

  tags="$(curl --fail --silent --show-error "${registry_url}/v2/${repository}/tags/list" | jq -r '.tags[]?')"

  while IFS= read -r tag; do
    [[ -z "$tag" ]] && continue
    created_values=()
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
      config_digest="$(jq -r '.config.digest' <<<"$platform_manifest")"
      config="$(curl --fail --silent --show-error \
        "${registry_url}/v2/${repository}/blobs/${config_digest}")"
      created_values+=("$(jq -r '.created // empty' <<<"$config")")
    done

    created=""
    while IFS= read -r created_value; do
      created="$created_value"
      break
    done < <(printf '%s\n' "${created_values[@]}" | sort -r)
    [[ -z "$created" ]] && continue
    printf '%s\t%s\t%s\n' "$created" "$(numfmt --to=iec-i --suffix=B "$size")" "$tag"
  done <<<"$tags" | sort -r
}

use_latest_image() {
  local local_config="k8s/overlays/local.yaml"
  local local_image
  local local_repository
  local latest_tag=""
  local tag

  if [[ ! -f "$local_config" ]]; then
    echo "Error: local Kubernetes configuration does not exist: $local_config" >&2
    exit 1
  fi

  local_image="$(sed -n 's/^  image: //p' "$local_config")"
  local_repository="${local_image%:*}"

  if [[ -z "$local_image" || "$local_repository" == "$local_image" ]]; then
    echo "Error: no tagged image found in $local_config" >&2
    exit 1
  fi

  REGISTRY_HOST="${local_repository%%/*}"
  IMAGE_REPOSITORY="$local_repository"

  while IFS=$'\t' read -r _ _ tag; do
    if [[ "$tag" =~ ^[0-9a-f]{40}$ ]]; then
      latest_tag="$tag"
      break
    fi
  done < <(list_image_tags)

  if [[ -z "$latest_tag" ]]; then
    echo "Error: no commit image tags found in $IMAGE_REPOSITORY" >&2
    exit 1
  fi

  sed -i \
    "s|^  image: .*|  image: $IMAGE_REPOSITORY:$latest_tag|" \
    "$local_config"
  kubectl apply -k k8s/overlays
  echo "Set local Kubernetes image to $IMAGE_REPOSITORY:$latest_tag"
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

start_registry() {
  local container_name="local-container-registry"

  if docker container inspect "$container_name" >/dev/null 2>&1; then
    docker start "$container_name" >/dev/null
  else
    docker run --detach \
      --name "$container_name" \
      --restart unless-stopped \
      --publish 5000:5000 \
      --volume local-container-registry-data:/var/lib/registry \
      --env REGISTRY_STORAGE_DELETE_ENABLED=true \
      --env REGISTRY_HTTP_ADDR=0.0.0.0:5000 \
      registry:3
  fi

  echo "Container registry is running at localhost:5000."
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
    'for log in logs/*.log.gz; do [[ -e "$log" ]] && zcat -f "$log"; done; cat logs/latest.log' |
    grep "$main_player" | grep "Async Chat Thread" || true
}

restart_daemon() {
  kubectl rollout restart deployment/m-ai-daemon
  kubectl rollout status deployment/m-ai-daemon
}

sync_main_player() {
  local main_player
  local world_id

  main_player="$(kubectl get configmap m-ai-local-config --output=jsonpath='{.data.mainPlayer}')"
  world_id="$(kubectl get configmap minecraft-world --output=jsonpath='{.data.id}')"

  if [[ -z "$main_player" ]]; then
    echo "Error: mainPlayer is not set in ConfigMap m-ai-local-config" >&2
    exit 1
  fi

  if [[ -z "$world_id" ]]; then
    echo "Error: world ID is not set in ConfigMap minecraft-world" >&2
    exit 1
  fi

  if [[ ! "$main_player" =~ ^[A-Za-z0-9_]{3,16}$ ]]; then
    echo "Error: mainPlayer is not a valid Minecraft username: $main_player" >&2
    exit 1
  fi

  if [[ ! "$world_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
    echo "Error: invalid Minecraft world ID: $world_id" >&2
    exit 1
  fi

  kubectl exec deployment/postgres -- \
    psql --set=ON_ERROR_STOP=1 --username=m_ai --dbname=m_ai \
    --command "UPDATE \"World\" SET \"mainPlayer\" = '$main_player' WHERE \"minecraftWorldId\" = '$world_id' RETURNING \"mainPlayer\";"
}

daemon() {
  kubectl exec deployment/m-ai-daemon --container daemon -- \
    /app/result/bin/m-ai "$@"
}

set_world_id() {
  local world_id="$1"

  kubectl create configmap minecraft-world \
    --from-literal="id=$world_id" \
    --dry-run=client \
    --output=yaml | kubectl apply --filename=-
}

export_world() {
  local archive="minecraft-world-$(date +%F-%H%M%S).tar"
  local temporary_archive="${archive}.partial"

  if [[ -e "$archive" || -e "$temporary_archive" ]]; then
    echo "Error: export archive already exists: $archive" >&2
    exit 1
  fi

  if ! kubectl exec deployment/minecraft --container minecraft -- \
    tar -C /data -cf - . >"$temporary_archive"; then
    rm -- "$temporary_archive"
    exit 1
  fi

  mv -- "$temporary_archive" "$archive"
  echo "Exported Minecraft world to $archive"
}

import_world() {
  local archive="${1:-}"
  local world_id

  if [[ -z "$archive" ]]; then
    echo "Usage: $0 import-world <tar-file>" >&2
    exit 1
  fi

  if [[ ! -f "$archive" ]]; then
    echo "Error: archive does not exist: $archive" >&2
    exit 1
  fi

  if ! tar -tf "$archive" >/dev/null; then
    echo "Error: invalid or incomplete archive: $archive" >&2
    exit 1
  fi

  if ! world_id="$(tar -xOf "$archive" ./.m-ai-world-id 2>/dev/null)"; then
    world_id="$(uuidgen)"
  fi

  if [[ ! "$world_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
    echo "Error: archive contains an invalid Minecraft world ID" >&2
    exit 1
  fi

  kubectl exec deployment/minecraft --container minecraft -- \
    sh -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'
  kubectl exec --stdin deployment/minecraft --container minecraft -- \
    tar -C /data -xf - <"$archive"
  kubectl exec deployment/minecraft --container minecraft -- \
    sh -c "printf '%s\\n' '$world_id' > /data/.m-ai-world-id"
  set_world_id "$world_id"
  restart_daemon
  echo "Imported Minecraft world from $archive"
}

new_world() {
  local world_id

  kubectl exec deployment/minecraft --container minecraft -- \
    sh -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'
  world_id="$(uuidgen)"
  kubectl exec deployment/minecraft --container minecraft -- \
    sh -c "printf '%s\\n' '$world_id' > /data/.m-ai-world-id"
  set_world_id "$world_id"
  kubectl rollout restart deployment/minecraft
  kubectl rollout status deployment/minecraft
  restart_daemon
  echo "Created Minecraft world with ID: $world_id"
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
use-latest-image)
  use_latest_image
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
start-registry)
  start_registry
  ;;
get-commands-history)
  get_commands_history
  ;;
restart-daemon)
  restart_daemon
  ;;
sync-main-player)
  sync_main_player
  ;;
d)
  daemon "${@:2}"
  ;;
export-world)
  export_world
  ;;
import-world)
  import_world "${2:-}"
  ;;
new-world)
  new_world
  ;;
fix)
  fix
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
Usage: $0 <command> [arguments]

Commands:
  build-image           Build multi-architecture M-AI images.
  deploy-image          Push built images and create multi-architecture tags.
  list-image-tags       List registry image tags by creation time and size.
  use-latest-image      Set the local Kubernetes image to the newest commit tag.
  build-deploy-image    Build and deploy images.
  setup-buildx          Create the M-AI multi-architecture Buildx builder.
  docker-prune          Remove local M-AI Buildx resources and images.
  start-registry        Start the local container registry.
  get-commands-history  Print the main player's Minecraft chat commands.
  restart-daemon        Roll out the daemon and pull its latest image.
  sync-main-player      Update the active world's player from Kubernetes config.
  d <arguments...>      Run an M-AI CLI command in the daemon pod.
  export-world          Export the Minecraft world to a dated local tar file.
  import-world <file>   Replace the Minecraft world with a local tar file.
  new-world             Clear the Minecraft world and restart its deployment.
  fix                   Format and validate the project.
  generate-grafana      Generate the Grafana dashboard JSON.
  setup                 Set up the Mindcraft development environment.
  kube-setup            Configure kubectl and install Prometheus Operator.
EOF
  exit 1
  ;;
esac
