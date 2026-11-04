/** Named widths every screen lays out against, so a breakpoint means one thing everywhere. */
export const BREAKPOINTS = { medium: 60, wide: 104, ultra: 170 } as const;
/** Below this the shell shows a message instead of a broken layout. */
export const MINIMUM_SIZE = { width: 30, height: 8 } as const;

export type SizeClass = "narrow" | "medium" | "wide" | "ultra";

export function sizeClass(width: number): SizeClass {
  if (width >= BREAKPOINTS.ultra) return "ultra";
  if (width >= BREAKPOINTS.wide) return "wide";
  return width >= BREAKPOINTS.medium ? "medium" : "narrow";
}

export function calculateShellLayout(width: number, height: number) {
  const availableWidth = Math.max(1, Math.floor(width) - 2);
  const size = sizeClass(width);
  const split = width >= BREAKPOINTS.wide && height >= 18;
  const sidebarWidth = !split
    ? 0
    : size === "ultra"
      ? 44
      : Math.min(36, Math.max(32, Math.floor(width / 4)));
  const mainWidth = availableWidth - (split ? sidebarWidth + 1 : 0);
  // Short terminals give up the row under the header before they give up content.
  const headerGap = height >= 30 ? 1 : 0;
  const bodyHeight = Math.max(3, Math.floor(height) - 3 - headerGap);
  return {
    size,
    split,
    headerGap,
    tooSmall: width < MINIMUM_SIZE.width || height < MINIMUM_SIZE.height,
    sidebarWidth,
    mainWidth,
    bodyHeight,
    contentWidth: Math.max(1, mainWidth - 4),
    contentHeight: Math.max(1, bodyHeight - 2),
  };
}

/** A centered box of the preferred size that can never leave the area it opens in. */
export function clampBox(
  area: { readonly width: number; readonly height: number },
  preferred: { readonly width: number; readonly height: number },
) {
  const width = Math.max(1, Math.min(preferred.width, area.width));
  const height = Math.max(1, Math.min(preferred.height, area.height));
  return {
    width,
    height,
    left: Math.floor((area.width - width) / 2),
    top: Math.floor((area.height - height) / 2),
  };
}

/** Rows above the composer, top to bottom. The composer's position never depends on them. */
export function conversationRows({
  height,
  composer,
  agents,
  request,
  extraNotice = 0,
}: {
  readonly height: number;
  readonly composer: number;
  readonly agents: number;
  readonly request: number;
  readonly extraNotice?: number;
}) {
  // One row above the status line is always reserved for find, queue, and errors.
  const notice = height >= 12 ? 1 : 0;
  return {
    notice,
    transcript: Math.max(1, height - 1 - composer - agents - request - notice - extraNotice),
  };
}

/** Rows the request panel takes: enough for every option plus some detail, within what is free. */
export function requestPanelHeight(
  height: number,
  composer: number,
  agents: number,
  wanted: number,
) {
  const free = height - 1 - composer - agents - (height >= 12 ? 1 : 0) - 1;
  return Math.max(4, Math.min(wanted + 2, Math.max(6, Math.floor(height * 0.6)), free));
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
