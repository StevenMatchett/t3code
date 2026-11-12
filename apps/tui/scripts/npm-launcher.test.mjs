import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeTest from "node:test";

const pty = NodeModule.createRequire(new URL("../../server/package.json", import.meta.url))(
  "node-pty",
);
const key = `${NodeProcess.platform}-${NodeProcess.arch}`;

/** The launcher as npx unpacks it, with a fake TUI and a fake npm that records what it ran. */
async function setup() {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3tui-launcher-"));
  const modules = NodePath.join(root, "cache", "_npx", "0123abcd", "node_modules");
  const launcher = NodePath.join(modules, "t3tui");
  const platformPackage = NodePath.join(modules, "@t3tui", key);
  const fakeBin = NodePath.join(root, "fake-bin");
  const globalBin = NodePath.join(root, "global-bin");
  const home = NodePath.join(root, "home");
  const npmLog = NodePath.join(root, "npm.log");
  for (const dir of [NodePath.join(launcher, "bin"), platformPackage, fakeBin, globalBin, home]) {
    await NodeFSP.mkdir(dir, { recursive: true });
  }
  const source = await NodeFSP.readFile(new URL("npm-launcher.cjs", import.meta.url), "utf8");
  await NodeFSP.writeFile(
    NodePath.join(launcher, "bin", "t3tui.js"),
    source.replace("__SUPPORTED_PLATFORMS__", JSON.stringify([key])),
  );
  await NodeFSP.writeFile(NodePath.join(launcher, "package.json"), '{"version":"9.9.9"}');
  await NodeFSP.writeFile(NodePath.join(platformPackage, "package.json"), "{}");
  await NodeFSP.writeFile(
    NodePath.join(platformPackage, "t3-tui.mjs"),
    'console.log("TUI started", JSON.stringify(process.argv.slice(2)));\n',
  );
  await NodeFSP.writeFile(
    NodePath.join(fakeBin, "npm"),
    `#!/bin/sh\necho "$*" >> "${npmLog}"\nprintf '#!/bin/sh\\n' > "${globalBin}/t3tui"\nchmod +x "${globalBin}/t3tui"\n`,
    { mode: 0o755 },
  );

  const run = (args = [], answer) =>
    new Promise((resolve) => {
      const child = pty.spawn(
        process.execPath,
        [NodePath.join(launcher, "bin", "t3tui.js"), ...args],
        {
          name: "xterm-256color",
          cols: 200,
          rows: 24,
          env: {
            HOME: home,
            PATH: `${NodePath.join(modules, ".bin")}:${fakeBin}:${globalBin}:/usr/bin:/bin`,
          },
        },
      );
      let output = "";
      child.onData((data) => {
        if (!output.includes("[Y/n]") && (output + data).includes("[Y/n]")) {
          child.write(`${answer}\r`);
        }
        output += data;
      });
      child.onExit(({ exitCode }) => resolve({ exitCode, output }));
    });
  const npmCalls = () =>
    NodeFSP.readFile(npmLog, "utf8").then(
      (text) => text.trim().split("\n"),
      () => [],
    );
  return { root, run, npmCalls };
}

NodeTest.test("a yes installs the matching version globally, then the prompt is gone", async () => {
  const { root, run, npmCalls } = await setup();
  try {
    const first = await run([], "");
    NodeAssert.equal(first.exitCode, 0, first.output);
    NodeAssert.match(first.output, /npm install -g t3tui@9\.9\.9/);
    NodeAssert.match(first.output, /Installed\. Next time, just run `t3tui`\./);
    NodeAssert.match(first.output, /TUI started \[\]/);
    NodeAssert.deepEqual(await npmCalls(), ["install --global t3tui@9.9.9"]);

    const second = await run([], "unexpected");
    NodeAssert.doesNotMatch(second.output, /\[Y\/n\]/);
    NodeAssert.match(second.output, /TUI started/);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

NodeTest.test("a no is remembered, and commands never ask", async () => {
  const { root, run, npmCalls } = await setup();
  try {
    const status = await run(["daemon", "status"], "y");
    NodeAssert.doesNotMatch(status.output, /\[Y\/n\]/);
    NodeAssert.match(status.output, /TUI started \["daemon","status"\]/);

    const first = await run([], "n");
    NodeAssert.match(first.output, /Run `npm install -g t3tui` any time/);
    NodeAssert.match(first.output, /TUI started/);

    const second = await run([], "y");
    NodeAssert.doesNotMatch(second.output, /\[Y\/n\]/);
    NodeAssert.deepEqual(await npmCalls(), []);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
