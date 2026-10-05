import { expect, it, vi } from "vite-plus/test";
import { act } from "react";
import * as Option from "effect/Option";
import { TurnId } from "@t3tools/contracts";
import { createTuiTestDriver } from "../testing/driver.tsx";
import { makeClientFixture } from "../testing/clientFixture.ts";
import { AppShell } from "./AppShell.tsx";

const audio = vi.hoisted(() => ({ play: vi.fn(), stop: vi.fn(), close: vi.fn() }));
vi.mock("../platform/notificationAudio.ts", () => ({ createNotificationAudio: () => audio }));

it("alerts for background threads and can mute and unmute from the palette", async () => {
  const fixture = makeClientFixture();
  const driver = await createTuiTestDriver(<AppShell client={fixture.client} />);
  try {
    expect(audio.play).not.toHaveBeenCalled();
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
    await driver.input.pressKey("k", { ctrl: true });
    await driver.input.typeText("notification sounds");
    expect(driver.captureFrame()).toContain("Turn notification sounds off");
    await driver.input.pressKey("RETURN");
    audio.play.mockClear();
    await update(false, true);
    expect(audio.play).not.toHaveBeenCalled();
    await driver.input.pressKey("k", { ctrl: true });
    await driver.input.typeText("notification sounds");
    expect(driver.captureFrame()).toContain("Turn notification sounds on");
    await driver.input.pressKey("RETURN");
    expect(audio.play).not.toHaveBeenCalled();
    await update(true);
    expect(audio.play).toHaveBeenLastCalledWith("input");
  } finally {
    await driver.close();
  }
  expect(audio.close).toHaveBeenCalledOnce();
});
