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
  it.each(["toggle", "set"])(
    "resets both sidebar lists to the top when switching with %s",
    (method) => {
      const project = dispatchShellCommand(
        initial(),
        { type: "move", offset: 1, wrap: false },
        rows,
      );
      const recent = dispatchShellCommand(
        project,
        method === "toggle"
          ? { type: "toggle-sidebar-view" }
          : { type: "set-sidebar-view", view: "recent" },
        rows,
      );
      expect(recent).toMatchObject({
        sidebarView: "recent",
        route: "threads",
        projectId: p1,
        threadId: t1,
      });
      const last = dispatchShellCommand(recent, { type: "move", offset: 2, wrap: false }, rows);
      const next = dispatchShellCommand(
        last,
        method === "toggle"
          ? { type: "toggle-sidebar-view" }
          : { type: "set-sidebar-view", view: "projects" },
        rows,
      );
      const projects =
        method === "toggle"
          ? dispatchShellCommand(next, { type: "toggle-sidebar-view" }, rows)
          : next;
      expect(projects).toMatchObject({
        sidebarView: "projects",
        route: "projects",
        projectId: p1,
        threadId: t1,
      });
    },
  );

  it("navigates recent threads across projects and switches to archives when cycling", () => {
    const recent = dispatchShellCommand(initial(), { type: "toggle-sidebar-view" }, rows);
    expect(recent.route).toBe("threads");
    const selected = dispatchShellCommand(recent, { type: "move", offset: 2, wrap: false }, rows);
    expect(selected).toMatchObject({ threadId: t3, projectId: p2 });
    const open = dispatchShellCommand(selected, { type: "activate" }, rows);
    expect(dispatchShellCommand(open, { type: "toggle-sidebar-view" }, rows)).toMatchObject({
      route: "threads",
      threadId: null,
      sidebarView: "archived",
    });
    const removed = dispatchShellCommand(
      open,
      { type: "reconcile" },
      { ...rows, threads: rows.threads.slice(0, 2) },
    );
    expect(removed).toMatchObject({
      route: "threads",
      threadId: t1,
      projectId: p1,
      sidebarView: "recent",
    });
  });
  it("isolates archived threads and resets selection when cycling all three views", () => {
    const all = {
      ...rows,
      threads: [
        ...rows.threads,
        { id: ThreadId.make("old"), projectId: p2, archivedAt: "2026-01-01" },
      ],
    };
    const archive = dispatchShellCommand(
      initial(),
      { type: "set-sidebar-view", view: "archived" },
      all,
    );
    expect(archive).toMatchObject({ route: "threads", threadId: "old", projectId: p2 });
    expect(
      dispatchShellCommand(archive, { type: "move", offset: 1, wrap: true }, all).threadId,
    ).toBe("old");
    const projects = dispatchShellCommand(archive, { type: "toggle-sidebar-view" }, all);
    expect(projects).toMatchObject({ sidebarView: "projects", projectId: p1, threadId: t1 });
    const restored = dispatchShellCommand(archive, { type: "reconcile" }, rows);
    expect(restored.threadId).toBeNull();
  });
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

  it("opens project creation without requiring an existing project", () => {
    const empty = { projects: [], threads: [] };
    const modal = dispatchShellCommand(createInitialShellState(), { type: "new-project" }, empty);
    expect(modal.modal).toBe("new-project");
    expect(shellCommandFromKey({ name: "p" })).toEqual({ type: "new-project" });
    expect(
      dispatchShellCommand(modal, { type: "open-project", projectId: p2 }, rows),
    ).toMatchObject({ route: "threads", projectId: p2, threadId: t3, modal: null });
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
