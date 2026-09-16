#!/usr/bin/env bash

set -eo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"

node_runner=(npx --yes node@26.4.0)

"${node_runner[@]}" apps/tui/node_modules/typescript/bin/tsc \
  --noEmit false \
  --outDir apps/tui/dist \
  -p apps/tui/tsconfig.json \
  --noCheck

launch_args=("$@")
has_port=false
needs_server=true
for argument in "$@"; do
  case "$argument" in
    --port | --port=*) has_port=true ;;
    -h | --help | -v | --version) needs_server=false ;;
  esac
done

if [[ "$has_port" == false && "$needs_server" == true ]]; then
  available_port="$("${node_runner[@]}" -e '
    const net = require("node:net");
    const server = net.createServer();
    server.on("error", (error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        process.stderr.write("Could not allocate a loopback port.\n");
        process.exitCode = 1;
        server.close();
        return;
      }
      process.stdout.write(`${address.port}\n`);
      server.close();
    });
  ')"
  launch_args=(--port "$available_port" "${launch_args[@]}")
  printf 'Starting T3 Code TUI on 127.0.0.1:%s\n' "$available_port" >&2
fi

exec "${node_runner[@]}" \
  apps/tui/scripts/run-with-node-ffi.mjs \
  apps/tui/dist/cli/bin.js \
  "${launch_args[@]}"
