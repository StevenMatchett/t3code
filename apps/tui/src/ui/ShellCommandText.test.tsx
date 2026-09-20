import { afterEach, describe, expect, it } from "@effect/vitest";
import { parseColor } from "@opentui/core";
import { createTuiTestDriver, type TuiTestDriver } from "../testing/driver.tsx";
import { richTerminalCapabilities } from "./capabilities.ts";
import { UiProvider } from "./context.tsx";
import { ConversationText } from "./ShellCommandText.tsx";
import { defaultTheme } from "./theme.ts";

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

  it("places user text at the right edge and agent text at the left edge", async () => {
    const driver = await createTuiTestDriver(
      <UiProvider capabilities={richTerminalCapabilities}>
        <ConversationText
          line={{
            id: "user",
            line: 0,
            text: "from user",
            tone: "text",
            strong: false,
            align: "right",
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
    expect(user).toBe("           from user");
    expect(agent).toBe("from agent          ");
  });
});
