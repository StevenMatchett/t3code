// Puts a `t3tui` command in ~/.local/bin that runs this checkout's start-tui.sh.
// Run by `pnpm run install:tui`; safe to run again after moving the checkout.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const marker = "# Installed by T3 TUI (pnpm run install:tui).";
const launcher = NodeURL.fileURLToPath(new URL("../../../start-tui.sh", import.meta.url));
const binDir = NodePath.join(NodeOS.homedir(), ".local", "bin");
const target = NodePath.join(binDir, "t3tui");

const existing = await NodeFSP.readFile(target, "utf8").catch(() => null);
if (existing !== null && !existing.includes(marker)) {
  process.stderr.write(
    `${target} already exists and was not installed by T3 TUI, so it was left alone.\n` +
      `Remove it and run pnpm run install:tui again, or keep using ${launcher}.\n`,
  );
  process.exitCode = 1;
} else {
  const quoted = `'${launcher.replaceAll("'", `'\\''`)}'`;
  await NodeFSP.mkdir(binDir, { recursive: true });
  await NodeFSP.writeFile(target, `#!/usr/bin/env bash\n${marker}\nexec ${quoted} "$@"\n`, {
    mode: 0o755,
  });
  await NodeFSP.chmod(target, 0o755);

  const onPath = (process.env.PATH ?? "")
    .split(NodePath.delimiter)
    .some((entry) => NodePath.resolve(entry) === binDir);
  process.stdout.write(
    `\nInstalled the t3tui command at ${target}.\n` +
      `It runs ${launcher}, so pass it any launcher option, e.g. t3tui --link-and-pair.\n`,
  );
  if (!onPath) {
    process.stdout.write(
      `\n${binDir} is not on your PATH yet. Add this line to your shell profile\n` +
        `(~/.zshrc or ~/.bashrc), then open a new terminal:\n\n` +
        `  export PATH="$HOME/.local/bin:$PATH"\n`,
    );
  }
}
