import { describe, expect, it, vi } from "vite-plus/test";

import {
  resolveExternalWebLinkHost,
  resolveExternalWebLinkHref,
  showExternalLinkContextMenu,
} from "./externalLinkContextMenu";

function createHarness(selection: "open-external" | "copy-link" | null) {
  return {
    showContextMenu: vi.fn().mockResolvedValue(selection),
    openExternal: vi.fn().mockResolvedValue(undefined),
    copyLink: vi.fn().mockResolvedValue(undefined),
    reportFailure: vi.fn(),
  };
}

const href = "https://example.com/docs?topic=menus#copy";
const position = { x: 12, y: 24 };

describe("external chat link context menu", () => {
  it("offers exactly Copy link and Go to link, and dismisses without an action", async () => {
    const harness = createHarness(null);
    await showExternalLinkContextMenu({ href, position, ...harness });

    expect(harness.showContextMenu).toHaveBeenCalledWith(
      [
        { id: "copy-link", label: "Copy link" },
        { id: "open-external", label: "Go to link" },
      ],
      position,
    );
    expect(harness.openExternal).not.toHaveBeenCalled();
    expect(harness.copyLink).not.toHaveBeenCalled();
  });

  it("copies the exact destination without opening it", async () => {
    const harness = createHarness("copy-link");
    await showExternalLinkContextMenu({ href, position, ...harness });

    expect(harness.copyLink).toHaveBeenCalledWith(href);
    expect(harness.openExternal).not.toHaveBeenCalled();
  });

  it("opens the destination without copying it", async () => {
    const harness = createHarness("open-external");
    await showExternalLinkContextMenu({ href, position, ...harness });

    expect(harness.openExternal).toHaveBeenCalledWith(href);
    expect(harness.copyLink).not.toHaveBeenCalled();
  });

  it.each([
    ["copy-link", "copyLink", "copy-link"],
    ["open-external", "openExternal", "open-link-external"],
  ] as const)("reports a failed %s action", async (action, callback, operation) => {
    const harness = createHarness(action);
    const cause = new Error("action failed");
    harness[callback].mockRejectedValue(cause);
    await showExternalLinkContextMenu({ href, position, ...harness });
    expect(harness.reportFailure).toHaveBeenCalledWith(operation, cause);
  });

  it("reports when the menu cannot be shown", async () => {
    const harness = createHarness(null);
    const cause = new Error("menu unavailable");
    harness.showContextMenu.mockRejectedValue(cause);
    await showExternalLinkContextMenu({ href, position, ...harness });

    expect(harness.reportFailure).toHaveBeenCalledWith("show-link-context-menu", cause);
    expect(harness.copyLink).not.toHaveBeenCalled();
    expect(harness.openExternal).not.toHaveBeenCalled();
  });

  it.each([
    ["https://example.com", "example.com"],
    ["http://localhost:3000/path", "localhost"],
    ["//cdn.example.com/clip.mp4?signature=abc#t=2", "cdn.example.com"],
    ["//", null],
    ["#details", null],
    ["mailto:hello@example.com", null],
    ["file:///tmp/example.txt", null],
    ["javascript:void(0)", null],
    ["not a URL", null],
    [undefined, null],
  ])("resolves the external web-link host for %s as %s", (href, expected) => {
    expect(resolveExternalWebLinkHost(href)).toBe(expected);
  });

  it.each([
    [
      "https://example.com/docs?topic=security#links",
      "https://example.com/docs?topic=security#links",
    ],
    ["HTTP://EXAMPLE.COM", "http://example.com/"],
    ["//example.com/path", "https://example.com/path"],
  ])("resolves the safe external web-link href for %s as %s", (href, expected) => {
    expect(resolveExternalWebLinkHref(href)).toBe(expected);
  });

  it.each([
    "javascript:alert(document.domain)",
    " \nJaVaScRiPt:alert(document.domain)",
    "data:text/html,<script>alert(document.domain)</script>",
    "file:///tmp/example.txt",
    "mailto:hello@example.com",
    "/relative/path",
    "not a URL",
    "",
  ])("rejects unsafe external web-link href %s", (href) => {
    expect(resolveExternalWebLinkHref(href)).toBeNull();
  });
});
