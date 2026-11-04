// Opt-in measurement: T3_TUI_PERF=1 through run-with-node-ffi and `vp test run scripts/perf-baseline.test.tsx`.
// Measures input-to-frame on a 5,000-row thread with the real renderer pipeline.
import { it } from "@effect/vitest";
import { act } from "react";
import { AppShell } from "../src/renderer/AppShell.tsx";
import { createTuiTestDriver } from "../src/testing/driver.tsx";
import {
  assistantMessage,
  longTranscript,
  makeDesignFixture,
  runningTurn,
  updateThread,
} from "../src/testing/designFixture.ts";

const PAGE_UP = "\u001b[5~";
const percentile = (values: readonly number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))]!;
};
const summary = (name: string, values: readonly number[], cpuMs = 0) =>
  `${name}: p50 ${percentile(values, 50).toFixed(1)}ms p95 ${percentile(values, 95).toFixed(1)}ms max ${Math.max(...values).toFixed(1)}ms cpu/op ${(cpuMs / values.length).toFixed(1)}ms (n=${values.length})`;

it.skipIf(!process.env.T3_TUI_PERF)(
  "measures input-to-frame on a 5,000-row thread",
  async () => {
    const fixture = makeDesignFixture();
    const driver = await createTuiTestDriver(<AppShell client={fixture.client} />, {
      width: 120,
      height: 40,
      kittyKeyboard: true,
    });
    const release = driver.registry.mount(fixture.states[0]!);
    await act(async () =>
      updateThread(driver.registry, fixture, 0, (thread) => ({
        ...thread,
        latestTurn: runningTurn,
        messages: longTranscript(Number(process.env.T3_TUI_PERF_ROWS ?? 5_000)),
      })),
    );
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await driver.flush();
    const cpu: Record<string, number> = {};
    let section = "";
    const timed = async (run: () => Promise<void>) => {
      const started = performance.now();
      const startedCpu = process.cpuUsage();
      await run();
      const used = process.cpuUsage(startedCpu);
      cpu[section] = (cpu[section] ?? 0) + (used.user + used.system) / 1_000;
      return performance.now() - started;
    };
    // The test renderer paces frames, so an empty flush shows the floor the numbers below sit on.
    section = "empty flush";
    const floor: number[] = [];
    for (let index = 0; index < 60; index += 1) floor.push(await timed(() => driver.flush()));
    section = "scroll";
    const scroll: number[] = [];
    for (let index = 0; index < 60; index += 1)
      scroll.push(await timed(() => driver.input.pressKey(index % 2 ? "ARROW_DOWN" : PAGE_UP)));
    await driver.input.pressKey("END");
    await driver.input.pressKey("i");
    section = "typing";
    const typing: number[] = [];
    for (let index = 0; index < 120; index += 1)
      typing.push(await timed(() => driver.input.typeText("x")));
    section = "streaming";
    const streaming: number[] = [];
    let text = "";
    for (let index = 0; index < 60; index += 1) {
      text += "more streamed words here ";
      const current = text;
      streaming.push(
        await timed(async () => {
          await act(async () =>
            updateThread(driver.registry, fixture, 0, (thread) => ({
              ...thread,
              messages: [
                ...thread.messages.filter((item) => item.id !== "perf-stream"),
                assistantMessage("perf-stream", current, true),
              ],
            })),
          );
          await driver.flush();
        }),
      );
    }
    process.stdout.write(
      [
        summary("empty flush", floor, cpu["empty flush"]),
        summary("scroll", scroll, cpu.scroll),
        summary("typing", typing, cpu.typing),
        summary("streaming", streaming, cpu.streaming),
      ].join("\n") + "\n",
    );
    release();
    await driver.close();
  },
  300_000,
);
