// @effect-diagnostics nodeBuiltinImport:off - The routing boundary test reads the TUI source tree.
import { describe, expect, it } from "@effect/vitest";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import {
  ACTION_SCOPES,
  actionKeyLabel,
  allActions,
  type ActionDefinition,
  type ActionId,
} from "../app/actions.ts";
import { chordMatches, createKeymapStore } from "./keymap.ts";
import { hintsFromActions, layoutHints } from "./HotkeyBar.tsx";
import type { KeyEvent } from "@opentui/core";

const key = (name: string, modifiers: Partial<KeyEvent> = {}) =>
  ({
    name,
    ctrl: false,
    meta: false,
    option: false,
    shift: false,
    eventType: "press",
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
    ...modifiers,
  }) as unknown as KeyEvent;

/** Scopes that can have focus together, top first. */
const CHAINS = [
  ["history", "conversation", "workspace", "app"],
  ["composer", "conversation", "workspace", "app"],
  ["menu", "composer", "conversation", "workspace", "app"],
  ["find", "history", "conversation", "workspace", "app"],
  ["agents", "conversation", "workspace", "app"],
  ["approval", "conversation", "workspace", "app"],
  ["question", "conversation", "workspace", "app"],
  ["shell", "conversation", "workspace", "app"],
  ["navigation", "workspace", "app"],
  ["listFilter", "navigation", "workspace", "app"],
  ...(
    [
      "palette",
      "help",
      "diff",
      "restore",
      "pullRequest",
      "favorites",
      "theme",
      "manage",
      "rename",
      "contextMenu",
      "newThread",
      "newProject",
      "agentOutput",
      "linkMenu",
    ] as const
  ).map((scope) => [scope, "app"]),
  ["quit", "app"],
] as const;

describe("action table", () => {
  const actions = allActions();

  it.each(actions)("%s is reachable by key or from the palette", (_id, definition) => {
    const reachableByKey = definition.keys.length > 0;
    const reachableByPalette = definition.palette !== false;
    expect(reachableByKey || reachableByPalette).toBe(true);
    if (definition.hint !== undefined) expect(reachableByKey).toBe(true);
    if (reachableByKey) expect(actionKeyLabel(definition)).not.toBe("");
  });

  it("gives every action a title and a known scope", () => {
    for (const [, definition] of actions) {
      expect(definition.title.length).toBeGreaterThan(0);
      expect(ACTION_SCOPES[definition.scope]).toBeDefined();
    }
  });

  it.each(CHAINS.map((chain) => [chain.join(" > "), chain] as const))(
    "has no accidental key collisions in %s",
    (_name, chain) => {
      const owners = new Map<string, Array<[ActionId, ActionDefinition]>>();
      for (const scope of chain)
        for (const entry of actions)
          if (entry[1].scope === scope)
            for (const chord of entry[1].keys)
              owners.set(chord, [...(owners.get(chord) ?? []), entry]);
      const collisions: string[] = [];
      for (const [chord, entries] of owners) {
        if (entries.length < 2) continue;
        const [winner, ...shadowed] = entries;
        for (const [id, definition] of shadowed) {
          const declared =
            definition.yieldsTo?.includes(winner![0]) ||
            // Conversation regions have focus one at a time, and each owns its own Enter and arrows.
            ACTION_SCOPES[winner![1].scope].level > ACTION_SCOPES[definition.scope].level;
          if (!declared) collisions.push(`${chord}: ${winner![0]} and ${id}`);
        }
      }
      expect(collisions).toEqual([]);
    },
  );

  it("always hints the palette and help, and ranks focused keys first", () => {
    const store = createKeymapStore();
    store.register(
      "app",
      {},
      {
        bindings: { "commandPalette.toggle": () => undefined, "help.toggle": () => undefined },
      },
    );
    store.register(
      "history",
      {},
      {
        bindings: { "composer.focus": () => undefined, "history.vimMove": () => false },
      },
    );
    const hints = hintsFromActions(store.activeActions());
    expect(hints.map((hint) => hint.id)).toEqual([
      "commandPalette.toggle",
      "help.toggle",
      "composer.focus",
      "history.vimMove",
    ]);
    const narrow = layoutHints("Conversation", hints, 34);
    expect(narrow.pinned.map((hint) => hint.key)).toEqual(["Ctrl+K", "?"]);
    expect(narrow.rows[0].map((hint) => hint.label)).toContain("Write");
  });
});

