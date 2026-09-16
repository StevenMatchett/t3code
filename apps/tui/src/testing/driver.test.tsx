import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { MouseButtons } from "@opentui/core/testing";
import { useOnResize } from "@opentui/react";
import { useEffect, useState, type ReactNode } from "react";

import { createTuiTestDriver, type TuiTestDriver } from "./driver.tsx";
import { normalizeFrame } from "./frame.ts";
import { assertNoSecrets, SecretExposureError } from "./secrets.ts";

const activeDrivers = new Set<TuiTestDriver>();

async function renderDriver(
  children: ReactNode,
  options?: Parameters<typeof createTuiTestDriver>[1],
) {
  const driver = await createTuiTestDriver(children, options);
  activeDrivers.add(driver);
  return driver;
}

afterEach(async () => {
  await Promise.all([...activeDrivers].map((driver) => driver.close()));
  activeDrivers.clear();
  vi.restoreAllMocks();
});

describe("normalizeFrame", () => {
  it("normalizes line endings, padding, and caller-declared unstable values", () => {
    expect(
      normalizeFrame("run 48e5-unstable   \r\nstatus ready   \r\n       \r\n", [
        { value: "48e5-unstable", replacement: "<run-id>" },
      ]),
    ).toBe("run <run-id>\nstatus ready");
  });
});

describe("assertNoSecrets", () => {
  it("fails frame and log scans without copying the secret into the error", () => {
    const secret = "bootstrap-secret-fixture";

    for (const sourceName of ["captured frame", "test log"]) {
      let caught: unknown;
      try {
        assertNoSecrets({
          secrets: [{ name: "bootstrap bearer", value: secret }],
          sources: [{ name: sourceName, content: `received ${secret}` }],
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(SecretExposureError);
      expect(caught).toMatchObject({
        secretName: "bootstrap bearer",
        sourceName,
      });
      expect(String(caught)).not.toContain(secret);
    }
  });
});

const runtime = globalThis as typeof globalThis & {
  process?: { getBuiltinModule?: (id: string) => unknown };
};
const describeWithNativeFfi = runtime.process?.getBuiltinModule?.("node:ffi")
  ? describe
  : describe.skip;

describeWithNativeFfi("TUI test driver", () => {
  it("boots through the renderer runtime and captures a normalized frame", async () => {
    const cleanup = vi.fn();

    function Harness() {
      useEffect(() => cleanup, []);
      return <text>run 48e5-unstable</text>;
    }

    const driver = await renderDriver(<Harness />, {
      width: 24,
      height: 4,
      frameReplacements: [{ value: "48e5-unstable", replacement: "<run-id>" }],
    });

    expect(driver.captureFrame()).toBe("run <run-id>");
    expect(driver.captureRawFrame()).toContain("48e5-unstable");
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("drives key input, bracketed paste, mouse input, and resize", async () => {
    function Harness() {
      const [value, setValue] = useState("");
      const [clicks, setClicks] = useState(0);
      const [size, setSize] = useState("24x6");
      useOnResize((width, height) => setSize(`${width}x${height}`));

      return (
        <box flexDirection="column" width="100%" height="100%">
          <input focused value={value} onInput={setValue} />
          <box width={12} height={1} onMouseDown={() => setClicks((count) => count + 1)}>
            <text>click target</text>
          </box>
          <text>value={value}</text>
          <text>clicks={clicks}</text>
          <text>size={size}</text>
        </box>
      );
    }

    const driver = await renderDriver(<Harness />, { width: 24, height: 6 });
    await driver.input.typeText("key");
    await driver.input.pressKey("-");
    await driver.input.paste("paste");
    await driver.mouse.click(0, 1, MouseButtons.LEFT, { delayMs: 0 });
    await driver.resize(16, 7);

    expect(driver.renderer.width).toBe(16);
    expect(driver.renderer.height).toBe(7);
    expect(driver.captureFrame()).toContain("value=key-paste");
    expect(driver.captureFrame()).toContain("clicks=1");
    expect(driver.captureFrame()).toContain("size=16x7");
  });

  it("unmounts React and disposes the registry once", async () => {
    const cleanup = vi.fn();

    function Harness() {
      useEffect(() => cleanup, []);
      return <text>mounted</text>;
    }

    const driver = await renderDriver(<Harness />);
    const dispose = vi.spyOn(driver.registry, "dispose");

    const firstClose = driver.close();
    const secondClose = driver.close();
    expect(firstClose).toBe(secondClose);
    await firstClose;

    expect(driver.renderer.isDestroyed).toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
