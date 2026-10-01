import type { ContextMenuItem } from "@t3tools/contracts";

export type ExternalLinkContextMenuAction = "copy-link" | "open-external";

export type ExternalLinkContextMenuFailureOperation =
  | "show-link-context-menu"
  | "open-link-external"
  | "copy-link";

const EXTERNAL_LINK_CONTEXT_MENU_ITEMS = [
  { id: "copy-link", label: "Copy link" },
  { id: "open-external", label: "Go to link" },
] as const satisfies readonly ContextMenuItem<ExternalLinkContextMenuAction>[];

interface ShowExternalLinkContextMenuOptions {
  readonly href: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly showContextMenu: (
    items: readonly ContextMenuItem<ExternalLinkContextMenuAction>[],
    position: { readonly x: number; readonly y: number },
  ) => Promise<ExternalLinkContextMenuAction | null>;
  readonly openExternal: (href: string) => Promise<void>;
  readonly copyLink: (href: string) => Promise<unknown>;
  readonly reportFailure: (
    operation: ExternalLinkContextMenuFailureOperation,
    cause: unknown,
  ) => void;
}

export function resolveExternalWebLinkHost(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href.startsWith("//") ? `https:${href}` : href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname || null;
  } catch {
    return null;
  }
}

export async function showExternalLinkContextMenu({
  href,
  position,
  showContextMenu,
  openExternal,
  copyLink,
  reportFailure,
}: ShowExternalLinkContextMenuOptions): Promise<void> {
  let action: ExternalLinkContextMenuAction | null;
  try {
    action = await showContextMenu(EXTERNAL_LINK_CONTEXT_MENU_ITEMS, position);
  } catch (cause) {
    reportFailure("show-link-context-menu", cause);
    return;
  }

  try {
    if (action === "open-external") {
      await openExternal(href);
    } else if (action === "copy-link") {
      await copyLink(href);
    }
  } catch (cause) {
    if (action)
      reportFailure(action === "open-external" ? "open-link-external" : "copy-link", cause);
  }
}
