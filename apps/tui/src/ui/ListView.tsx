import type { ReactNode } from "react";
import { Stack, Text } from "./primitives.tsx";

/** The first visible row that keeps the selection centered without leaving the list short. */
export function listWindowStart(selected: number, visible: number, total: number) {
  return Math.max(0, Math.min(selected - Math.floor(visible / 2), total - visible));
}

export interface ListViewProps<Item> {
  readonly items: readonly Item[];
  readonly selected: number;
  /** Rows available, including one for the position counter when the list overflows. */
  readonly height: number;
  readonly rowHeight?: number;
  readonly itemKey: (item: Item) => string;
  readonly itemId?: (item: Item, index: number) => string;
  readonly renderItem: (item: Item, index: number) => ReactNode;
  readonly empty?: ReactNode;
  readonly onActivate?: (item: Item, index: number) => void;
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
}: ListViewProps<Item>) {
  const rows = Math.max(1, height);
  const fits = items.length * rowHeight <= rows;
  const visible = Math.max(1, Math.floor((fits || !showCounter ? rows : rows - 1) / rowHeight));
  const start = listWindowStart(Math.max(0, selected), visible, items.length);
  return (
    <Stack flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
      {items.length === 0
        ? empty
        : items.slice(start, start + visible).map((item, offset) => {
            const index = start + offset;
            return (
              <Stack
                key={itemKey(item)}
                {...(itemId ? { id: itemId(item, index) } : {})}
                width="100%"
                height={rowHeight}
                flexDirection="column"
                flexShrink={0}
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
                  onActivate(item, index);
                }}
              >
                {renderItem(item, index)}
              </Stack>
            );
          })}
      <Stack flexGrow={1} />
      {!fits && showCounter ? (
        <Text height={1} flexShrink={0} tone="muted">
          {`${start + 1}-${Math.min(items.length, start + visible)} of ${items.length}`}
        </Text>
      ) : null}
    </Stack>
  );
}
