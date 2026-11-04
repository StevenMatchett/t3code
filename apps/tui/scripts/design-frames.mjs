#!/usr/bin/env node
// Renders canonical screens and interaction sequences into a temp directory, as text and images.
// From apps/tui: node scripts/design-frames.mjs [scene-regex]
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = process.env.T3_TUI_FRAMES_DIR ?? mkdtempSync(join(tmpdir(), "t3-tui-frames-"));
const result = spawnSync(
  "npx",
  [
    "--yes",
    "node@26.4.0",
    "./scripts/run-with-node-ffi.mjs",
    "./node_modules/vite-plus/bin/vp",
    "test",
    "run",
    "--root",
    ".",
    "scripts/design-frames.test.tsx",
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      T3_TUI_FRAMES_DIR: output,
      ...(process.argv[2] ? { T3_TUI_FRAMES_ONLY: process.argv[2] } : {}),
    },
  },
);
process.stdout.write(`Frames: ${output}\n`);
process.exit(result.status ?? 1);
