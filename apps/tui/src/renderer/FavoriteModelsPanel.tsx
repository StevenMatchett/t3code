import { useAtomValue } from "@effect/atom-react";
import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import type { TuiClient } from "../connection/clientRuntime.ts";
import {
  availableModelChoices,
  isFavoriteChoice,
  moveFavoriteModel,
  toggleFavoriteModel,
  type FavoriteModel,
  type ModelChoice,
} from "../features/chat/providerChoices.ts";
import { Panel } from "../ui/Panel.tsx";
import { SelectionRow } from "../ui/SelectionRow.tsx";
import { Stack, Text } from "../ui/primitives.tsx";
import { inlineTerminalText } from "../ui/textLayout.ts";

const STACKED_BELOW_WIDTH = 64;

/**
 * Picks models on the left and orders them on the right. A model picked up on the right moves
 * only on screen until it is dropped, so Esc can put it back without touching the saved order.
 */
export function FavoriteModelsPanel({
  client,
  favorites,
  width,
  height,
  active,
  onChange,
  onClose,
}: {
  readonly client: TuiClient;
  readonly favorites: readonly FavoriteModel[];
  readonly width: number;
  readonly height: number;
  readonly active: boolean;
  readonly onChange: (
    update: (favorites: readonly FavoriteModel[]) => readonly FavoriteModel[],
  ) => void;
  readonly onClose: () => void;
}) {
  const catalog = useAtomValue(client.providers);
  const [column, setColumn] = useState<"models" | "order">("models");
  const [query, setQuery] = useState("");
  const [modelCursor, setModelCursor] = useState(0);
  const [orderCursor, setOrderCursor] = useState(0);
  const [held, setHeld] = useState<{
    readonly favorite: FavoriteModel;
    readonly index: number;
  } | null>(null);
  const choices = availableModelChoices(catalog.providers);
  const needle = query.toLocaleLowerCase();
  const models = choices.filter((choice) =>
    choiceLabel(choice).concat(" ", choice.model.slug).toLocaleLowerCase().includes(needle),
  );
  const selectedModel = Math.max(0, Math.min(modelCursor, models.length - 1));
  const order = held ? moveFavoriteModel(favorites, held.favorite, held.index) : favorites;
  const selectedOrder = held?.index ?? Math.max(0, Math.min(orderCursor, favorites.length - 1));
  const stacked = width < STACKED_BELOW_WIDTH;
  // One footer row, plus two border rows on each panel.
  const panelRows = stacked ? Math.floor((height - 1) / 2) - 2 : height - 3;
  const modelCount = Math.max(1, panelRows - 1);
  const orderCount = Math.max(1, panelRows);
  const modelStart = windowStart(selectedModel, modelCount, models.length);
  const orderStart = windowStart(selectedOrder, orderCount, favorites.length);
  const toggleModel = (choice: ModelChoice | undefined) => {
    if (!choice) return;
    const favorite = { instanceId: choice.provider.instanceId, model: choice.model.slug };
    onChange((current) => toggleFavoriteModel(current, favorite));
  };
  const moveCursor = (offset: number) => {
    if (column === "models" && models.length > 0)
      setModelCursor((selectedModel + offset + models.length) % models.length);
    else if (column === "order" && favorites.length > 0)
      setOrderCursor((selectedOrder + offset + favorites.length) % favorites.length);
  };
  const dropHeld = (index: number) => {
    if (!held) return;
    const { favorite } = held;
    setHeld(null);
    setOrderCursor(index);
    onChange((current) => moveFavoriteModel(current, favorite, index));
  };
  const focusModels = () => {
    setHeld(null);
    setColumn("models");
  };
  const removeSelected = () => {
    const favorite = favorites[selectedOrder];
    if (favorite) onChange((current) => toggleFavoriteModel(current, favorite));
  };
  useKeyboard((key) => {
    if (!active || key.ctrl || key.meta || key.option) return;
    const confirm = (key.name === "return" || key.name === "enter") && !key.repeated;
    if (held) {
      if (key.name === "escape") setHeld(null);
      else if (key.name === "up" || key.name === "down") {
        const index = held.index + (key.name === "up" ? -1 : 1);
        if (index >= 0 && index < favorites.length) setHeld({ ...held, index });
      } else if (confirm) dropHeld(held.index);
      else if (key.name !== "tab" && key.name !== "return" && key.name !== "enter") return;
    } else if (key.name === "escape") onClose();
    else if (key.name === "tab") setColumn(column === "models" ? "order" : "models");
    else if (key.name === "up") moveCursor(-1);
    else if (key.name === "down") moveCursor(1);
    else if (column === "models" && confirm) toggleModel(models[selectedModel]);
    else if (column === "order" && confirm) {
      const favorite = favorites[selectedOrder];
      if (favorite) setHeld({ favorite, index: selectedOrder });
    } else if (
      column === "order" &&
      (key.name === "x" || key.name === "delete" || key.name === "backspace")
    )
      removeSelected();
    else return;
    key.preventDefault();
    key.stopPropagation();
  });
  const panelLayout = stacked ? { height: panelRows + 2 } : { flexGrow: 1, flexBasis: 0 };
  return (
    <Stack width="100%" height="100%" flexDirection="column">
      <Stack
        flexGrow={1}
        minHeight={0}
        width="100%"
        flexDirection={stacked ? "column" : "row"}
        overflow="hidden"
      >
        <Panel
          id="favorite-models-selector"
          title="Models"
          borderTone={column === "models" ? "borderFocused" : "border"}
          flexDirection="column"
          minWidth={0}
          {...panelLayout}
          onMouseDown={focusModels}
        >
          <input
            id="favorite-models-search"
            focused={active && column === "models"}
            width="100%"
            value={query}
            placeholder="Search models..."
            onInput={(value) => {
              setQuery(value);
              setModelCursor(0);
            }}
          />
          {models.length === 0 ? (
            <Text tone="muted">
              {catalog.status === "live"
                ? "No available models match. Configure providers in T3 settings."
                : catalog.status === "error"
                  ? "Provider catalog unavailable. Close and reconnect."
                  : "Loading provider choices..."}
            </Text>
          ) : (
            models.slice(modelStart, modelStart + modelCount).map((choice, offset) => (
              <Stack
                key={JSON.stringify([choice.provider.instanceId, choice.model.slug])}
                id={`favorite-model-${modelStart + offset}`}
                height={1}
                flexShrink={0}
                onMouseDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  event.stopPropagation();
                  focusModels();
                  setModelCursor(modelStart + offset);
                  toggleModel(choice);
                }}
              >
                <SelectionRow
                  selected={column === "models" && modelStart + offset === selectedModel}
                  active={active}
                  label={`${isFavoriteChoice(favorites, choice) ? "[x]" : "[ ]"} ${choiceLabel(choice)}`}
                />
              </Stack>
            ))
          )}
        </Panel>
        <Panel
          id="favorite-models-order"
          title="Order · new threads start on the top one"
          borderTone={column === "order" ? "borderFocused" : "border"}
          flexDirection="column"
          minWidth={0}
          {...panelLayout}
          onMouseDown={() => setColumn("order")}
        >
          {order.length === 0 ? (
            <Text tone="muted">No favorites yet. Press Enter on a model to add it.</Text>
          ) : (
            order.slice(orderStart, orderStart + orderCount).map((favorite, offset) => (
              <Stack
                key={JSON.stringify([favorite.instanceId, favorite.model])}
                id={`favorite-rank-${orderStart + offset}`}
                height={1}
                flexShrink={0}
                onMouseDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setColumn("order");
                  if (held) dropHeld(orderStart + offset);
                  else setOrderCursor(orderStart + offset);
                }}
              >
                <SelectionRow
                  selected={column === "order" && orderStart + offset === selectedOrder}
                  active={active}
                  label={`${held && orderStart + offset === held.index ? "↕ " : ""}${orderStart + offset + 1}. ${favoriteLabel(favorite, choices)}`}
                />
              </Stack>
            ))
          )}
        </Panel>
      </Stack>
      <Text height={1} tone="muted" wrapMode="none" truncate>
        {held
          ? "↑↓ moves it · Enter drops it here · Esc puts it back"
          : column === "models"
            ? "Enter adds or removes a favorite · Tab to set the order"
            : "Enter picks up a model to move it · X removes it · Tab back to models"}
      </Text>
    </Stack>
  );
}

function windowStart(selected: number, count: number, total: number) {
  return Math.max(0, Math.min(selected - Math.floor(count / 2), total - count));
}

function choiceLabel(choice: ModelChoice) {
  return inlineTerminalText(
    `${choice.provider.displayName ?? choice.provider.instanceId} / ${choice.model.name}`,
  );
}

/** Saved favorites can outlive their provider, so they stay listed and removable here. */
function favoriteLabel(favorite: FavoriteModel, choices: readonly ModelChoice[]) {
  const choice = choices.find(
    (item) =>
      item.provider.instanceId === favorite.instanceId && item.model.slug === favorite.model,
  );
  return choice
    ? choiceLabel(choice)
    : inlineTerminalText(`${favorite.instanceId} / ${favorite.model} (unavailable)`);
}
