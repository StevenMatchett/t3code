import { useEffect, useMemo, useState } from "react";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import { useKeyLayer } from "../ui/keymap.ts";
import { fuzzyScore } from "../ui/fuzzy.ts";
import { ListView } from "../ui/ListView.tsx";
import { EmptyState } from "../ui/StateMessage.tsx";
import { SelectionRow } from "../ui/SelectionRow.tsx";
import { Stack, Text } from "../ui/primitives.tsx";
import { inlineTerminalText } from "../ui/textLayout.ts";

export interface CommandPaletteItem {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly keywords?: string;
  readonly kind?: "command" | "entity";
  /** The key that runs this directly, shown so the palette teaches it. */
  readonly shortcut?: string;
  /** Higher sorts first on an empty query, and breaks ties while filtering. */
  readonly rank?: number;
}

/** A leading `>` keeps only commands, like editor palettes. */
function parseQuery(raw: string) {
  const commandsOnly = raw.trimStart().startsWith(">");
  return { commandsOnly, query: commandsOnly ? raw.trimStart().slice(1) : raw };
}

/** Label matches rank by quality. Keywords, details, and message text still find an item below them. */
function score(item: CommandPaletteItem, query: string) {
  const label = fuzzyScore(query, item.label);
  if (label !== null) return label;
  const haystack = `${item.label} ${item.detail} ${item.keywords ?? ""}`.toLocaleLowerCase();
  return query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/u)
    .every((token) => haystack.includes(token))
    ? 100
    : null;
}

export function CommandPalette({
  items,
  height,
  active,
  searching,
  searchFailed,
  searchedQuery,
  searchDebounceMs,
  onSearchQueryChange,
  onChoose,
  onClose,
}: {
  readonly items: readonly CommandPaletteItem[];
  readonly height: number;
  readonly active: boolean;
  readonly searching: boolean;
  readonly searchFailed: boolean;
  readonly searchedQuery: string;
  readonly searchDebounceMs: number;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onChoose: (id: string) => void;
  readonly onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const parsed = parseQuery(query);
  const filtered = useMemo(() => {
    const { commandsOnly, query: needle } = parseQuery(query);
    return items
      .flatMap((item) => {
        if (commandsOnly && item.kind !== "command") return [];
        const value = score(item, needle);
        return value === null ? [] : [{ item, value: value + (item.rank ?? 0) / 10_000 }];
      })
      .toSorted((left, right) => right.value - left.value)
      .map(({ item }) => item);
  }, [items, query]);
  const normalizedQuery = parsed.commandsOnly ? "" : query.trim().slice(0, 200);
  const searchPending = normalizedQuery.length >= 2 && normalizedQuery !== searchedQuery;
  useEffect(() => {
    if (normalizedQuery.length < 2 || searchDebounceMs === 0) return;
    const fiber = Effect.runFork(
      Effect.sleep(searchDebounceMs).pipe(
        Effect.andThen(Effect.sync(() => onSearchQueryChange(normalizedQuery))),
      ),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [normalizedQuery, onSearchQueryChange, searchDebounceMs]);
  const selected = Math.max(0, Math.min(cursor, filtered.length - 1));
  const choose = () => {
    const item = filtered[selected];
    if (item) onChoose(item.id);
  };
  useKeyLayer("palette", {
    active,
    modal: true,
    typing: true,
    bindings: {
      "palette.close": onClose,
      "palette.choose": choose,
      "palette.up": () => {
        if (filtered.length > 0)
          setCursor((current) => (current - 1 + filtered.length) % filtered.length);
      },
      "palette.down": () => {
        if (filtered.length > 0) setCursor((current) => (current + 1) % filtered.length);
      },
    },
  });
  return (
    <Stack width="100%" height="100%" flexDirection="column">
      <input
        id="command-palette-input"
        focused={active}
        width="100%"
        value={query}
        placeholder="Search threads and projects, or > for commands"
        onInput={(value) => {
          setQuery(value);
          setCursor(0);
          const normalized = parseQuery(value).commandsOnly ? "" : value.trim().slice(0, 200);
          if (normalized.length < 2) onSearchQueryChange("");
          else if (searchDebounceMs === 0) onSearchQueryChange(normalized);
        }}
      />
      <ListView
        items={filtered}
        selected={selected}
        height={Math.max(1, height - 2)}
        itemKey={(item) => item.id}
        itemId={(item) => `command-palette-${item.id}`}
        empty={<EmptyState title="No matches." description="Esc closes. > filters to commands." />}
        onActivate={(item, index) => {
          setCursor(index);
          onChoose(item.id);
        }}
        renderItem={(item, index) => (
          <SelectionRow
            selected={index === selected}
            active={active}
            label={inlineTerminalText(item.detail ? `${item.label}  ${item.detail}` : item.label)}
            trailing={
              item.shortcut ? (
                <Text height={1} flexShrink={0} tone="muted" wrapMode="none">
                  {` ${item.shortcut} `}
                </Text>
              ) : undefined
            }
          />
        )}
      />
      <Text height={1} flexShrink={0} tone="muted" wrapMode="none" truncate>
        {searchFailed
          ? "Conversation search unavailable · local results shown"
          : searchPending || searching
            ? "Searching conversation output..."
            : `${filtered.length} result${filtered.length === 1 ? "" : "s"}`}
      </Text>
    </Stack>
  );
}
