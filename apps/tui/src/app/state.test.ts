import { describe, expect, it } from "@effect/vitest";

import { createInitialShellState, dispatchShellCommand, shellCommandFromKey } from "./state.ts";

describe("shell coordination", () => {
  it("enters routes at their first focus target and cycles in both directions", () => {
    const thread = dispatchShellCommand(createInitialShellState(), {
      type: "navigate",
      route: "thread",
    });

    expect(thread).toEqual({ route: "thread", focus: "thread-list", modal: null });
    expect(dispatchShellCommand(thread, { type: "cycle-focus", direction: "forward" }).focus).toBe(
      "conversation",
    );
    expect(dispatchShellCommand(thread, { type: "cycle-focus", direction: "backward" }).focus).toBe(
      "composer",
    );
  });

  it("gives the modal first chance to handle back and ignores covered navigation", () => {
    const thread = createInitialShellState("thread");
    const withHelp = dispatchShellCommand(thread, { type: "toggle-help" });

    expect(dispatchShellCommand(withHelp, { type: "navigate", route: "connection" })).toBe(
      withHelp,
    );
    expect(dispatchShellCommand(withHelp, { type: "escape" })).toEqual(thread);
    expect(dispatchShellCommand(thread, { type: "back" })).toEqual(
      createInitialShellState("projects"),
    );
  });

  it("maps only unmodified shell keys to commands", () => {
    expect(shellCommandFromKey({ name: "tab" })).toEqual({
      type: "cycle-focus",
      direction: "forward",
    });
    expect(shellCommandFromKey({ name: "tab", shift: true })).toEqual({
      type: "cycle-focus",
      direction: "backward",
    });
    expect(shellCommandFromKey({ name: "2" })).toEqual({ type: "navigate", route: "projects" });
    expect(shellCommandFromKey({ name: "escape" })).toEqual({ type: "escape" });
    expect(shellCommandFromKey({ name: "backspace" })).toEqual({ type: "back" });
    expect(shellCommandFromKey({ name: "2", ctrl: true })).toBeUndefined();
  });
});
