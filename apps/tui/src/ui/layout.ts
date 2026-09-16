export interface PanelLayoutOptions {
  readonly bordered?: boolean;
  readonly paddingX?: number;
  readonly width: number;
}

export interface PanelLayout {
  readonly borderColumns: number;
  readonly contentWidth: number;
  readonly paddingX: number;
}

function wholeNonNegative(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

export function calculatePanelLayout({
  bordered = true,
  paddingX = 1,
  width,
}: PanelLayoutOptions): PanelLayout {
  const safeWidth = wholeNonNegative(width);
  const borderColumns = bordered ? Math.min(2, safeWidth) : 0;
  const availableWidth = safeWidth - borderColumns;
  const safePadding = wholeNonNegative(paddingX);
  const resolvedPadding = Math.min(safePadding, Math.floor(availableWidth / 2));

  return {
    borderColumns,
    contentWidth: availableWidth - resolvedPadding * 2,
    paddingX: resolvedPadding,
  };
}
