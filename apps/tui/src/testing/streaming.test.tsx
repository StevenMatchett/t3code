import { afterEach, describe, expect, it } from "@effect/vitest";
import { SyntaxStyle, TextareaRenderable } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { Effect } from "effect";
import { act } from "react";

import { createTuiTestDriver, type TuiTestDriver } from "./driver.tsx";
import { makeStreamingSpikeFixture, StreamingSpike } from "./StreamingSpike.tsx";

const resources: Array<{ driver: TuiTestDriver; style: SyntaxStyle }> = [];

async function renderSpike(width = 80, height = 24) {
  const fixture = makeStreamingSpikeFixture();
  const style = SyntaxStyle.fromStyles({ default: { fg: "#ffffff" } });
  let driver: TuiTestDriver;
  try {
    driver = await createTuiTestDriver(<StreamingSpike fixture={fixture} syntaxStyle={style} />, {
      width,
      height,
    });
  } catch (error) {
    style.destroy();
    throw error;
  }
  resources.push({ driver, style });
  const composer = driver.renderer.root.findDescendantById("spike-composer");
  expect(composer).toBeInstanceOf(TextareaRenderable);
  return { driver, fixture, composer: composer as TextareaRenderable };
}

function percentile(samples: readonly number[], fraction: number) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1]!;
}

afterEach(async () => {
  for (const { driver, style } of resources.splice(0)) {
    await driver.close();
    style.destroy();
  }
});

describe("phase-0 streaming fixture", () => {
  it.each([
    [40, 10],
    [50, 14],
    [80, 24],
    [100, 30],
    [140, 40],
    [200, 60],
  ])("mounts only visible rows at %ix%i", async (width, height) => {
    const { driver, fixture } = await renderSpike(width, height);
    expect(fixture.mountedRows.size).toBe(height - 9);
    expect(fixture.mountedRows.has(2_500)).toBe(true);
    expect(fixture.renders.size).toBe(height - 9);
    expect(driver.captureFrame()).toContain("> Recorded activity 2500");
    expect(driver.captureFrame()).toContain("Streaming response");
    expect(driver.captureFrame()).toContain("const update = 0;");
    expect(driver.captureRawFrame().split("\n").length).toBeLessThanOrEqual(height + 1);
    await driver.close();
    expect(fixture.mountedRows.size).toBe(0);
    expect(driver.registry.getNodes().size).toBe(0);
  });

  it("keeps draft, cursor, selected row, and picker selection through resize", async () => {
    const { driver, fixture, composer } = await renderSpike();
    await driver.input.paste("draft 漢字 e\u0301\nsecond line");
    await driver.input.pressKey("ARROW_LEFT");
    const cursor = composer.cursorOffset;
    await driver.mouse.click(1, 2, MouseButtons.LEFT, { delayMs: 0 });
    expect(driver.captureFrame()).toContain("Selected 2501");
    await driver.input.pressKey("F6");
    await driver.input.pressKey("ARROW_DOWN");
    for (const [width, height] of [
      [50, 14],
      [140, 40],
      [80, 24],
    ]) {
      await driver.resize(width!, height!);
      expect(driver.captureFrame()).toContain("Selected 2501 | Choice 1");
      expect(driver.captureFrame()).toContain("Second choice");
      expect(composer.plainText).toBe("draft 漢字 e\u0301\nsecond line");
      expect(composer.cursorOffset).toBe(cursor);
      expect(fixture.mountedRows.has(2_501)).toBe(true);
    }
    await driver.input.pressKey("RETURN");
    expect(composer.focused).toBe(true);
    await driver.input.typeText("!");
    expect(composer.plainText).toBe("draft 漢字 e\u0301\nsecond lin!e");
    expect(driver.captureFrame()).not.toContain("Second choice");
  });

  it("does not rerender recorded rows for streaming or offscreen atom updates", async () => {
    const { driver, fixture } = await renderSpike();
    const renders = new Map(fixture.renders);
    await act(async () => {
      driver.registry.set(fixture.rows[0]!, "changed offscreen");
      driver.registry.set(fixture.stream, {
        markdown: "New **stream**",
        code: "const update = 1;",
      });
    });
    await driver.flush();
    expect(fixture.renders).toEqual(renders);
    expect(driver.captureFrame()).toContain("New stream");
    expect(driver.captureFrame()).not.toContain("changed offscreen");
    const nodes = driver.registry.getNodes();
    expect(nodes.get(fixture.rows[0]!)?.listeners.size ?? 0).toBe(0);
  });

  it.live(
    "keeps input p95 below 50ms during 100 streamed updates at 20Hz",
    () =>
      Effect.gen(function* () {
        const { driver, fixture, composer } = yield* Effect.promise(() => renderSpike(140, 40));
        const latencies: number[] = [];
        const started = performance.now();
        let markdown = "Streaming **response**";
        for (let update = 1; update <= 100; update += 1) {
          const due = started + update * 50;
          yield* Effect.sleep(Math.max(0, due - performance.now()));
          markdown += ` token${update}`;
          const beforeInput = performance.now();
          yield* Effect.promise(async () => {
            await act(async () => {
              driver.registry.set(fixture.stream, { markdown, code: `const update = ${update};` });
              await driver.input.pressKey("x");
            });
            await driver.flush();
          });
          expect(composer.plainText).toBe("x".repeat(update));
          expect(driver.captureFrame()).toContain("const update = " + update + ";");
          latencies.push(performance.now() - beforeInput);
        }
        const p95 = percentile(latencies, 0.95);
        yield* Effect.logInfo({
          fixture: "phase-0-fixed-row-stream",
          node: process.versions.node,
          rows: 5_000,
          mountedRows: fixture.mountedRows.size,
          samples: latencies.length,
          elapsedMs: performance.now() - started,
          inputP95Ms: p95,
          inputMaxMs: Math.max(...latencies),
        });
        expect(p95).toBeLessThan(50);
      }),
    15_000,
  );
});
