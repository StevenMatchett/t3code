import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs/promises";
import { describe, it } from "node:test";

import {
  inspectTuiNodeVersion,
  inspectTuiRuntime,
  MINIMUM_TUI_NODE_VERSION,
} from "./runtime-compatibility.mjs";

describe("TUI runtime compatibility", () => {
  it("rejects Node releases below OpenTUI's minimum", () => {
    const result = inspectTuiNodeVersion("26.3.0");

    NodeAssert.equal(result.supported, false);
    NodeAssert.match(result.message, /requires Node\.js 26\.4\.0 or newer/u);
  });

  it("accepts stable Node releases at or above OpenTUI's minimum", () => {
    NodeAssert.deepEqual(inspectTuiNodeVersion("26.4.0"), { supported: true });
    NodeAssert.deepEqual(inspectTuiNodeVersion("27.0.1"), { supported: true });
  });

  it("rejects Node when experimental FFI is unavailable", () => {
    const result = inspectTuiRuntime({ nodeVersion: "26.4.0", hasFfi: false });

    NodeAssert.equal(result.supported, false);
    NodeAssert.match(result.message, /--experimental-ffi/u);
  });

  it("accepts a supported Node release with FFI", () => {
    NodeAssert.deepEqual(inspectTuiRuntime({ nodeVersion: "26.4.0", hasFfi: true }), {
      supported: true,
    });
  });

  it("keeps the package engine aligned with the executable gate", async () => {
    const manifest = JSON.parse(
      await NodeFS.readFile(new URL("../package.json", import.meta.url), "utf8"),
    );

    NodeAssert.equal(manifest.engines.node, `>=${MINIMUM_TUI_NODE_VERSION}`);
  });
});
