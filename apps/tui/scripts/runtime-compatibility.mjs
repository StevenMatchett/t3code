import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

export const MINIMUM_TUI_NODE_VERSION = "26.4.0";

const minimumVersion = Object.freeze({ major: 26, minor: 4, patch: 0 });

function parseStableNodeVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return undefined;

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareVersions(left, right) {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

export function inspectTuiRuntime({ nodeVersion, hasFfi }) {
  const nodeResult = inspectTuiNodeVersion(nodeVersion);
  if (!nodeResult.supported) return nodeResult;

  if (!hasFfi) {
    return {
      supported: false,
      message:
        "T3 Code TUI requires Node.js experimental FFI. " +
        "Start the TUI with the --experimental-ffi Node flag.",
    };
  }

  return { supported: true };
}

export function inspectTuiNodeVersion(nodeVersion) {
  const parsed = parseStableNodeVersion(nodeVersion);
  if (!parsed || compareVersions(parsed, minimumVersion) < 0) {
    return {
      supported: false,
      message:
        `T3 Code TUI requires Node.js ${MINIMUM_TUI_NODE_VERSION} or newer; ` +
        `found ${nodeVersion}. Run the TUI in a separate Node 26.4+ process.`,
    };
  }
  return { supported: true };
}

export function inspectCurrentTuiRuntime() {
  return inspectTuiRuntime({
    nodeVersion: NodeProcess.versions.node,
    hasFfi: NodeProcess.getBuiltinModule?.("node:ffi") !== undefined,
  });
}

export function assertCurrentTuiRuntime() {
  const result = inspectCurrentTuiRuntime();
  if (!result.supported) throw new Error(result.message);
}

if (NodeURL.pathToFileURL(NodeProcess.argv[1] ?? "").href === import.meta.url) {
  try {
    assertCurrentTuiRuntime();
    NodeProcess.stdout.write(
      `T3 Code TUI runtime ready: Node ${NodeProcess.versions.node} with FFI.\n`,
    );
  } catch (error) {
    NodeProcess.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    NodeProcess.default.exitCode = 1;
  }
}
