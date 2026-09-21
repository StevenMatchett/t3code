import { describe, expect, it } from "@effect/vitest";
import { browserCommand } from "./browser.ts";

describe("browser launch", () => {
  const url = "https://github.com/example/repo/pull/42";
  it("launches the desktop browser with the URL as a separate argument", () => {
    expect(browserCommand(url, "linux", { WAYLAND_DISPLAY: "wayland-1" })).toEqual({
      command: "xdg-open",
      args: [url],
    });
    expect(browserCommand(url, "darwin", {})).toEqual({ command: "open", args: [url] });
    expect(browserCommand(url, "win32", {})).toEqual({
      command: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", url],
    });
  });
  it("leaves SSH and headless sessions to the terminal's link handler", () => {
    expect(
      browserCommand(url, "linux", { DISPLAY: ":0", SSH_CONNECTION: "client server" }),
    ).toBeNull();
    expect(browserCommand(url, "darwin", { SSH_TTY: "/dev/pts/1" })).toBeNull();
    expect(browserCommand(url, "linux", {})).toBeNull();
  });
  it("rejects URLs that are not web links", () => {
    expect(() => browserCommand("file:///tmp/script", "darwin", {})).toThrow("Invalid PR URL");
  });
});
