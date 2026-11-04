import type { CliRenderer, KeyEvent } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import {
  ACTION_SCOPES,
  ACTIONS,
  type ActionDefinition,
  type ActionId,
  type ActionIdIn,
  type ActionScope,
} from "../app/actions.ts";

/** Handlers return false to say the key was not theirs, so it continues to lower layers. */
export type ActionRun = (key?: KeyEvent) => void | boolean | Promise<unknown>;
export type ActionBinding =
  | ActionRun
  | {
      readonly run: ActionRun;
      /** Disabled actions are hidden from the bar, help, and palette, and their keys fall through. */
      readonly enabled?: boolean;
      /** Replaces the table's bar label and palette title while state changes the wording. */
      readonly label?: string;
      readonly title?: string;
    };

export interface KeyLayerOptions<Scope extends ActionScope> {
  /** Whether this layer takes part in routing. Layers below an active modal stay registered. */
  readonly active?: boolean;
  /** Blocks every lower layer except the app scope, keeping Ctrl+K and help reachable. */
  readonly modal?: boolean;
  /** Text entry has focus: printable keys belong to it and never reach lower layers. */
  readonly typing?: boolean;
  /** Also blocks the app scope, for a terminal that must receive every key. */
  readonly capture?: boolean;
  /** Replaces the scope title shown in the hotkey bar. */
  readonly context?: string;
  /** Runs first for keys that need more than a chord lookup, such as a Vim state machine. */
  readonly raw?: (key: KeyEvent) => boolean;
  readonly bindings?: { readonly [Id in ActionIdIn<Scope>]?: ActionBinding };
}

interface Layer {
  readonly token: object;
  readonly scope: ActionScope;
  readonly order: number;
  options: KeyLayerOptions<ActionScope>;
}

export interface ActiveAction {
  readonly id: ActionId;
  readonly definition: ActionDefinition;
  readonly scope: ActionScope;
  readonly title: string;
  readonly label: string | undefined;
  /** Chords this action really receives here, after higher layers took theirs. */
  readonly reachableKeys: readonly string[];
  readonly run: ActionRun;
}

export function chordMatches(chord: string, key: KeyEvent) {
  const parts = chord === "+" ? ["+"] : chord.split("+");
  const name = parts.at(-1)!;
  const modifiers = new Set(parts.slice(0, -1));
  if (modifiers.has("ctrl") !== Boolean(key.ctrl)) return false;
  if (modifiers.has("alt") !== Boolean(key.option || key.meta)) return false;
  const keyName = key.name.toLowerCase();
  if (name === "?") return keyName === "?" || (keyName === "/" && key.shift);
  if (name === "$") return keyName === "$" || (keyName === "4" && key.shift);
  if (name === "/") return keyName === "/" && !key.shift;
  const sameName =
    keyName === name ||
    (name === "return" && keyName === "enter") ||
    (name === "enter" && keyName === "return");
  if (!sameName) return false;
  if (modifiers.has("shift")) return Boolean(key.shift);
  // Letters tolerate Shift so a capitalized hint and Caps Lock both work; exact shift chords win.
  return !key.shift || (name.length === 1 && /[a-z]/u.test(name));
}

function exactShift(chord: string, key: KeyEvent) {
  return chord.includes("shift+") === Boolean(key.shift) ? 1 : 0;
}

function isPrintable(key: KeyEvent) {
  return !key.ctrl && !key.meta && !key.option && (key.name.length === 1 || key.name === "space");
}

function bindingRun(binding: ActionBinding) {
  return typeof binding === "function" ? binding : binding.run;
}

function bindingEnabled(binding: ActionBinding) {
  return typeof binding === "function" ? true : binding.enabled !== false;
}

