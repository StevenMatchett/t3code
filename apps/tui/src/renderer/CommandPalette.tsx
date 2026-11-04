import { useEffect, useMemo, useState } from "react";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import { useKeyLayer } from "../ui/keymap.ts";
import { SelectionRow } from "../ui/SelectionRow.tsx";
import { Stack, Text } from "../ui/primitives.tsx";
import { inlineTerminalText } from "../ui/textLayout.ts";

export interface CommandPaletteItem {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly keywords?: string;
  readonly kind?: "command" | "entity";
}

/** A leading `>` keeps only commands, like editor palettes. */
function parseQuery(raw: string) {
  const commandsOnly = raw.trimStart().startsWith(">");
  return { commandsOnly, query: commandsOnly ? raw.trimStart().slice(1) : raw };
}

function matches(item: CommandPaletteItem, query: string) {
  const haystack = `${item.label} ${item.detail} ${item.keywords ?? ""}`.toLocaleLowerCase();
  return query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/u)
    .every((token) => haystack.includes(token));
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
    return items.filter(
      (item) => (!commandsOnly || item.kind === "command") && matches(item, needle),
    );
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
  const count = Math.max(1, height - 3);
  const start = Math.max(0, Math.min(selected - Math.floor(count / 2), filtered.length - count));
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
    <Stack width="100%" height="100%" flexDirection="column" gap={1}>
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
      <Stack flexGrow={1} flexDirection="column" overflow="hidden">
        {filtered.length === 0 ? (
          <Text tone="muted">No matching projects, threads, or commands.</Text>
        ) : (
          filtered.slice(start, start + count).map((item, offset) => {
            const index = start + offset;
            return (
              <Stack
                key={item.id}
                id={`command-palette-${item.id}`}
                height={1}
                flexShrink={0}
                onMouseDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setCursor(index);
                  onChoose(item.id);
                }}
              >
                <SelectionRow
                  selected={index === selected}
                  active={active}
                  label={inlineTerminalText(`${item.label}  ${item.detail}`)}
                />
              </Stack>
            );
          })
        )}
      </Stack>
      <Text height={1} tone="muted">
        {searchFailed
          ? "Conversation search unavailable · local results shown"
          : searchPending || searching
            ? "Searching conversation output..."
            : "Type to filter · ↑↓ select · Enter open · Esc close"}
      </Text>
    </Stack>
  );
}
