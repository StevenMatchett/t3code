export function calculateShellLayout(width: number, height: number) {
  const availableWidth = Math.max(1, Math.floor(width) - 2);
  const split = width >= 104 && height >= 18;
  const sidebarWidth = split ? Math.min(36, Math.max(28, Math.floor(width / 4))) : 0;
  const mainWidth = availableWidth - (split ? sidebarWidth + 1 : 0);
  const bodyHeight = Math.max(3, Math.floor(height) - 4);
  return {
    split,
    sidebarWidth,
    mainWidth,
    bodyHeight,
    contentWidth: Math.max(1, mainWidth - 4),
    contentHeight: Math.max(1, bodyHeight - 2),
  };
}

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
