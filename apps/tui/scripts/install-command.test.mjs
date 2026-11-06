import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import * as NodeURL from "node:url";

const installer = NodeURL.fileURLToPath(new URL("./install-command.mjs", import.meta.url));

const install = (env) =>
  NodeChildProcess.spawnSync(process.execPath, [installer], {
    env,
    encoding: "utf8",
    timeout: 10_000,
  });

NodeTest.test("installs a t3tui command that forwards to start-tui.sh", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-tui-install-"));
  const fakeBin = NodePath.join(root, "fake-bin");
  const log = NodePath.join(root, "npx.log");
  await NodeFSP.mkdir(fakeBin);
  await NodeFSP.writeFile(
    NodePath.join(fakeBin, "npx"),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "$TUI_INSTALL_TEST_LOG"\n`,
    { mode: 0o755 },
  );
  const command = NodePath.join(root, ".local", "bin", "t3tui");
  try {
    const env = { ...process.env, HOME: root, PATH: `${fakeBin}:${process.env.PATH}` };
    const first = install(env);
    NodeAssert.equal(first.status, 0, first.stderr);
    NodeAssert.match(first.stdout, /Installed the t3tui command/);
    NodeAssert.match(first.stdout, /is not on your PATH yet/);

    const onPath = install({ ...env, PATH: `${NodePath.dirname(command)}:${env.PATH}` });
    NodeAssert.equal(onPath.status, 0, onPath.stderr);
    NodeAssert.doesNotMatch(onPath.stdout, /not on your PATH/);

    const run = NodeChildProcess.spawnSync(command, ["--help"], {
      env: { ...env, TUI_INSTALL_TEST_LOG: log },
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
    });
    NodeAssert.equal(run.status, 0, run.stderr);
    NodeAssert.match(await NodeFSP.readFile(log, "utf8"), /dist\/cli\/bin\.js --help$/m);

    await NodeFSP.writeFile(command, "#!/bin/sh\necho someone else\n");
    const foreign = install(env);
    NodeAssert.equal(foreign.status, 1);
    NodeAssert.match(foreign.stderr, /was left alone/);
    NodeAssert.equal(await NodeFSP.readFile(command, "utf8"), "#!/bin/sh\necho someone else\n");
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
