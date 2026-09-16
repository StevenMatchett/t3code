#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"

node_runner=(npx --yes node@26.4.0)

"${node_runner[@]}" apps/tui/node_modules/typescript/bin/tsc \
  --noEmit false \
  --outDir apps/tui/dist \
  -p apps/tui/tsconfig.json \
  --noCheck

exec "${node_runner[@]}" \
  apps/tui/scripts/run-with-node-ffi.mjs \
  apps/tui/dist/cli/bin.js \
  "$@"
