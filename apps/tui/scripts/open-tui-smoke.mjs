import * as NodeProcess from "node:process";

import { assertCurrentTuiRuntime } from "./runtime-compatibility.mjs";

assertCurrentTuiRuntime();

const { createTestRenderer } = await import("@opentui/core/testing");
const setup = await createTestRenderer({ width: 8, height: 2 });

setup.renderer.destroy();
NodeProcess.stdout.write(
  `OpenTUI native renderer ready: Node ${NodeProcess.versions.node} on ` +
    `${NodeProcess.platform}-${NodeProcess.arch}.\n`,
);
