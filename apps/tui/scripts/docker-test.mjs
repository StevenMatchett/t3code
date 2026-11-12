// Tests `npx t3tui` on a clean Debian machine (systemd as PID 1, only Node and git) that installs
// from a local registry holding freshly built packages. `smoke` runs npx-smoke.mjs there; `shell`
// opens a login shell as the test user. --node picks Node (an older one tests the Node 26
// fallback), --with-claude preinstalls Claude Code, --tarballs reuses a build, --keep leaves it up.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

const { values: flags, positionals } = NodeUtil.parseArgs({
  allowPositionals: true,
  options: {
    node: { type: "string", default: "26.8.2" },
    tarballs: { type: "string" },
    keep: { type: "boolean", default: false },
    "with-claude": { type: "boolean", default: false },
  },
});
const mode = positionals[0] ?? "smoke";
if (!["smoke", "shell"].includes(mode) || positionals.length > 1) {
  throw new Error(
    "Usage: docker-test.mjs [smoke|shell] [--node <version>] [--with-claude] [--tarballs <dir>] [--keep]",
  );
}

const composeFile = NodeURL.fileURLToPath(new URL("../docker/compose.yaml", import.meta.url));
const registry = "http://registry:4873/";
const userEnv = [
  "-e",
  "XDG_RUNTIME_DIR=/run/user/1000",
  "-e",
  "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus",
  "-e",
  `TERM=${NodeProcess.env.TERM ?? "xterm-256color"}`,
];

const dockerInfo = NodeChildProcess.spawnSync(
  "docker",
  ["info", "--format", "{{.ServerVersion}}"],
  {
    encoding: "utf8",
  },
);
if (dockerInfo.status !== 0) {
  NodeProcess.stderr.write(
    `Cannot use Docker: ${(dockerInfo.stderr || dockerInfo.error?.message || "").trim()}\n` +
      "If this is a permission error, run `sudo usermod -aG docker $USER` and then `newgrp docker`,\n" +
      "or run this script with `sudo -E`.\n",
  );
  process.exit(1);
}

let packagesDir = flags.tarballs && NodePath.resolve(flags.tarballs);
const builtPackages = !packagesDir;
if (!packagesDir) {
  packagesDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3tui-docker-packages-"));
  await NodeFSP.rmdir(packagesDir);
  NodeProcess.stdout.write("Building npm packages…\n");
  const { buildTuiNpmPackages } = await import("./build-npm-packages.mjs");
  // A real release names only the platform packages it publishes; this one publishes the host's.
  await buildTuiNpmPackages({
    directory: packagesDir,
    platforms: [`${NodeProcess.platform}-${NodeProcess.arch}`],
  });
}
const tarballs = (await NodeFSP.readdir(packagesDir)).filter((name) => name.endsWith(".tgz"));
const launcher = tarballs.find((name) => /^t3tui-\d/.test(name));
const platformPackages = tarballs.filter((name) => name !== launcher);
if (!launcher || platformPackages.length === 0)
  throw new Error(`No t3tui tarballs in ${packagesDir}`);

const env = {
  ...NodeProcess.env,
  PACKAGES_DIR: packagesDir,
  NODE_VERSION: flags.node,
  INSTALL_CLAUDE: flags["with-claude"] ? "1" : "0",
};
const project = `t3tui-test-node${flags.node.replaceAll(".", "-")}`;

function compose(args, options = {}) {
  const result = NodeChildProcess.spawnSync(
    "docker",
    ["compose", "-f", composeFile, "-p", project, ...args],
    { env, stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit", encoding: "utf8" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`docker compose ${args.join(" ")} exited ${result.status}`);
  }
  return result;
}

const machine = (args, options) => compose(["exec", "-T", ...args], options);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(label, check, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (check()) return;
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

let exitCode = 0;
try {
  // Always start from nothing: the registry keeps packages in memory only.
  compose(["down", "--volumes", "--remove-orphans"], { allowFailure: true });
  compose(["up", "--detach", "--build"]);

  await until("systemd to boot", () => {
    const state = machine(["machine", "systemctl", "is-system-running"], {
      capture: true,
      allowFailure: true,
    }).stdout.trim();
    return state === "running" || state === "degraded";
  });
  await until(
    "the test user's systemd manager",
    () =>
      machine(["machine", "systemctl", "is-active", "--quiet", "user@1000.service"], {
        allowFailure: true,
      }).status === 0,
  );

  // Publish exactly as a release would: platform packages first, then the launcher.
  await until(
    "the registry",
    () =>
      machine(["machine", "curl", "-fsS", "-o", "/dev/null", `${registry}-/ping`], {
        allowFailure: true,
      }).status === 0,
  );
  const login = machine(
    [
      "machine",
      "curl",
      "-fsS",
      "-X",
      "PUT",
      "-H",
      "content-type: application/json",
      "-d",
      JSON.stringify({ name: "publisher", password: "publisher-password" }),
      `${registry}-/user/org.couchdb.user:publisher`,
    ],
    { capture: true },
  );
  const { token } = JSON.parse(login.stdout);
  machine([
    "machine",
    "sh",
    "-c",
    `printf '%s\\n' '//registry:4873/:_authToken=${token}' > /root/.publish-npmrc`,
  ]);
  for (const tarball of [...platformPackages, launcher]) {
    NodeProcess.stdout.write(`Publishing ${tarball} to the test registry…\n`);
    machine([
      "machine",
      "npm",
      "publish",
      "--registry",
      registry,
      "--userconfig",
      "/root/.publish-npmrc",
      "--access",
      "public",
      `/packages/${tarball}`,
    ]);
  }
  // From here the machine's npm resolves everything through the test registry.
  machine(["machine", "sh", "-c", `printf 'registry=${registry}\\n' > /usr/local/etc/npmrc`]);

  if (mode === "smoke") {
    const result = machine(
      [
        "-u",
        "tester",
        "-w",
        "/home/tester",
        ...userEnv,
        "machine",
        "node",
        "/opt/t3tui-test/npx-smoke.mjs",
        "--registry",
        registry,
      ],
      { allowFailure: true },
    );
    exitCode = result.status ?? 1;
  } else {
    NodeProcess.stdout.write(
      [
        "",
        `A clean machine with Node ${flags.node} and t3tui published to a local registry.`,
        "Try:  npx t3tui                 first launch: installs the service, pairs, opens the TUI",
        "      npx t3tui daemon status   the systemd --user service",
        "      journalctl --user -u t3tui",
        "Exit the shell to stop the machine.",
        "",
      ].join("\n"),
    );
    const result = NodeChildProcess.spawnSync(
      "docker",
      [
        "compose",
        "-f",
        composeFile,
        "-p",
        project,
        "exec",
        "-u",
        "tester",
        "-w",
        "/home/tester",
        ...userEnv,
        "machine",
        "bash",
        "--login",
      ],
      { env, stdio: "inherit" },
    );
    exitCode = result.status ?? 0;
  }
} catch (error) {
  NodeProcess.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  exitCode = 1;
} finally {
  if (flags.keep) {
    NodeProcess.stdout.write(
      `Left running. Shell: docker compose -f ${composeFile} -p ${project} exec -u tester machine bash -l\n` +
        `Stop:  docker compose -f ${composeFile} -p ${project} down --volumes\n`,
    );
  } else {
    compose(["down", "--volumes", "--remove-orphans"], { allowFailure: true });
    if (builtPackages) await NodeFSP.rm(packagesDir, { recursive: true, force: true });
  }
}
process.exitCode = exitCode;