describe("key routing", () => {
  it("runs the top layer, lets it decline, and stops at a modal except for the app scope", () => {
    const store = createKeymapStore();
    const calls: string[] = [];
    store.register(
      "app",
      {},
      {
        bindings: { "commandPalette.toggle": () => void calls.push("palette") },
      },
    );
    store.register("workspace", {}, { bindings: { "chat.new": () => void calls.push("new") } });
    const history = store.register(
      "history",
      {},
      {
        bindings: { "thread.find": () => void calls.push("find") },
      },
    );
    store.dispatch(key("/"));
    store.dispatch(key("n"));
    expect(calls).toEqual(["find", "new"]);
    history.update({ bindings: { "thread.find": () => false } });
    store.dispatch(key("/"));
    expect(calls).toEqual(["find", "new"]);

    const overlay = store.register(
      "diff",
      {},
      {
        modal: true,
        bindings: { "diff.close": () => void calls.push("close") },
      },
    );
    store.dispatch(key("n"));
    store.dispatch(key("escape"));
    store.dispatch(key("k", { ctrl: true }));
    expect(calls).toEqual(["find", "new", "close", "palette"]);
    overlay.remove();
    store.dispatch(key("n"));
    expect(calls.at(-1)).toBe("new");
  });

  it("never fires single-letter actions while text entry has focus", () => {
    const store = createKeymapStore();
    const calls: string[] = [];
    store.register("workspace", {}, { bindings: { "chat.new": () => void calls.push("new") } });
    store.register(
      "app",
      {},
      {
        bindings: {
          "help.toggle": () => void calls.push("help"),
          "sounds.toggle": () => void calls.push("sounds"),
        },
      },
    );
    const composer = store.register(
      "composer",
      {},
      {
        typing: true,
        bindings: { "composer.blur": () => void calls.push("blur") },
      },
    );
    const event = key("n");
    store.dispatch(event);
    store.dispatch(key("?"));
    expect(calls).toEqual([]);
    store.dispatch(key("g", { ctrl: true }));
    store.dispatch(key("f1"));
    store.dispatch(key("escape"));
    expect(calls).toEqual(["sounds", "help", "blur"]);
    composer.remove();
    store.dispatch(key("n"));
    expect(calls.at(-1)).toBe("new");
  });

  it("does not repeat one-shot actions but repeats movement", () => {
    const store = createKeymapStore();
    let opens = 0;
    let moves = 0;
    store.register(
      "navigation",
      {},
      {
        bindings: { "list.open": () => void opens++, "list.down": () => void moves++ },
      },
    );
    store.dispatch(key("return", { repeated: true }));
    store.dispatch(key("down", { repeated: true }));
    expect(opens).toBe(0);
    expect(moves).toBe(1);
  });

  it("matches letters with Shift, but not unshifted chords to Shift arrows", () => {
    expect(chordMatches("d", key("d", { shift: true }))).toBe(true);
    expect(chordMatches("up", key("up", { shift: true }))).toBe(false);
    expect(chordMatches("shift+a", key("a"))).toBe(false);
    expect(chordMatches("shift+a", key("a", { shift: true }))).toBe(true);
    expect(chordMatches("?", key("/", { shift: true }))).toBe(true);
    expect(chordMatches("/", key("/", { shift: true }))).toBe(false);
    expect(chordMatches("return", key("enter"))).toBe(true);
    expect(chordMatches("ctrl+k", key("k"))).toBe(false);
  });
});

describe("key routing boundary", () => {
  it("routes every keypress through the one keymap listener", () => {
    const sourceRoot = NodePath.resolve(import.meta.dirname, "..");
    const walk = (directory: string): string[] =>
      NodeFS.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = NodePath.join(directory, entry.name);
        if (entry.isDirectory()) return walk(path);
        return /\.tsx?$/u.test(entry.name) && !/\.test\./u.test(entry.name) ? [path] : [];
      });
    const violations = walk(sourceRoot)
      .filter((path) => !path.includes(`${NodePath.sep}testing${NodePath.sep}`))
      .filter((path) => /\buseKeyboard\(/u.test(NodeFS.readFileSync(path, "utf8")))
      .map((path) => NodePath.relative(sourceRoot, path));
    expect(violations).toEqual([]);
  });
});
