import { EmbeddedTerminalRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import type { TerminalOutputState } from "@t3tools/client-runtime/state/terminal";
import {
  act,
  StrictMode,
  useLayoutEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  EmbeddedTerminalSurface,
  type EmbeddedTerminalSurfaceHandle,
  type EmbeddedTerminalSurfaceProps,
} from "./EmbeddedTerminalSurface.tsx";

const encoder = new TextEncoder();

function outputState(
  data: string,
  { generation = 1, resetVersion = 1 }: { generation?: number; resetVersion?: number } = {},
): TerminalOutputState {
  const byteLength = encoder.encode(data).byteLength;
  return {
    generation,
    resetVersion,
    chunks:
      data.length === 0
        ? []
        : [
            {
              startOffset: 0,
              data,
              byteLength,
            },
          ],
    retainedBytes: byteLength,
    nextOffset: data.length,
  };
}

function appendedOutput(previous: TerminalOutputState, data: string): TerminalOutputState {
  const byteLength = encoder.encode(data).byteLength;
  return {
    ...previous,
    chunks: [
      ...previous.chunks,
      {
        startOffset: previous.nextOffset,
        data,
        byteLength,
      },
    ],
    retainedBytes: previous.retainedBytes + byteLength,
    nextOffset: previous.nextOffset + data.length,
  };
}

async function renderSurface(
  initialOutput: TerminalOutputState,
  overrides: Partial<EmbeddedTerminalSurfaceProps> = {},
  strict = false,
) {
  let setOutput!: Dispatch<SetStateAction<TerminalOutputState>>;
  let handle: EmbeddedTerminalSurfaceHandle | null = null;
  const onWrite = vi.fn();
  const onResize = vi.fn();
  const onReleaseFocus = vi.fn();
  const onCopy = vi.fn();

  function Harness() {
    const [output, updateOutput] = useState(initialOutput);
    useLayoutEffect(() => {
      setOutput = updateOutput;
    }, []);
    return (
      <EmbeddedTerminalSurface
        ref={(value) => {
          handle = value;
        }}
        output={output}
        focused={false}
        onWrite={onWrite}
        onResize={onResize}
        onReleaseFocus={onReleaseFocus}
        onCopy={onCopy}
        {...overrides}
      />
    );
  }

  const setup = await testRender(
    strict ? (
      <StrictMode>
        <Harness />
      </StrictMode>
    ) : (
      <Harness />
    ),
    {
      width: 30,
      height: 6,
      exitOnCtrlC: false,
    },
  );
  await setup.flush();

  return {
    ...setup,
    get handle() {
      return handle!;
    },
    setOutput(output: TerminalOutputState) {
      act(() => setOutput(output));
    },
    onWrite,
    onResize,
    onReleaseFocus,
    onCopy,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// OpenTUI's Node backend currently needs Node's experimental FFI flag.
const runtime = globalThis as typeof globalThis & {
  process?: { getBuiltinModule?: (id: string) => unknown };
};
const describeWithNativeFfi = runtime.process?.getBuiltinModule?.("node:ffi")
  ? describe
  : describe.skip;

describeWithNativeFfi("EmbeddedTerminalSurface", () => {
  it.each([
    ["F1", "\x1bOP", "\x1bOP"],
    ["F5", "\x1b[15~", "\x1b[15~"],
    ["F12", "\x1b[24~", "\x1b[24~"],
    ["Ctrl+F1", "\x1b[1;5P", "\x1b[1;5P"],
    ["SS3 left", "\x1bOD", "\x1b[D"],
  ] as const)("forwards %s through the native encoder", async (_label, sequence, expected) => {
    const rendered = await renderSurface(outputState(""), { focused: true });
    try {
      rendered.mockInput.pressKey(sequence);
      await rendered.handle.drainInput();
      expect(rendered.onWrite.mock.calls).toEqual([[expected, "input"]]);
    } finally {
      await act(async () => rendered.renderer.destroy());
    }
  });

  it("registers the native terminal, replays once, and appends once", async () => {
    const write = vi.spyOn(EmbeddedTerminalRenderable.prototype, "write");
    const initial = outputState("hello");
    const rendered = await renderSurface(initial);

    const terminal = rendered.renderer.root.findDescendantById("t3-embedded-terminal");
    expect(terminal).toBeInstanceOf(EmbeddedTerminalRenderable);
    expect(write.mock.calls.map(([data]) => data)).toEqual(["hello"]);

    rendered.setOutput(appendedOutput(initial, " world"));
    await rendered.flush();
    expect(write.mock.calls.map(([data]) => data)).toEqual(["hello", " world"]);

    rendered.setOutput(appendedOutput(initial, " world"));
    await rendered.flush();
    expect(write.mock.calls.map(([data]) => data)).toEqual(["hello", " world"]);
    await act(async () => rendered.renderer.destroy());
  });

  it("appends Unicode output once using the runtime's string offsets", async () => {
    const initial = outputState("漢字");
    const rendered = await renderSurface(initial);
    try {
      const next = appendedOutput(initial, " café");
      rendered.setOutput(next);
      await rendered.flush();
      rendered.setOutput({ ...next });
      await rendered.flush();
      const terminal = rendered.renderer.root.findDescendantById(
        "t3-embedded-terminal",
      ) as EmbeddedTerminalRenderable;
      expect(terminal.screen().text).toBe("漢字 café");
    } finally {
      await act(async () => rendered.renderer.destroy());
    }
  });

  it("keeps input working after StrictMode replays mount effects", async () => {
    const rendered = await renderSurface(outputState(""), { focused: true }, true);
    try {
      rendered.handle.paste("after replay");
      await rendered.handle.drainInput();
      expect(rendered.onWrite.mock.calls).toEqual([["after replay", "input"]]);
    } finally {
      await act(async () => rendered.renderer.destroy());
    }
  });

  it("replaces the native terminal for every reset and restores owned focus", async () => {
    const rendered = await renderSurface(outputState("before"), { focused: true });
    const before = rendered.renderer.root.findDescendantById(
      "t3-embedded-terminal",
    ) as EmbeddedTerminalRenderable;
    expect(before.focused).toBe(true);

    rendered.setOutput(outputState("after", { resetVersion: 2 }));
    await rendered.flush();
    const after = rendered.renderer.root.findDescendantById(
      "t3-embedded-terminal",
    ) as EmbeddedTerminalRenderable;

    expect(after).not.toBe(before);
    expect(before.isDestroyed).toBe(true);
    expect(after.screen().text).toContain("after");
    expect(after.focused).toBe(true);

    rendered.setOutput(outputState("", { resetVersion: 3 }));
    await rendered.flush();
    const cleared = rendered.renderer.root.findDescendantById(
      "t3-embedded-terminal",
    ) as EmbeddedTerminalRenderable;
    expect(cleared).not.toBe(after);
    expect(after.isDestroyed).toBe(true);
    expect(cleared.screen().text).toBe("");
    await act(async () => rendered.renderer.destroy());
    expect(cleared.isDestroyed).toBe(true);
  });

  it("does not send queued input after the terminal is unmounted", async () => {
    const pending = Promise.withResolvers<void>();
    const writes: string[] = [];
    const rendered = await renderSurface(outputState(""), {
      onWrite: async (data) => {
        writes.push(data);
        if (data === "first") await pending.promise;
      },
    });
    rendered.handle.paste("first");
    rendered.handle.paste("second");
    const drained = rendered.handle.drainInput();
    await Promise.resolve();
    expect(writes).toEqual(["first"]);
    await act(async () => rendered.renderer.destroy());
    pending.resolve();
    await drained;
    expect(writes).toEqual(["first"]);
  });

  it("uses the native bracketed-paste encoder", async () => {
    const rendered = await renderSurface(outputState("\x1b[?2004h"));

    rendered.handle.paste("pasted");
    await rendered.handle.drainInput();

    expect(rendered.onWrite).toHaveBeenCalledWith("\x1b[200~pasted\x1b[201~", "input");
    await act(async () => rendered.renderer.destroy());
  });

  it("releases focus on Ctrl+\\ without forwarding SIGQUIT", async () => {
    const rendered = await renderSurface(outputState(""), { focused: true });
    const terminal = rendered.renderer.root.findDescendantById(
      "t3-embedded-terminal",
    ) as EmbeddedTerminalRenderable;
    expect(terminal.focused).toBe(true);

    rendered.mockInput.pressKey("\\", { ctrl: true });
    await rendered.handle.drainInput();

    expect(rendered.onReleaseFocus).toHaveBeenCalledOnce();
    expect(terminal.focused).toBe(false);
    expect(rendered.onWrite.mock.calls.flatMap(([data]) => [...data])).not.toContain("\x1c");
    await act(async () => rendered.renderer.destroy());
  });
});
