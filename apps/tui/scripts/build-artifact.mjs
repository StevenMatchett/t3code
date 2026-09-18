import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";
import * as NodeCrypto from "node:crypto";
import { build } from "vite-plus/pack";
import {
  isExternalCliDependency,
  selectCliRuntimeExternalDependencies,
} from "../../../scripts/lib/cli-external-packages.ts";
import { generateThirdPartyLicenseManifest } from "../../../scripts/lib/third-party-licenses.ts";
import { inspectTuiNodeVersion } from "./runtime-compatibility.mjs";
import { stageRuntimePackages } from "./stage-runtime.mjs";

const repoRoot = NodeURL.fileURLToPath(new URL("../../../", import.meta.url));
const tuiDirectory = NodePath.join(repoRoot, "apps/tui");
const serverDirectory = NodePath.join(repoRoot, "apps/server");
const rendererPackages = [
  "@opentui/core",
  "@opentui/react",
  "react",
  "react-devtools-core",
  "scheduler",
  "web-tree-sitter",
  "ws",
];
const isRendererExternal = (id) =>
  rendererPackages.some((name) => id === name || id.startsWith(`${name}/`));
const readJson = async (path) => JSON.parse(await NodeFSP.readFile(path, "utf8"));
const writeJson = (path, value) => NodeFSP.writeFile(path, `${JSON.stringify(value, null, 2)}\n`);

export async function artifactChecksums(directory, prefix = "") {
  const files = [];
  for (const name of (await NodeFSP.readdir(NodePath.join(directory, prefix))).sort()) {
    const relative = prefix ? `${prefix}/${name}` : name;
    if (relative === "checksums.json") continue;
    const path = NodePath.join(directory, relative);
    const stat = await NodeFSP.lstat(path);
    if (stat.isSymbolicLink()) throw new Error("Artifact contains an unexpected symlink");
    if (stat.isDirectory()) files.push(...(await artifactChecksums(directory, relative)));
    else
      files.push({
        path: relative,
        size: stat.size,
        mode: stat.mode & 0o777,
        sha256: NodeCrypto.createHash("sha256")
          .update(await NodeFSP.readFile(path))
          .digest("hex"),
      });
  }
  return files;
}

