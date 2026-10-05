// @effect-diagnostics nodeBuiltinImport:off
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as NodeEvents from "node:events";
import * as NodeFS from "node:fs";
import { createNotificationAudio, notificationWave } from "./notificationAudio.ts";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
afterEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
});

describe("notification audio", () => {
  it.each(["SSH_CONNECTION", "SSH_TTY"])(
    "uses local terminal bells over %s without launching a host player",
    (key) => {
      vi.useFakeTimers();
      const bell = vi.fn();
      const audio = createNotificationAudio("linux", { [key]: "ssh-session" }, bell);
      audio.play("input");
      expect(bell).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(350);
      expect(bell).toHaveBeenCalledTimes(2);
      bell.mockClear();
      audio.play("completion");
      vi.runAllTimers();
      expect(bell).toHaveBeenCalledTimes(1);
      expect(mocks.spawn).not.toHaveBeenCalled();
      audio.close();
    },
  );
  it("cancels pending terminal bells on mute or close", () => {
    vi.useFakeTimers();
    const bell = vi.fn();
    const audio = createNotificationAudio("linux", { SSH_TTY: "/dev/pts/1" }, bell);
    audio.play("input");
    audio.stop();
    vi.runAllTimers();
    expect(bell).toHaveBeenCalledTimes(1);
    audio.play("input");
    audio.close();
    vi.runAllTimers();
    audio.play("completion");
    expect(bell).toHaveBeenCalledTimes(2);
  });
  it("generates distinct short PCM chimes", () => {
    const input = notificationWave("input");
    const completion = notificationWave("completion");
    expect(input.subarray(0, 4).toString()).toBe("RIFF");
    expect(input.readUInt32LE(40)).toBe(input.length - 44);
    expect(input.equals(completion)).toBe(false);
    expect(completion.length).toBeLessThan(22050 * 2);
  });
  it("coalesces playback, stops its own child, and removes temporary files", () => {
    const child = Object.assign(new NodeEvents.EventEmitter(), { kill: vi.fn() });
    mocks.spawn.mockReturnValue(child);
    const audio = createNotificationAudio("linux", {});
    try {
      audio.play("input");
      audio.play("completion");
      expect(mocks.spawn).toHaveBeenCalledTimes(1);
      const args = mocks.spawn.mock.calls[0]![1] as string[];
      const path = args[args.length - 1]!;
      if (path.endsWith(".wav")) expect(NodeFS.existsSync(path)).toBe(true);
      audio.close();
      expect(child.kill).toHaveBeenCalledOnce();
      child.emit("close", 1);
      if (path.endsWith(".wav")) expect(NodeFS.existsSync(path)).toBe(false);
      audio.play("input");
      expect(mocks.spawn).toHaveBeenCalledTimes(1);
    } finally {
      audio.close();
    }
  });
  it("tries the next Linux player when a player is unavailable", () => {
    const first = new NodeEvents.EventEmitter();
    const second = Object.assign(new NodeEvents.EventEmitter(), { kill: vi.fn() });
    mocks.spawn.mockReturnValueOnce(first).mockReturnValue(second);
    const audio = createNotificationAudio("linux", {});
    try {
      audio.play("input");
      first.emit("error", new Error("ENOENT"));
      first.emit("close", -2);
      expect(mocks.spawn.mock.calls.map(([command]) => command)).toEqual(["paplay", "pw-play"]);
      second.emit("close", 0);
    } finally {
      audio.close();
    }
  });
});
