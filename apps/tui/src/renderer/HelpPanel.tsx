import { useMemo, useState } from "react";
import {
  ACTION_SCOPES,
  helpKeyLabel,
  allActions,
  type ActionDefinition,
  type ActionScope,
} from "../app/actions.ts";
import { useUi } from "../ui/context.tsx";
import { useActiveActions, useKeyLayer } from "../ui/keymap.ts";
import { Stack, Text } from "../ui/primitives.tsx";

interface HelpRow {
  readonly id: string;
  readonly heading: boolean;
  readonly keys: string;
  readonly title: string;
}

const row = (id: string, keys: string, title: string): HelpRow => ({
  id,
  heading: false,
  keys,
  title,
});
const heading = (title: string): HelpRow => ({
  id: `heading:${title}`,
  heading: true,
  keys: "",
  title,
});

/** Help for the screen underneath first, then everything else. Generated from the action table. */
export function HelpPanel({
  active,
  height,
  onClose,
}: {
  readonly active: boolean;
  readonly height: number;
  readonly onClose: () => void;
}) {
  const { capabilities } = useUi();
  const { actions } = useActiveActions("help");
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState<string | null>(null);
  const keyColumn = (definition: ActionDefinition) =>
    helpKeyLabel(definition, capabilities.unicode);
  const signature = actions.map((action) => action.id).join(",");
  const rows = useMemo(() => {
    const here = new Set<string>();
    const result: HelpRow[] = [];
    const byScope = new Map<ActionScope, HelpRow[]>();
    for (const action of actions) {
      if (action.definition.keys.length === 0) continue;
      if (action.reachableKeys.length === 0 && action.scope !== "app") continue;
      here.add(action.id);
      const rows = byScope.get(action.scope) ?? [];
      rows.push(row(action.id, keyColumn(action.definition), action.title));
      byScope.set(action.scope, rows);
    }
    for (const [scope, entries] of byScope) {
      result.push(heading(`Here: ${ACTION_SCOPES[scope].title}`), ...entries);
    }
    const otherScopes = new Map<ActionScope, HelpRow[]>();
    for (const [id, definition] of allActions()) {
      if (here.has(id) || definition.keys.length === 0) continue;
      if (definition.scope === "quit" || definition.scope === "help") continue;
      const entries = otherScopes.get(definition.scope) ?? [];
      entries.push(row(id, keyColumn(definition), definition.title));
      otherScopes.set(definition.scope, entries);
    }
    for (const [scope, entries] of otherScopes) {
      result.push(heading(ACTION_SCOPES[scope].title), ...entries);
    }
    return result;
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- The signature captures which actions are active.
  }, [signature, capabilities.unicode]);
  const needle = filter?.trim().toLocaleLowerCase() ?? "";
  const visible = needle
    ? rows.filter(
        (entry) =>
          !entry.heading && `${entry.keys} ${entry.title}`.toLocaleLowerCase().includes(needle),
      )
    : rows;
  const count = Math.max(1, height - 2);
  const maximum = Math.max(0, visible.length - count);
  const start = Math.min(offset, maximum);
  const scroll = (next: number) => setOffset(Math.max(0, Math.min(maximum, next)));
  useKeyLayer("help", {
    active,
    modal: true,
    typing: filter !== null,
    bindings: {
      "help.close": () => {
        if (filter !== null) {
          setFilter(null);
          setOffset(0);
        } else onClose();
      },
      "help.up": { enabled: filter === null, run: () => scroll(start - 1) },
      "help.down": { enabled: filter === null, run: () => scroll(start + 1) },
      "help.pageUp": () => scroll(start - count),
      "help.pageDown": () => scroll(start + count),
      "help.filter": { enabled: filter === null, run: () => setFilter("") },
    },
  });
  const width = Math.min(16, Math.max(...rows.map((entry) => entry.keys.length), 8));
  return (
    <Stack id="help-panel" width="100%" height="100%" flexDirection="column">
      <Stack height={1} flexShrink={0} flexDirection="row">
        {filter !== null ? (
          <>
            <Text tone="accent" flexShrink={0}>
              Filter:{" "}
            </Text>
            <input
              id="help-filter"
              flexGrow={1}
              focused={active}
              value={filter}
              onInput={(value) => {
                setFilter(value);
                setOffset(0);
              }}
            />
          </>
        ) : (
          <Text height={1} tone="muted" wrapMode="none" truncate>
            What you can do here, then everywhere else. / filters.
          </Text>
        )}
      </Stack>
      <Stack flexGrow={1} minHeight={0} flexDirection="column" overflow="hidden">
        {visible.length === 0 ? (
          <Text tone="muted">No actions match. Esc clears the filter.</Text>
        ) : (
          visible.slice(start, start + count).map((entry) =>
            entry.heading ? (
              <Text
                key={entry.id}
                height={1}
                flexShrink={0}
                tone="accent"
                strong
                wrapMode="none"
                truncate
              >
                {entry.title.toUpperCase()}
              </Text>
            ) : (
              <Stack key={entry.id} height={1} flexShrink={0} flexDirection="row">
                <Text
                  height={1}
                  width={width + 2}
                  flexShrink={0}
                  wrapMode="none"
                  tone="text"
                  strong
                >
                  {`  ${entry.keys}`.slice(0, width + 2)}
                </Text>
                <Text height={1} flexGrow={1} minWidth={0} wrapMode="none" truncate tone="muted">
                  {` ${entry.title}`}
                </Text>
              </Stack>
            ),
          )
        )}
      </Stack>
      <Text height={1} flexShrink={0} tone="muted" wrapMode="none" truncate>
        {visible.length > count
          ? `${start + 1}-${Math.min(visible.length, start + count)} of ${visible.length}`
          : ""}
      </Text>
    </Stack>
  );
}
