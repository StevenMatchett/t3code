import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { act } from "react";
import * as Option from "effect/Option";
import type { GitResolvedPullRequest } from "@t3tools/contracts";
import { makeClientFixture } from "../testing/clientFixture.ts";
import { createTuiTestDriver, type TuiTestDriver } from "../testing/driver.tsx";
import * as Browser from "../platform/browser.ts";
import { AppShell } from "./AppShell.tsx";

const drivers = new Set<TuiTestDriver>();
afterEach(async () => {
  await Promise.all([...drivers].map((driver) => driver.close()));
  drivers.clear();
  vi.restoreAllMocks();
});
async function setup() {
  vi.spyOn(Browser, "openBrowser").mockResolvedValue(true);
  const fixture = makeClientFixture();
  const driver = await createTuiTestDriver(
    <AppShell client={fixture.client} searchDebounceMs={0} />,
    { width: 110, height: 30, kittyKeyboard: true },
  );
  drivers.add(driver);
  await act(async () =>
    driver.registry.update(fixture.shell, (state) => ({
      ...state,
      snapshot: Option.map(state.snapshot, (snapshot) => ({
        ...snapshot,
        threads: snapshot.threads.map((thread) => ({
          ...thread,
          branch: "feature/pr",
          worktreePath: "/worktrees/pr",
        })),
      })),
    })),
  );
  await driver.input.pressKey("RETURN");
  await driver.input.pressKey("RETURN");
  return { driver, fixture };
}

describe("open branch pull request", () => {
  it("opens the selected worktree branch PR and keeps O as text in the composer", async () => {
    const { driver, fixture } = await setup();
    const resolve = vi.spyOn(fixture.client, "resolvePullRequest");
    await driver.input.pressKey("o");
    expect(resolve).toHaveBeenCalledWith(driver.registry, {
      cwd: "/worktrees/pr",
      branch: "feature/pr",
    });
    expect(Browser.openBrowser).toHaveBeenCalledExactlyOnceWith(
      "https://github.com/example/repo/pull/42",
    );
    expect(driver.captureFrame()).toContain("Opened in your browser.");
    await driver.input.pressKey("ESCAPE");
    await driver.input.pressKey("i");
    await driver.input.typeText("open this");
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(driver.registry.get(fixture.client.actions.state(fixture.details[0]!.id)).draft).toBe(
      "open this",
    );
  });
  it("offers the action through the command palette and shows a link for SSH", async () => {
    const { driver } = await setup();
    vi.mocked(Browser.openBrowser).mockResolvedValue(false);
    await driver.input.pressKey("k", { ctrl: true });
    await driver.input.typeText("Open pull request");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("local browser");
    expect(driver.captureFrame()).toContain("https://github.com/example/repo/pull/42");
    const copy = vi.spyOn(driver.renderer, "copyToClipboardOSC52").mockReturnValue(true);
    await driver.input.pressKey("c");
    expect(copy).toHaveBeenCalledWith("https://github.com/example/repo/pull/42");
    expect(driver.captureFrame()).toContain("PR URL copied.");
  });
  it("shows lookup failures and allows retry", async () => {
    const { driver, fixture } = await setup();
    vi.spyOn(fixture.client, "resolvePullRequest").mockRejectedValueOnce(
      new Error("No PR for feature/pr."),
    );
    await driver.input.pressKey("o");
    expect(driver.captureFrame()).toContain("No PR for feature/pr.");
    expect(Browser.openBrowser).not.toHaveBeenCalled();
    await driver.input.pressKey("r");
    expect(driver.captureFrame()).toContain("Opened in your browser.");
  });
  it("retains the link when launching the browser fails", async () => {
    const { driver } = await setup();
    vi.mocked(Browser.openBrowser).mockRejectedValue(new Error("Browser unavailable."));
    await driver.input.pressKey("o");
    expect(driver.captureFrame()).toContain("Browser unavailable.");
    expect(driver.captureFrame()).toContain("https://github.com/example/repo/pull/42");
  });
  it("does not launch after the user closes a pending lookup", async () => {
    const { driver, fixture } = await setup();
    const pending = Promise.withResolvers<GitResolvedPullRequest>();
    const pr = await fixture.client.resolvePullRequest(driver.registry, {
      cwd: "/worktrees/pr",
      branch: "feature/pr",
    });
    vi.spyOn(fixture.client, "resolvePullRequest").mockReturnValue(pending.promise);
    await driver.input.pressKey("o");
    expect(driver.captureFrame()).toContain("Finding pull request...");
    await driver.input.pressKey("ESCAPE");
    await act(async () => pending.resolve(pr));
    await driver.flush();
    expect(Browser.openBrowser).not.toHaveBeenCalled();
  });
});
