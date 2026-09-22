import { afterEach, describe, expect, it } from "@effect/vitest";
import { parseColor } from "@opentui/core";
import { createTuiTestDriver, type TuiTestDriver } from "../testing/driver.tsx";
import { richTerminalCapabilities } from "./capabilities.ts";
import { UiProvider } from "./context.tsx";
import { ConversationText } from "./ShellCommandText.tsx";
import { defaultTheme } from "./theme.ts";
import { markdownLines } from "./markdownLines.ts";

const drivers = new Set<TuiTestDriver>();
afterEach(async () => {
  await Promise.all([...drivers].map((driver) => driver.close()));
  drivers.clear();
});

const runtime = globalThis as typeof globalThis & {
  process?: { getBuiltinModule?: (id: string) => unknown };
};
const describeWithNativeFfi = runtime.process?.getBuiltinModule?.("node:ffi")
  ? describe
  : describe.skip;

describeWithNativeFfi("ShellCommandText", () => {
  it("renders every wrapped styled line without clipping or overlapping the next row", async () => {
    const lines = markdownLines("hello **beautiful world**\n\nnext line", 12);
    const driver = await createTuiTestDriver(
      <UiProvider capabilities={richTerminalCapabilities}>
        {lines.map((line, index) => (
          <ConversationText key={line.text} line={{ ...line, id: "wrapped", line: index }} />
        ))}
      </UiProvider>,
      { width: 12, height: 5 },
    );
    drivers.add(driver);
    expect(
      driver
        .captureRawFrame()
        .split("\n")
        .slice(0, 5)
        .map((line) => line.trimEnd()),
    ).toEqual(["hello", "beautiful", "world", "", "next line"]);
  });

  it("renders shell token colors without changing the command text", async () => {
    const driver = await createTuiTestDriver(
      <UiProvider capabilities={richTerminalCapabilities}>
        <ConversationText
          line={{
            id: "command",
            line: 0,
            text: "[completed] git diff --check && printf 'ok'",
            tone: "accent",
            strong: true,
            shell: true,
          }}
        />
      </UiProvider>,
      { width: 80, height: 2 },
    );
    drivers.add(driver);

    expect(driver.captureFrame()).toContain("[completed] git diff --check && printf 'ok'");
    const spans = driver.captureSpans().lines[0]!.spans;
    expect(spans.find((span) => span.text === "git")?.fg.toInts()).toEqual(
      parseColor(defaultTheme.syntaxCommand).toInts(),
    );
    expect(spans.find((span) => span.text === "--check")?.fg.toInts()).toEqual(
      parseColor(defaultTheme.syntaxFlag).toInts(),
    );
    expect(spans.find((span) => span.text === "&&")?.fg.toInts()).toEqual(
      parseColor(defaultTheme.syntaxOperator).toInts(),
    );
  });

  it("renders user text in a full-width highlighted row instead of right-aligning it", async () => {
    const driver = await createTuiTestDriver(
      <UiProvider capabilities={richTerminalCapabilities}>
        <ConversationText
          line={{
            id: "user",
            line: 0,
            text: "from user",
            tone: "text",
            strong: false,
            highlight: true,
          }}
        />
        <ConversationText
          line={{ id: "agent", line: 0, text: "from agent", tone: "text", strong: false }}
        />
      </UiProvider>,
      { width: 20, height: 2 },
    );
    drivers.add(driver);

    const [user, agent] = driver.captureRawFrame().split("\n");
    expect(user).toBe(" from user          ");
    expect(agent).toBe("from agent          ");
    const userSpans = driver.captureSpans().lines[0]!.spans;
    expect(
      userSpans.some(
        (span) => span.bg.toInts().join() === parseColor(defaultTheme.selection).toInts().join(),
      ),
    ).toBe(true);
  });
});
