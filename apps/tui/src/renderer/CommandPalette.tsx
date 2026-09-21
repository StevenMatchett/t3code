import { useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useState } from "react";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import { SelectionRow } from "../ui/SelectionRow.tsx";
import { Stack, Text } from "../ui/primitives.tsx";
import { inlineTerminalText } from "../ui/textLayout.ts";

export interface CommandPaletteItem {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly keywords?: string;
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
  const filtered = useMemo(() => items.filter((item) => matches(item, query)), [items, query]);
  const normalizedQuery = query.trim().slice(0, 200);
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
  useKeyboard((key) => {
    if (!active || key.ctrl || key.meta || key.option) return;
    if (key.name === "escape") onClose();
    else if (filtered.length > 0 && (key.name === "down" || key.name === "tab"))
      setCursor(
        (current) =>
          (current + (key.name === "tab" && key.shift ? filtered.length - 1 : 1)) % filtered.length,
      );
    else if (filtered.length > 0 && key.name === "up")
      setCursor((current) => (current - 1 + filtered.length) % filtered.length);
    else return;
    key.preventDefault();
    key.stopPropagation();
  });
  return (
    <Stack width="100%" height="100%" flexDirection="column" gap={1}>
      <input
        id="command-palette-input"
        focused={active}
        width="100%"
        value={query}
        placeholder="Search conversation output, projects, threads, and commands..."
        onInput={(value) => {
          setQuery(value);
          setCursor(0);
          const normalized = value.trim().slice(0, 200);
          if (normalized.length < 2) onSearchQueryChange("");
          else if (searchDebounceMs === 0) onSearchQueryChange(normalized);
        }}
        onSubmit={choose}
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
