#!/usr/bin/env bash

set -euo pipefail

MAIN_PLAYER="$(cat server/world.json | jq -r .mainPlayer)"

if [ -z "$MAIN_PLAYER" ]; then
  echo "Error: mainPlayer is not set in server/world.json"
  exit 1
fi

docker exec -it \
  minecraft_server \
  /bin/bash -c \
  "(ls -1v logs/*.log.gz | xargs zcat -f; cat logs/latest.log) | grep $MAIN_PLAYER | grep 'Async Chat Thread'"
