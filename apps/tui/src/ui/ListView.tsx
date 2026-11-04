import { useState, type ReactNode } from "react";
import { useThemeColor } from "./context.tsx";
import { Stack, Text } from "./primitives.tsx";

/** The first visible row that keeps the selection centered without leaving the list short. */
export function listWindowStart(selected: number, visible: number, total: number) {
  return Math.max(0, Math.min(selected - Math.floor(visible / 2), total - visible));
}

/** The rows that fit around the selection when rows have different heights. */
export function variableListWindow(
  heights: readonly number[],
  selected: number,
  available: number,
) {
  if (heights.length === 0) return { start: 0, end: 0 };
  const anchor = Math.max(0, Math.min(selected, heights.length - 1));
  let start = anchor;
  let end = anchor + 1;
  let used = heights[anchor]!;
  // Half the room goes above the selection, then the rest fills downward, then upward again.
  while (start > 0 && used + heights[start - 1]! <= Math.floor(available / 2) + heights[anchor]!) {
    used += heights[--start]!;
  }
  while (end < heights.length && used + heights[end]! <= available) used += heights[end++]!;
  while (start > 0 && used + heights[start - 1]! <= available) used += heights[--start]!;
  return { start, end };
}

export interface ListViewProps<Item> {
  readonly items: readonly Item[];
  readonly selected: number;
  /** Rows available, including one for the position counter when the list overflows. */
  readonly height: number;
  readonly rowHeight?: number | ((item: Item) => number);
  /** While everything fits, spare rows go above this row instead of below the list. */
  readonly pushDown?: (item: Item) => boolean;
  readonly itemKey: (item: Item) => string;
  readonly itemId?: (item: Item, index: number) => string;
  readonly renderItem: (item: Item, index: number) => ReactNode;
  readonly empty?: ReactNode;
  readonly onActivate?: (
    item: Item,
    index: number,
    modifiers: { readonly shift: boolean; readonly ctrl: boolean },
  ) => void;
  readonly onContextMenu?: (item: Item, position: { x: number; y: number }) => void;
  readonly showCounter?: boolean;
}

/** A windowed list: selection stays visible, and only the rows on screen are ever rendered. */
export function ListView<Item>({
  items,
  selected,
  height,
  rowHeight = 1,
  itemKey,
  itemId,
  renderItem,
  empty,
  onActivate,
  onContextMenu,
  showCounter = true,
  pushDown,
}: ListViewProps<Item>) {
  const [hovered, setHovered] = useState<string | null>(null);
  const hover = useThemeColor("hover");
  const rows = Math.max(1, height);
  const heightOf = typeof rowHeight === "function" ? rowHeight : () => rowHeight;
  const heights = typeof rowHeight === "function" ? items.map(heightOf) : null;
  const fits = heights
    ? heights.reduce((sum, value) => sum + value, 0) <= rows
    : items.length * (rowHeight as number) <= rows;
  const room = fits || !showCounter ? rows : rows - 1;
  const visible = Math.max(1, Math.floor(room / (rowHeight as number)));
  const { start, end } = heights
    ? variableListWindow(heights, selected, room)
    : (() => {
        const first = listWindowStart(Math.max(0, selected), visible, items.length);
        return { start: first, end: first + visible };
      })();
  const spacerAt = fits && pushDown ? items.findIndex(pushDown) : -1;
  return (
    <Stack flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
      {items.length === 0
        ? empty
        : items.slice(start, end).flatMap((item, offset) => {
            const index = start + offset;
            const row = (
              <Stack
                key={itemKey(item)}
                {...(itemId ? { id: itemId(item, index) } : {})}
                width="100%"
                height={heightOf(item)}
                flexDirection="column"
                flexShrink={0}
                {...(onActivate && hover && hovered === itemKey(item) && index !== selected
                  ? { backgroundColor: hover }
                  : {})}
                onMouseOver={() => setHovered(itemKey(item))}
                onMouseOut={() =>
                  setHovered((current) => (current === itemKey(item) ? null : current))
                }
                onMouseDown={(event) => {
                  if (event.button === 2 && onContextMenu) {
                    event.preventDefault();
                    event.stopPropagation();
                    onContextMenu(item, { x: event.x, y: event.y });
                    return;
                  }
                  if (event.button !== 0 || !onActivate) return;
                  event.preventDefault();
                  event.stopPropagation();
                  onActivate(item, index, event.modifiers);
                }}
              >
                {renderItem(item, index)}
              </Stack>
            );
            return index === spacerAt ? [<Stack key="push-down" flexGrow={1} />, row] : [row];
          })}
      {spacerAt >= 0 ? null : <Stack flexGrow={1} />}
      {!fits && showCounter ? (
        <Text height={1} flexShrink={0} tone="muted">
          {`${start + 1}-${Math.min(items.length, end)} of ${items.length}`}
        </Text>
      ) : null}
    </Stack>
  );
}