export async function buildTuiArtifact({ directory } = {}) {
  const compatible = inspectTuiNodeVersion(NodeProcess.versions.node);
  if (!compatible.supported) throw new Error(compatible.message);
  const output = directory
    ? NodePath.resolve(directory)
    : await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-tui-artifact-"));
  if (directory) await NodeFSP.mkdir(output);
  try {
    const tuiPackage = await readJson(NodePath.join(tuiDirectory, "package.json"));
    const serverPackage = await readJson(NodePath.join(serverDirectory, "package.json"));
    const upstream = await readJson(NodePath.join(repoRoot, "UPSTREAM_BASE"));
    const lock = await NodeFSP.readFile(NodePath.join(repoRoot, "pnpm-lock.yaml"));
    const target = {
      platform: NodeProcess.platform,
      arch: NodeProcess.arch,
      ...(NodeProcess.platform === "linux"
        ? { libc: process.report.getReport().header.glibcVersionRuntime ? "glibc" : "musl" }
        : {}),
    };
    if (
      !["darwin", "linux", "win32"].includes(target.platform) ||
      !["arm64", "x64"].includes(target.arch)
    ) {
      throw new Error(`Unsupported artifact target: ${target.platform}-${target.arch}`);
    }
    const openTuiNative = `@opentui/core-${target.platform}-${target.arch}${target.libc === "musl" ? "-musl" : ""}`;
    const fffNative = `@ff-labs/fff-bin-${target.platform}-${target.arch}${target.platform === "linux" ? (target.libc === "musl" ? "-musl" : "-gnu") : ""}`;
    const moduleIds = new Set();
    const common = {
      config: false,
      cwd: repoRoot,
      platform: "node",
      format: "esm",
      target: "node26",
      clean: false,
      dts: false,
      sourcemap: false,
      shims: true,
      envPrefix: "__TUI_UNUSED_BUILD_ENV__",
      plugins: [
        {
          name: "tui-artifact-module-inventory",
          generateBundle(_options, bundle) {
            for (const chunk of Object.values(bundle)) {
              if (chunk.type === "chunk")
                for (const id of Object.keys(chunk.modules)) moduleIds.add(id);
            }
          },
        },
      ],
    };
    await build({
      ...common,
      entry: { tui: NodePath.join(tuiDirectory, "src/cli/bin.ts") },
      outDir: output,
      tsconfig: NodePath.join(tuiDirectory, "tsconfig.json"),
      deps: {
        alwaysBundle: (id) => !isRendererExternal(id),
        neverBundle: isRendererExternal,
        onlyBundle: false,
      },
      define: {
        __TUI_UPSTREAM_BASE__: JSON.stringify(upstream.commit),
        __TUI_SERVER_ENTRY__: JSON.stringify("./server/bin.mjs"),
      },
    });
    await build({
      ...common,
      entry: {
        bin: NodePath.join(serverDirectory, "src/bin.ts"),
        "claude-history-worker": NodePath.join(serverDirectory, "src/claude-history-worker.ts"),
      },
      outDir: NodePath.join(output, "server"),
      deps: {
        alwaysBundle: (id) => !isExternalCliDependency(id),
        neverBundle: isExternalCliDependency,
        onlyBundle: false,
      },
      define: {
        __T3CODE_BUILD_CHANNEL__: JSON.stringify("latest"),
        __T3CODE_BUILD_RELAY_URL__: JSON.stringify(""),
        __T3CODE_BUILD_CLERK_PUBLISHABLE_KEY__: JSON.stringify(""),
        __T3CODE_BUILD_CLERK_CLI_OAUTH_CLIENT_ID__: JSON.stringify(""),
        __T3CODE_BUILD_RELAY_CLIENT_OTLP_TRACES_URL__: JSON.stringify(""),
        __T3CODE_BUILD_RELAY_CLIENT_OTLP_TRACES_DATASET__: JSON.stringify(""),
        __T3CODE_BUILD_RELAY_CLIENT_OTLP_TRACES_TOKEN__: JSON.stringify(""),
      },
    });
    const inventory = await stageRuntimePackages({
      roots: [
        ...rendererPackages.map((name) => ({ name, fromDirectory: tuiDirectory })),
        ...Object.keys(selectCliRuntimeExternalDependencies(serverPackage.dependencies)).map(
          (name) => ({ name, fromDirectory: serverDirectory }),
        ),
      ],
      destination: NodePath.join(output, "node_modules"),
      target,
    });
    for (const name of [openTuiNative, fffNative]) {
      if (!inventory.packages.some((pkg) => pkg.name === name))
        throw new Error(`Missing native package for ${target.platform}-${target.arch}: ${name}`);
    }
    if (target.platform !== "win32") {
      for (const folder of ["build/Release", `prebuilds/${target.platform}-${target.arch}`]) {
        const helper = NodePath.join(output, "node_modules/node-pty", folder, "spawn-helper");
        try {
          await NodeFSP.chmod(helper, 0o755);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
    }
    for (const name of ["LICENSE", "NOTICE", "UPSTREAM_BASE"])
      await NodeFSP.copyFile(NodePath.join(repoRoot, name), NodePath.join(output, name));
    for (const [source, targetName] of [
      ["artifact-launcher.mjs", "t3-tui.mjs"],
      ["runtime-compatibility.mjs", "runtime-compatibility.mjs"],
    ]) {
      await NodeFSP.copyFile(new URL(source, import.meta.url), NodePath.join(output, targetName));
    }
    await NodeFSP.chmod(NodePath.join(output, "t3-tui.mjs"), 0o755);
    const metadata = {
      schemaVersion: 1,
      version: tuiPackage.version,
      serverVersion: serverPackage.version,
      upstreamBase: upstream.commit,
      openTuiVersion: inventory.packages.find((pkg) => pkg.name === "@opentui/core").version,
      target,
      minimumNodeVersion: "26.4.0",
      lockfileSha256: NodeCrypto.createHash("sha256").update(lock).digest("hex"),
      ...inventory,
    };
    await writeJson(NodePath.join(output, "artifact.json"), metadata);
    await writeJson(NodePath.join(output, "package.json"), {
      name: "t3-tui-internal-preview",
      private: true,
      version: tuiPackage.version,
      type: "module",
      license: "MIT",
      bin: { "t3-tui": "./t3-tui.mjs" },
      engines: { node: ">=26.4.0" },
    });
    const notices = await generateThirdPartyLicenseManifest({
      configFile: NodePath.join(repoRoot, "third-party-licenses.config.json"),
      packageManifests: [
        { bundle: "tui", path: NodePath.join(tuiDirectory, "package.json") },
        { bundle: "server", path: NodePath.join(serverDirectory, "package.json") },
      ],
      bundledModuleIds: [
        ...moduleIds,
        ...inventory.packages.map((pkg) => NodePath.join(output, pkg.path, "package.json")),
      ],
      bundleName: "tui-server",
    });
    await writeJson(NodePath.join(output, "third-party-licenses.json"), notices);
    await writeJson(NodePath.join(output, "checksums.json"), {
      algorithm: "sha256",
      files: await artifactChecksums(output),
    });
    return { directory: output, metadata };
  } catch (error) {
    await NodeFSP.rm(output, { recursive: true, force: true });
    throw error;
  }
}

if (import.meta.url === NodeURL.pathToFileURL(NodeProcess.argv[1] ?? "").href) {
  const args = NodeProcess.argv.slice(2);
  if (args.length > 1 || args[0]?.startsWith("-"))
    throw new Error("Usage: build-artifact.mjs [new-output-directory]");
  const result = await buildTuiArtifact({ directory: args[0] });
  NodeProcess.stdout.write(`TUI artifact: ${result.directory}\n`);
}
