import { beforeEach, expect, it, vi } from "vite-plus/test";
import { act } from "react";
import * as Option from "effect/Option";
import { TurnId } from "@t3tools/contracts";
import { createTuiTestDriver } from "../testing/driver.tsx";
import { makeClientFixture } from "../testing/clientFixture.ts";
import { AppShell } from "./AppShell.tsx";

const audio = vi.hoisted(() => ({ play: vi.fn(), stop: vi.fn(), close: vi.fn() }));
vi.mock("../platform/notificationAudio.ts", () => ({ createNotificationAudio: () => audio }));

beforeEach(() => vi.clearAllMocks());

it.each([
  { method: "palette", kittyKeyboard: false },
  { method: "palette", kittyKeyboard: true },
  { method: "hotkey", kittyKeyboard: false },
  { method: "hotkey", kittyKeyboard: true },
])(
  "mutes and unmutes background alerts with $method (kitty=$kittyKeyboard)",
  async ({ method, kittyKeyboard }) => {
    const fixture = makeClientFixture();
    const driver = await createTuiTestDriver(<AppShell client={fixture.client} />, {
      kittyKeyboard,
    });
    try {
      expect(audio.play).not.toHaveBeenCalled();
      expect(driver.captureFrame().split("\n").slice(-3).join("\n")).toMatch(/Ctrl\+G\s+Sounds on/);
      const update = async (input: boolean, completed = false) => {
        const shell = driver.registry.get(fixture.client.shell);
        const snapshot = Option.getOrThrow(shell.snapshot);
        await act(async () => {
          driver.registry.set(fixture.shell, {
            ...shell,
            snapshot: Option.some({
              ...snapshot,
              threads: snapshot.threads.map((thread, index) =>
                index !== 1
                  ? thread
                  : {
                      ...thread,
                      hasPendingUserInput: input,
                      latestTurn: completed
                        ? {
                            turnId: TurnId.make("new-completion"),
                            state: "completed" as const,
                            requestedAt: "2026-10-05T12:00:00Z",
                            startedAt: "2026-10-05T12:00:00Z",
                            completedAt: "2026-10-05T12:01:00Z",
                            assistantMessageId: null,
                          }
                        : thread.latestTurn,
                    },
              ),
            }),
          });
        });
        await driver.flush();
      };
      await update(true);
      expect(audio.play).toHaveBeenLastCalledWith("input");
      if (method === "hotkey") {
        await driver.input.pressKey("g", { ctrl: true });
      } else {
        await driver.input.pressKey("k", { ctrl: true });
        await driver.input.typeText("notification sounds");
        expect(driver.captureFrame()).toContain("Turn notification sounds off");
        await driver.input.pressKey("RETURN");
      }
      expect(driver.captureFrame().split("\n").slice(-3).join("\n")).toMatch(
        /Ctrl\+G\s+Sounds off/,
      );
      audio.play.mockClear();
      await update(false, true);
      expect(audio.play).not.toHaveBeenCalled();
      await driver.input.pressKey("k", { ctrl: true });
      await driver.input.typeText("notification sounds");
      expect(driver.captureFrame()).toContain("Turn notification sounds on");
      await driver.input.pressKey("RETURN");
      expect(driver.captureFrame()).toContain("Sounds on");
      expect(audio.play).not.toHaveBeenCalled();
      await update(true);
      expect(audio.play).toHaveBeenLastCalledWith("input");
    } finally {
      await driver.close();
    }
    expect(audio.close).toHaveBeenCalledOnce();
  },
);

it("toggles from the composer without changing its draft and passes through to the embedded shell", async () => {
  const fixture = makeClientFixture();
  const driver = await createTuiTestDriver(<AppShell client={fixture.client} />, {
    width: 100,
    height: 28,
  });
  try {
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("i");
    await driver.input.typeText("keep this draft");
    await driver.input.pressKey("g", { ctrl: true });
    expect(driver.captureFrame()).toContain("Sounds off");
    expect(driver.registry.get(fixture.client.actions.state(fixture.threads[0]!.id)).draft).toBe(
      "keep this draft",
    );
    await driver.input.pressKey("t", { ctrl: true });
    await driver.input.pressKey("g", { ctrl: true });
    expect(driver.captureFrame()).not.toContain("Ctrl+G");
    expect(fixture.terminalWrites).toContain("\x07");
    await driver.input.pressKey("\\", { ctrl: true });
    await driver.input.pressKey("g", { ctrl: true });
    expect(driver.captureFrame()).toContain("Sounds on");
  } finally {
    await driver.close();
  }
});