export function createKeymapStore() {
  const layers = new Set<Layer>();
  const listeners = new Set<() => void>();
  let order = 0;
  let version = 0;
  let signature = "";

  const sorted = () =>
    [...layers]
      .filter((layer) => layer.options.active !== false)
      .toSorted(
        (a, b) => ACTION_SCOPES[b.scope].level - ACTION_SCOPES[a.scope].level || b.order - a.order,
      );

  /** Top-first layers that can receive keys right now, below `belowScope` when given. */
  const chain = (belowScope?: ActionScope) => {
    const all = sorted();
    const start = belowScope ? all.findIndex((layer) => layer.scope === belowScope) + 1 : 0;
    const result: Layer[] = [];
    let blocked = false;
    for (const layer of all.slice(start)) {
      if (blocked) {
        if (layer.scope === "app") result.push(layer);
        continue;
      }
      result.push(layer);
      if (layer.options.capture) return result;
      if (layer.options.modal) blocked = true;
    }
    return result;
  };

  const activeActions = (belowScope?: ActionScope): readonly ActiveAction[] => {
    const taken = new Set<string>();
    const actions: ActiveAction[] = [];
    let typing = false;
    for (const layer of chain(belowScope)) {
      const entries = Object.entries(layer.options.bindings ?? {}) as ReadonlyArray<
        [ActionId, ActionBinding]
      >;
      const claimed: string[] = [];
      for (const [id, binding] of entries) {
        if (!bindingEnabled(binding)) continue;
        const definition: ActionDefinition = ACTIONS[id];
        const reachableKeys = definition.keys.filter((chord) => {
          if (taken.has(chord)) return false;
          // Printable keys below a text field go to the field.
          return !(typing && !chord.includes("ctrl+") && !/^f\d+$/u.test(chord));
        });
        claimed.push(...reachableKeys);
        actions.push({
          id,
          definition,
          scope: layer.scope,
          title:
            typeof binding === "object" ? (binding.title ?? definition.title) : definition.title,
          label: (typeof binding === "object" ? binding.label : undefined) ?? definition.label,
          reachableKeys,
          run: bindingRun(binding),
        });
      }
      for (const chord of claimed) taken.add(chord);
      if (layer.options.typing) typing = true;
    }
    return actions;
  };

  const notifyIfChanged = () => {
    const active = sorted();
    const top = chain()[0];
    const next = [
      top?.options.context ?? (top ? ACTION_SCOPES[top.scope].title : ""),
      ...activeActions().map(
        (action) => `${action.id}:${action.label ?? ""}:${action.reachableKeys.join(",")}`,
      ),
      active.length,
    ].join("|");
    if (next === signature) return;
    signature = next;
    version += 1;
    for (const listener of listeners) listener();
  };

  const dispatch = (key: KeyEvent) => {
    if (key.eventType === "release") return;
    let typing = false;
    for (const layer of chain()) {
      const printableBlocked = typing && isPrintable(key);
      if (!printableBlocked && layer.options.raw?.(key)) {
        key.preventDefault();
        key.stopPropagation();
        return;
      }
      const entries = Object.entries(layer.options.bindings ?? {}) as ReadonlyArray<
        [ActionId, ActionBinding]
      >;
      const matches = entries
        .flatMap(([id, binding]) => {
          if (!bindingEnabled(binding)) return [];
          const chord = ACTIONS[id].keys.find((candidate) => chordMatches(candidate, key));
          return chord === undefined ? [] : [{ id, binding, chord }];
        })
        .toSorted((a, b) => exactShift(b.chord, key) - exactShift(a.chord, key));
      for (const { id, binding, chord } of matches) {
        // Below a text field only chords and function keys still apply.
        if (typing && !chord.includes("ctrl+") && !/^f\d+$/u.test(chord)) continue;
        const definition: ActionDefinition = ACTIONS[id];
        if (key.repeated && !definition.repeat) {
          key.preventDefault();
          key.stopPropagation();
          return;
        }
        if (bindingRun(binding)(key) === false) continue;
        key.preventDefault();
        key.stopPropagation();
        return;
      }
      if (layer.options.typing) typing = true;
    }
  };

  return {
    version: () => version,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch,
    register: (scope: ActionScope, token: object, options: KeyLayerOptions<ActionScope>) => {
      const layer: Layer = { token, scope, order: order++, options };
      layers.add(layer);
      return {
        update: (next: KeyLayerOptions<ActionScope>) => {
          layer.options = next;
          notifyIfChanged();
        },
        remove: () => {
          layers.delete(layer);
          notifyIfChanged();
        },
      };
    },
    activeActions,
    /** The title of whichever layer has focus, for the hotkey bar. */
    context: () => {
      const top = chain()[0];
      return top?.options.context ?? (top ? ACTION_SCOPES[top.scope].title : "");
    },
    topScope: () => chain()[0]?.scope ?? null,
    /** Runs an action as if its key had been pressed. Returns false when it is unavailable. */
    run: (id: ActionId, belowScope?: ActionScope) => {
      const action = activeActions(belowScope).find((candidate) => candidate.id === id);
      if (!action) return false;
      action.run();
      return true;
    },
  };
}

export type KeymapStore = ReturnType<typeof createKeymapStore>;

const stores = new WeakMap<CliRenderer, KeymapStore>();

/** The renderer's one keymap. It owns the only key listener, so routing has one order. */
export function keymapFor(renderer: CliRenderer) {
  const existing = stores.get(renderer);
  if (existing) return existing;
  const store = createKeymapStore();
  stores.set(renderer, store);
  renderer.keyInput.on("keypress", store.dispatch);
  return store;
}

export function useKeymap() {
  return keymapFor(useRenderer());
}

/** Registers a screen's bindings for one scope of the action table. */
export function useKeyLayer<Scope extends ActionScope>(
  scope: Scope,
  options: KeyLayerOptions<Scope>,
) {
  const store = useKeymap();
  const token = useRef({}).current;
  const handle = useRef<ReturnType<KeymapStore["register"]> | null>(null);
  useLayoutEffect(() => {
    const registered = store.register(scope, token, {});
    handle.current = registered;
    return () => {
      handle.current = null;
      registered.remove();
    };
  }, [store, scope, token]);
  // Handlers close over this render's state, so every commit publishes the new ones.
  useLayoutEffect(() => {
    handle.current?.update(options as KeyLayerOptions<ActionScope>);
  });
}

/** Re-renders when the active actions change, so hints never go stale. */
export function useActiveActions(belowScope?: ActionScope) {
  const store = useKeymap();
  useSyncExternalStore(store.subscribe, store.version, store.version);
  return {
    actions: store.activeActions(belowScope),
    context: store.context(),
    store,
  };
}
