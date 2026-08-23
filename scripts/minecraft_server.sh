#!/usr/bin/env bash

set -euo pipefail

PORT="${PORT:-25565}"

mkdir -p server/config

cat >server/bukkit.yml <<"EOF"
# kubectl cp minecraft:bukkit.yml bukkit.yml
settings:
  allow-end: true
  warn-on-overload: true
  permissions-file: permissions.yml
  update-folder: update
  plugin-profiling: false
  connection-throttle: -1
  query-plugins: true
  deprecated-verbose: default
  shutdown-message: Server closed
  minimum-api: none
  use-map-color-cache: true
spawn-limits:
  monsters: 70
  animals: 10
  water-animals: 5
  water-ambient: 20
  water-underground-creature: 5
  axolotls: 5
  ambient: 15
chunk-gc:
  period-in-ticks: 600
ticks-per:
  animal-spawns: 400
  monster-spawns: 1
  water-spawns: 1
  water-ambient-spawns: 1
  water-underground-creature-spawns: 1
  axolotl-spawns: 1
  ambient-spawns: 1
  autosave: 6000
aliases: now-in-commands.yml
EOF

cat >server/spigot.yml <<"EOF"
settings:
  incoming-packet-spam-threshold: -1
EOF

cat >server/config/paper-global.yml <<"EOF"
spam-limiter:
  incoming-packet-threshold: -1
EOF

default_ops=""
for i in $(seq 1 10); do
  if [ -n "$default_ops" ]; then
    default_ops="$default_ops,"
  fi
  default_ops="${default_ops}minion${i}"
done

# Run in a subsell to better support tmux
(

  cd server &&
    docker run \
      -it \
      --rm \
      --name minecraft_server \
      -p "127.0.0.1:${PORT}:${PORT}" \
      -e EULA=TRUE \
      -e VERSION=1.21.1 \
      -e ONLINE_MODE=false \
      -e OPS="${OPS:-$default_ops}" \
      -e RCON_CMDS_STARTUP="time set day,gamerule doDaylightCycle false" \
      -e TYPE=PAPER \
      -e PORT="${PORT}" \
      -v $(pwd):/data \
      itzg/minecraft-server:latest
)
