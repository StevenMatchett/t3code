import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { MouseButtons } from "@opentui/core/testing";
import type { ReactNode } from "react";

import { createTuiTestDriver, type TuiTestDriver } from "../testing/driver.tsx";
import { basicTerminalCapabilities, richTerminalCapabilities } from "./capabilities.ts";
import { UiProvider } from "./context.tsx";
import { formatKeySequence } from "./KeyHint.tsx";
import { Panel } from "./Panel.tsx";
import { EmptyState, ErrorState } from "./StateMessage.tsx";
import { StatusBadge } from "./StatusBadge.tsx";
import { KeyHint } from "./KeyHint.tsx";
import { resolveGlyph } from "./glyphs.tsx";

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

describe("glyph and key fallbacks", () => {
  it("uses readable ASCII replacements", () => {
    expect(resolveGlyph("success", true)).toBe("✓");
    expect(resolveGlyph("success", false)).toBe("OK");
    expect(resolveGlyph("pending", false)).toBe("...");
    expect(formatKeySequence(["ctrl", "up"], true)).toBe("Ctrl+↑");
    expect(formatKeySequence(["ctrl", "up"], false)).toBe("Ctrl+Up");
  });
});

const runtime = globalThis as typeof globalThis & {
  process?: { getBuiltinModule?: (id: string) => unknown };
};
const describeWithNativeFfi = runtime.process?.getBuiltinModule?.("node:ffi")
  ? describe
  : describe.skip;

function ComponentFrame({ width }: { readonly width: number }) {
  return (
    <UiProvider capabilities={richTerminalCapabilities}>
      <Panel flexDirection="column" gap={1} height={14} title="T3 Code" width={width}>
        <StatusBadge label="Connected" tone="success" />
        <KeyHint keys={["ctrl", "k"]} label="Commands" />
        <EmptyState description="Choose a project to begin." title="No project selected" />
        <ErrorState description="The server closed the connection." title="Connection lost" />
      </Panel>
    </UiProvider>
  );
}

describeWithNativeFfi("TUI component frames", () => {
  for (const width of [40, 80, 120]) {
    it(`renders a stable ${width}-column frame`, async () => {
      const driver = await renderDriver(<ComponentFrame width={width} />, {
        width,
        height: 14,
      });
      const frame = driver.captureFrame();
      const lines = frame.split("\n");

      expect(lines[0]).toHaveLength(width);
      expect(lines.at(-1)).toHaveLength(width);
      expect(frame).toContain("✓ Connected");
      expect(frame).toContain("[Ctrl+K] Commands");
      expect(frame).toContain("◇ No project selected");
      expect(frame).toContain("× Connection lost");
    });
  }

  it("uses ASCII borders, glyphs, and keys without color", async () => {
    const driver = await renderDriver(
      <UiProvider capabilities={basicTerminalCapabilities}>
        <Panel flexDirection="column" height={8} title="T3 Code" width={40}>
          <StatusBadge label="Connected" tone="success" />
          <KeyHint keys={["ctrl", "up"]} label="Move" />
          <ErrorState title="Connection lost" />
        </Panel>
      </UiProvider>,
      { width: 40, height: 8 },
    );

    const frame = driver.captureFrame();
    expect(frame.split("\n")[0]).toMatch(/^\+-T3 Code-+/);
    expect(frame).toContain("OK Connected");
    expect(frame).toContain("[Ctrl+Up] Move");
    expect(frame).toContain("X Connection lost");
    expect(frame).not.toContain("✓");
  });

  it("runs the focused error action from the keyboard and mouse", async () => {
    const onRetry = vi.fn();
    const driver = await renderDriver(
      <ErrorState focused onRetry={onRetry} title="Connection lost" />,
      { width: 40, height: 4 },
    );

    await driver.input.pressKey("x");
    expect(onRetry).not.toHaveBeenCalled();
    await driver.input.pressKey("RETURN");
    expect(onRetry).toHaveBeenCalledOnce();
    await driver.mouse.click(0, 0, MouseButtons.LEFT, { delayMs: 0 });
    expect(onRetry).toHaveBeenCalledTimes(2);
  });
});
