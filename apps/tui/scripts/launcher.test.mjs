import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import * as NodeURL from "node:url";

const launcher = NodeURL.fileURLToPath(new URL("../../../start-tui.sh", import.meta.url));

NodeTest.test(
  "--link-and-pair authorizes, pairs, and launches against the same server",
  async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-tui-link-pair-"));
    const bin = NodePath.join(root, "bin");
    const log = NodePath.join(root, "commands.log");
    const home = NodePath.join(root, "t3-home");
    await NodeFSP.mkdir(bin);
    await NodeFSP.writeFile(
      NodePath.join(bin, "npx"),
      `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$TUI_LAUNCHER_TEST_LOG"
case "$*" in
  *'t3@latest connect link'*) exit 0 ;;
  *'t3@latest pair'*) printf '%s\\n' 'Pairing URL: http://127.0.0.1:3773/pair#token=fixture-secret' ;;
  *'--pair-stdin'*)
    IFS= read -r url
    [[ "$url" == 'http://127.0.0.1:3773/pair#token=fixture-secret' ]]
    ;;
esac
`,
      { mode: 0o755 },
    );
    try {
      const env = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        HOME: root,
        T3CODE_HOME: home,
        TUI_LAUNCHER_TEST_LOG: log,
      };
      const help = NodeChildProcess.spawnSync("bash", [launcher, "--link-and-pair", "--help"], {
        env,
        encoding: "utf8",
        timeout: 10_000,
      });
      NodeAssert.ifError(help.error);
      NodeAssert.equal(help.status, 0, help.stderr);
      NodeAssert.match(help.stdout, /--link-and-pair/);
      NodeAssert.ok(!(await NodeFSP.readFile(log, "utf8")).includes("t3@latest"));
      await NodeFSP.writeFile(log, "");

      const result = NodeChildProcess.spawnSync("bash", [launcher, "--link-and-pair"], {
        env,
        encoding: "utf8",
        timeout: 10_000,
      });
      NodeAssert.ifError(result.error);
      NodeAssert.equal(result.status, 0, result.stderr);
      const commands = (await NodeFSP.readFile(log, "utf8")).trim().split("\n");
      NodeAssert.equal(commands.length, 5);
      NodeAssert.match(commands[1], new RegExp(`t3@latest connect link --base-dir ${home}$`));
      NodeAssert.match(
        commands[2],
        new RegExp(`t3@latest pair --base-dir ${home} --label T3 TUI$`),
      );
      NodeAssert.match(commands[3], /--connect http:\/\/127\.0\.0\.1:3773 --pair-stdin$/);
      NodeAssert.match(commands[4], /--connect http:\/\/127\.0\.0\.1:3773$/);
      NodeAssert.ok(
        !`${result.stdout}${result.stderr}${commands.join("\n")}`.includes("fixture-secret"),
      );
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  },
);
