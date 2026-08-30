#!/usr/bin/env bash

set -euo pipefail

cd mindcraft

git reset --hard
rm -f profiles/a1.json profiles/a2.json
git apply ../mindcraft-changes.diff

if [ ! -d node_modules ]; then
  npm i
fi

if [ ! -d ../block/node_modules ]; then
  (cd ../block && npm i)
fi

# For a system with 24GB+
ollama pull sweaterdog/andy-4:micro-q8_0 && ollama pull embeddinggemma

echo "setup.sh succeeded"
