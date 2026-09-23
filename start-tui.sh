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

has_port=false
needs_server=false
link_and_pair=false
show_help=false
show_version=false
launch_args=()
for argument in "$@"; do
  case "$argument" in
    --link-and-pair) link_and_pair=true ;;
    --port | --port=*) has_port=true ;;
    --new-environment) needs_server=true ;;
    -h | --help) needs_server=false; show_help=true ;;
    -v | --version) needs_server=false; show_version=true ;;
  esac
  if [[ "$argument" != --link-and-pair ]]; then
    launch_args+=("$argument")
  fi
done

if [[ "$show_version" == true ]]; then
  link_and_pair=false
fi

if [[ "$show_help" == true ]]; then
  "${node_runner[@]}" \
    apps/tui/scripts/run-with-node-ffi.mjs \
    apps/tui/dist/cli/bin.js \
    "${launch_args[@]}"
  printf '\nLauncher option:\n  --link-and-pair   Link T3 Connect, pair this TUI, and start it\n'
  exit 0
fi

if [[ "$link_and_pair" == true ]]; then
  for argument in "${launch_args[@]}"; do
    case "$argument" in
      --connect | --connect=* | --pair-stdin | --new-environment)
        printf '%s\n' '--link-and-pair cannot be combined with --connect, --pair-stdin, or --new-environment.' >&2
        exit 2
        ;;
    esac
  done
fi

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

if [[ "$link_and_pair" == true ]]; then
  t3_home="${T3CODE_HOME:-$HOME/.t3}"
  npx --yes t3@latest connect link --base-dir "$t3_home"
  pair_url="$(npx --yes t3@latest pair --base-dir "$t3_home" --label 'T3 TUI' \
    | sed -n 's/^Pairing URL: //p')"
  if [[ ! "$pair_url" =~ ^(https?://[^/]+)/pair#[^[:space:]]+$ ]]; then
    printf '%s\n' 'Could not read a direct pairing URL from t3 pair.' >&2
    exit 1
  fi
  origin="${BASH_REMATCH[1]}"
  printf '%s\n' "$pair_url" | "${node_runner[@]}" \
    apps/tui/scripts/run-with-node-ffi.mjs \
    apps/tui/dist/cli/bin.js \
    --connect "$origin" --pair-stdin "${launch_args[@]}"
  launch_args=(--connect "$origin" "${launch_args[@]}")
fi

exec "${node_runner[@]}" \
  apps/tui/scripts/run-with-node-ffi.mjs \
  apps/tui/dist/cli/bin.js \
  "${launch_args[@]}"
