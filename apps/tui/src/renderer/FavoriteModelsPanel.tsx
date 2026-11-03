import { useAtomValue } from "@effect/atom-react";
import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import type { TuiClient } from "../connection/clientRuntime.ts";
import {
  availableModelChoices,
  isFavoriteChoice,
  type FavoriteModel,
  type ModelChoice,
} from "../features/chat/providerChoices.ts";
import { SelectionRow } from "../ui/SelectionRow.tsx";
import { Stack, Text } from "../ui/primitives.tsx";
import { inlineTerminalText } from "../ui/textLayout.ts";

/** Rows stay in catalog order so a toggle never moves the row under the cursor. */
export function FavoriteModelsPanel({
  client,
  favorites,
  height,
  active,
  onToggle,
  onClose,
}: {
  readonly client: TuiClient;
  readonly favorites: readonly FavoriteModel[];
  readonly height: number;
  readonly active: boolean;
  readonly onToggle: (favorite: FavoriteModel) => void;
  readonly onClose: () => void;
}) {
  const catalog = useAtomValue(client.providers);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const needle = query.toLocaleLowerCase();
  const filtered = availableModelChoices(catalog.providers).filter((choice) =>
    choiceLabel(choice).concat(" ", choice.model.slug).toLocaleLowerCase().includes(needle),
  );
  const selected = Math.max(0, Math.min(cursor, filtered.length - 1));
  const count = Math.max(1, height - 3);
  const start = Math.max(0, Math.min(selected - Math.floor(count / 2), filtered.length - count));
  const toggle = (choice: ModelChoice | undefined) => {
    if (choice) onToggle({ instanceId: choice.provider.instanceId, model: choice.model.slug });
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
    else if (key.name === "return" || key.name === "enter") {
      if (!key.repeated) toggle(filtered[selected]);
    } else return;
    key.preventDefault();
    key.stopPropagation();
  });
  return (
    <Stack width="100%" height="100%" flexDirection="column" gap={1}>
      <input
        id="favorite-models-search"
        focused={active}
        width="100%"
        value={query}
        placeholder="Search models..."
        onInput={(value) => {
          setQuery(value);
          setCursor(0);
        }}
      />
      <Stack flexGrow={1} flexDirection="column" overflow="hidden">
        {filtered.length === 0 ? (
          <Text tone="muted">
            {catalog.status === "live"
              ? "No available models match. Configure providers in T3 settings."
              : catalog.status === "error"
                ? "Provider catalog unavailable. Close and reconnect."
                : "Loading provider choices..."}
          </Text>
        ) : (
          filtered.slice(start, start + count).map((choice, offset) => (
            <Stack
              key={JSON.stringify([choice.provider.instanceId, choice.model.slug])}
              id={`favorite-model-${start + offset}`}
              height={1}
              flexShrink={0}
              onMouseDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                setCursor(start + offset);
                toggle(choice);
              }}
            >
              <SelectionRow
                selected={start + offset === selected}
                active={active}
                label={inlineTerminalText(
                  `${isFavoriteChoice(favorites, choice) ? "[x]" : "[ ]"} ${choiceLabel(choice)}`,
                )}
              />
            </Stack>
          ))
        )}
      </Stack>
      <Text height={1} tone="muted">
        Favorites are listed first when you start a new thread.
      </Text>
    </Stack>
  );
}

function choiceLabel(choice: ModelChoice) {
  return `${choice.provider.displayName ?? choice.provider.instanceId} / ${choice.model.name}`;
}
