import { describe, expect, it, vi } from "vite-plus/test";

import {
  clampTerminalSize,
  copyTerminalSelection,
  createTerminalDataQueue,
  createTerminalResizeHandler,
  decodeTerminalData,
  isTerminalFocusReleaseKey,
  MAX_TERMINAL_WRITE_UNITS,
  splitTerminalWrite,
} from "./terminalIo.ts";

const encoder = new TextEncoder();

describe("terminal IO", () => {
  it("decodes UTF-8 and splits writes without cutting surrogate pairs", () => {
    expect(decodeTerminalData(encoder.encode("shell 📚"))).toBe("shell 📚");

    const input = `${"a".repeat(MAX_TERMINAL_WRITE_UNITS - 1)}📚end`;
    const chunks = splitTerminalWrite(input);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(MAX_TERMINAL_WRITE_UNITS - 1);
    expect(chunks[1]).toBe("📚end");
    expect(chunks.join("")).toBe(input);
  });

  it("serializes input and response writes through one failure-tolerant FIFO", async () => {
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const calls: string[] = [];
    const errors: unknown[] = [];
    const queue = createTerminalDataQueue(async (data, source) => {
      calls.push(`${source}:${data}`);
      if (data === "first") await firstPending;
      if (data === "bad") throw new Error("write failed");
    }, errors.push.bind(errors));

    queue.enqueue(encoder.encode("first"), "input");
    queue.enqueue(encoder.encode("bad"), "response");
    queue.enqueue(encoder.encode("last"), "input");
    await Promise.resolve();

    expect(calls).toEqual(["input:first"]);
    releaseFirst();
    await queue.drain();

    expect(calls).toEqual(["input:first", "response:bad", "input:last"]);
    expect(errors).toHaveLength(1);
  });

  it("clamps and deduplicates terminal resizes", () => {
    const resize = vi.fn();
    const handleResize = createTerminalResizeHandler(resize);

    handleResize(0, Number.NaN);
    handleResize(1, 1);
    handleResize(1_500.9, 700.2);
    handleResize(1_000, 500);

    expect(clampTerminalSize(80.9, 24.9)).toEqual({ cols: 80, rows: 24 });
    expect(resize.mock.calls).toEqual([[{ cols: 1, rows: 1 }], [{ cols: 1_000, rows: 500 }]]);
  });

  it("recognizes the focus-release key", () => {
    expect(isTerminalFocusReleaseKey({ ctrl: true, name: "\\", sequence: "\x1c" })).toBe(true);
    expect(isTerminalFocusReleaseKey({ ctrl: false, name: "\\", sequence: "\\" })).toBe(false);
    expect(isTerminalFocusReleaseKey({ ctrl: true, name: "c", sequence: "\x03" })).toBe(false);
  });

  it("copies only when the terminal has a selection", () => {
    const copy = vi.fn();

    expect(
      copyTerminalSelection({ hasSelection: () => false, getSelectedText: () => "ignored" }, copy),
    ).toBe(false);
    expect(
      copyTerminalSelection({ hasSelection: () => true, getSelectedText: () => "chosen" }, copy),
    ).toBe(true);
    expect(copy).toHaveBeenCalledOnce();
    expect(copy).toHaveBeenCalledWith("chosen");
  });
});
