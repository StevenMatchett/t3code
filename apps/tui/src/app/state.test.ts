import { describe, expect, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import {
  createInitialShellState,
  dispatchShellCommand,
  shellCommandFromKey,
  type ShellRows,
} from "./state.ts";

const p1 = ProjectId.make("one");
const p2 = ProjectId.make("two");
const t1 = ThreadId.make("first");
const t2 = ThreadId.make("second");
const t3 = ThreadId.make("third");
const rows: ShellRows = {
  projects: [{ id: p1 }, { id: p2 }],
  threads: [
    { id: t1, projectId: p1 },
    { id: t2, projectId: p1 },
    { id: t3, projectId: p2 },
  ],
};

function initial() {
  return dispatchShellCommand(createInitialShellState(), { type: "reconcile" }, rows);
}

describe("shell coordination", () => {
  it("selects real project and thread IDs with arrows and Enter and preserves them on back", () => {
    const selected = dispatchShellCommand(
      initial(),
      { type: "move", offset: 1, wrap: false },
      rows,
    );
    expect(selected.projectId).toBe(p2);
    const threads = dispatchShellCommand(selected, { type: "activate" }, rows);
    expect(threads.route).toBe("threads");
    expect(threads.threadId).toBe(t3);
    const conversation = dispatchShellCommand(threads, { type: "activate" }, rows);
    expect(conversation.route).toBe("conversation");
    expect(dispatchShellCommand(conversation, { type: "back" }, rows)).toEqual(threads);
    expect(dispatchShellCommand(threads, { type: "back" }, rows)).toEqual(selected);
  });

  it("clamps arrows, cycles Tab, and never activates an empty list", () => {
    const state = initial();
    expect(dispatchShellCommand(state, { type: "move", offset: -1, wrap: false }, rows)).toEqual(
      state,
    );
    expect(
      dispatchShellCommand(state, { type: "move", offset: -1, wrap: true }, rows).projectId,
    ).toBe(p2);
    expect(
      dispatchShellCommand(
        createInitialShellState(),
        { type: "activate" },
        { projects: [], threads: [] },
      ).route,
    ).toBe("projects");
  });

  it("keeps identity across inserted rows and returns to the list when a selected thread disappears", () => {
    const threads = dispatchShellCommand(initial(), { type: "activate" }, rows);
    const conversation = dispatchShellCommand(threads, { type: "activate" }, rows);
    const reordered = {
      ...rows,
      projects: rows.projects.toReversed(),
      threads: rows.threads.toReversed(),
    };
    expect(dispatchShellCommand(conversation, { type: "reconcile" }, reordered)).toBe(conversation);
    const removed = dispatchShellCommand(
      conversation,
      { type: "reconcile" },
      { ...rows, threads: rows.threads.filter((thread) => thread.id !== t1) },
    );
    expect(removed.route).toBe("threads");
    expect(removed.threadId).toBe(t2);
  });

  it("gives help ownership of activation and navigation until dismissed", () => {
    const state = initial();
    const help = dispatchShellCommand(state, { type: "toggle-help" }, rows);
    expect(dispatchShellCommand(help, { type: "move", offset: 1, wrap: false }, rows)).toBe(help);
    expect(dispatchShellCommand(help, { type: "activate" }, rows)).toEqual(state);
  });

  it("maps arrows, Enter, and Tab without stealing modified keys", () => {
    expect(shellCommandFromKey({ name: "down" })).toEqual({ type: "move", offset: 1, wrap: false });
    expect(shellCommandFromKey({ name: "up" })).toEqual({ type: "move", offset: -1, wrap: false });
    expect(shellCommandFromKey({ name: "tab", shift: true })).toEqual({
      type: "move",
      offset: -1,
      wrap: true,
    });
    for (const name of ["return", "enter", "right"])
      expect(shellCommandFromKey({ name })).toEqual({ type: "activate" });
    for (const name of ["left", "escape"])
      expect(shellCommandFromKey({ name })).toEqual({ type: "back" });
    expect(shellCommandFromKey({ name: "down", ctrl: true })).toBeUndefined();
    expect(shellCommandFromKey({ name: "2" })).toBeUndefined();
  });
});
