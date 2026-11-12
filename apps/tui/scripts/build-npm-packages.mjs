// Builds the npm packages behind `npx t3tui` into a new output directory:
//
//   t3tui-<platform>-<arch>-<version>.tgz  this host's self-contained TUI + server
//   t3tui-<version>.tgz                    the launcher, which lists every platform
//                                          package as an optional dependency
//
// Pass `--platforms linux-x64,darwin-arm64` to name only the platform packages
// you will publish. Each platform package must be built on its own platform (native renderer,
// node-pty, keyring). Publish the tarballs, not directories: `npm publish <dir>`
// drops `node_modules/`, while `npm publish <tarball>` uploads the bytes as given.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

import { artifactChecksums, buildTuiArtifact } from "./build-artifact.mjs";

export const NPM_PLATFORMS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-x64",
];
const repository = {
  type: "git",
  url: "git+https://github.com/StevenMatchett/t3code.git",
  directory: "apps/tui",
};
const readJson = async (path) => JSON.parse(await NodeFSP.readFile(path, "utf8"));
const writeJson = (path, value) => NodeFSP.writeFile(path, `${JSON.stringify(value, null, 2)}\n`);

function tar(tarball, stageDirectory) {
  const result = NodeChildProcess.spawnSync(
    "tar",
    ["-czf", tarball, "-C", stageDirectory, "package"],
    { stdio: "inherit" },
  );
  if (result.status !== 0) throw new Error(`tar failed for ${tarball}`);
}

/** Every top-level package in `node_modules` at the version on disk. */
async function bundledPackages(nodeModules) {
  const bundled = {};
  for (const entry of await NodeFSP.readdir(nodeModules)) {
    if (entry.startsWith(".")) continue;
    const names = entry.startsWith("@")
      ? (await NodeFSP.readdir(NodePath.join(nodeModules, entry))).map((name) => `${entry}/${name}`)
      : [entry];
    for (const name of names) {
      bundled[name] = (await readJson(NodePath.join(nodeModules, name, "package.json"))).version;
    }
  }
  return bundled;
}

const readme = (title, body) =>
  [
    `# ${title}`,
    "",
    body,
    "",
    "```sh",
    "npx t3tui",
    "```",
    "",
    "Source and documentation: https://github.com/StevenMatchett/t3code",
    "",
  ].join("\n");

/**
 * `platforms` limits which platform packages the launcher depends on. A launcher
 * must only name packages that are published at the same version.
 */
export async function buildTuiNpmPackages({ directory, platforms = NPM_PLATFORMS }) {
  const unknown = platforms.filter((platform) => !NPM_PLATFORMS.includes(platform));
  if (unknown.length > 0) throw new Error(`Unknown platforms: ${unknown.join(", ")}`);
  const output = NodePath.resolve(directory);
  await NodeFSP.mkdir(output);
  const platformStage = NodePath.join(output, "platform");
  const launcherStage = NodePath.join(output, "launcher");
  await NodeFSP.mkdir(platformStage);
  await NodeFSP.mkdir(launcherStage);

  const { directory: packageDirectory, metadata } = await buildTuiArtifact({
    directory: NodePath.join(platformStage, "package"),
  });
  const key = `${metadata.target.platform}-${metadata.target.arch}`;
  if (!platforms.includes(key)) throw new Error(`${key} is not in the selected platforms`);
  if (metadata.target.libc === "musl") throw new Error("npm packages are built against glibc");
  const version = metadata.version;

  // npm prunes anything undeclared, so every bundled package is a pinned bundled dependency.
  const bundled = await bundledPackages(NodePath.join(packageDirectory, "node_modules"));
  const bundleDependencies = Object.keys(bundled).sort();
  await writeJson(NodePath.join(packageDirectory, "package.json"), {
    name: `t3tui-${key}`,
    version,
    description: `T3 TUI and its bundled T3 server for ${key}. Install t3tui instead.`,
    license: "MIT",
    repository,
    type: "module",
    os: [metadata.target.platform],
    cpu: [metadata.target.arch],
    preferUnplugged: true,
    dependencies: Object.fromEntries(bundleDependencies.map((name) => [name, bundled[name]])),
    bundleDependencies,
  });
  await NodeFSP.writeFile(
    NodePath.join(packageDirectory, "README.md"),
    readme(
      `t3tui-${key}`,
      `The T3 TUI and its bundled T3 server for ${key}. Do not install this package directly: ` +
        "it is an optional dependency of `t3tui`, which picks the package for the current platform.",
    ),
  );
  await writeJson(NodePath.join(packageDirectory, "checksums.json"), {
    algorithm: "sha256",
    files: await artifactChecksums(packageDirectory),
  });
  const platformTarball = NodePath.join(output, `t3tui-${key}-${version}.tgz`);
  tar(platformTarball, platformStage);

  const launcherDirectory = NodePath.join(launcherStage, "package");
  await NodeFSP.mkdir(NodePath.join(launcherDirectory, "bin"), { recursive: true });
  const launcherSource = await NodeFSP.readFile(
    new URL("npm-launcher.cjs", import.meta.url),
    "utf8",
  );
  await NodeFSP.writeFile(
    NodePath.join(launcherDirectory, "bin", "t3tui.js"),
    launcherSource.replace("__SUPPORTED_PLATFORMS__", JSON.stringify(platforms)),
    { mode: 0o755 },
  );
  await NodeFSP.copyFile(
    NodePath.join(packageDirectory, "LICENSE"),
    NodePath.join(launcherDirectory, "LICENSE"),
  );
  await writeJson(NodePath.join(launcherDirectory, "package.json"), {
    name: "t3tui",
    version,
    description: "Terminal UI for T3 Code with a bundled background T3 server. Run `npx t3tui`.",
    license: "MIT",
    repository,
    bin: { t3tui: "./bin/t3tui.js" },
    optionalDependencies: Object.fromEntries(
      platforms.map((platform) => [`t3tui-${platform}`, version]),
    ),
  });
  await NodeFSP.writeFile(
    NodePath.join(launcherDirectory, "README.md"),
    readme(
      "t3tui",
      "A terminal UI for T3 Code. The first launch installs a local T3 server as a background " +
        "service (systemd --user on Linux, launchd on macOS) and pairs with it. " +
        "Manage it with `t3tui daemon status|start|stop|restart|uninstall`. Requires Node 26.4+ " +
        "(older Node versions borrow Node 26 from npm).",
    ),
  );
  const launcherTarball = NodePath.join(output, `t3tui-${version}.tgz`);
  tar(launcherTarball, launcherStage);

  return { output, version, platform: key, platformTarball, launcherTarball };
}

if (import.meta.url === NodeURL.pathToFileURL(NodeProcess.argv[1] ?? "").href) {
  const { values, positionals } = NodeUtil.parseArgs({
    allowPositionals: true,
    options: { platforms: { type: "string" } },
  });
  if (positionals.length !== 1)
    throw new Error("Usage: build-npm-packages.mjs <new-output-directory> [--platforms a,b]");
  const result = await buildTuiNpmPackages({
    directory: positionals[0],
    ...(values.platforms ? { platforms: values.platforms.split(",") } : {}),
  });
  NodeProcess.stdout.write(`${result.platformTarball}\n${result.launcherTarball}\n`);
}
