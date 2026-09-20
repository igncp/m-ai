#!/usr/bin/env bash

set -euo pipefail

closure_dir="$1"
system="$2"
system_args=()

git config --system --add safe.directory /app
cd /app

[[ -n "$system" ]] && system_args+=(--system "$system")
nix run .#bun --no-update-lock-file "${system_args[@]}" \
  --option build-users-group "" \
  --extra-experimental-features "nix-command flakes" \
  -- install --frozen-lockfile
nix run .#bun --no-update-lock-file "${system_args[@]}" \
  --option build-users-group "" \
  --extra-experimental-features "nix-command flakes" \
  -- node_modules/typescript/bin/tsc --project tsconfig.build.json
rm -rf node_modules/{*,.[!.]*,..?*}
nix run .#bun --no-update-lock-file "${system_args[@]}" \
  --option build-users-group "" \
  --extra-experimental-features "nix-command flakes" \
  -- install --production --frozen-lockfile
nix build .#container-app --no-update-lock-file "${system_args[@]}" \
  --impure \
  --option build-users-group "" \
  --extra-experimental-features "nix-command flakes"
rm -rf "$closure_dir" "${closure_dir}-index"
mkdir -p "$closure_dir"
mapfile -t closure < <(nix-store -qR result/)
cp -R "${closure[@]}" "$closure_dir/"
chmod -R a+rw "$closure_dir"
readlink -f result >"${closure_dir}-index"
