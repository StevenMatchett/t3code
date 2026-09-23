import { afterEach, describe, expect, it } from "@effect/vitest";
import { MouseButtons } from "@opentui/core/testing";
import * as Option from "effect/Option";
import { act } from "react";
import { makeClientFixture } from "../testing/clientFixture.ts";
import { createTuiTestDriver, type TuiTestDriver } from "../testing/driver.tsx";
import { AppShell } from "./AppShell.tsx";

const drivers = new Set<TuiTestDriver>();
afterEach(async () => {
  await Promise.all([...drivers].map((driver) => driver.close()));
  drivers.clear();
});
async function setup(kittyKeyboard: boolean) {
  const fixture = makeClientFixture();
  const driver = await createTuiTestDriver(<AppShell client={fixture.client} />, {
    width: 100,
    height: 28,
    kittyKeyboard,
  });
  drivers.add(driver);
  await driver.input.pressKey("RETURN");
  await driver.input.pressKey("RETURN");
  await driver.input.pressKey("i");
  return { fixture, driver, id: fixture.details[0]!.id };
}
async function clickControl(driver: TuiTestDriver, id: string) {
  const control = driver.renderer.root.findDescendantById(id);
  expect(control).toBeDefined();
  await driver.mouse.click(control!.screenX + 2, control!.screenY, MouseButtons.LEFT, {
    delayMs: 0,
  });
}
async function clickLabel(driver: TuiTestDriver, label: string) {
  const lines = driver.captureFrame().split("\n");
  const row = lines.findIndex((line) => line.includes(label));
  expect(row).toBeGreaterThanOrEqual(0);
  await driver.mouse.click(lines[row]!.indexOf(label) + 1, row, MouseButtons.LEFT, { delayMs: 0 });
}

describe("composer dropdowns and slash skills", () => {
  it("selects plan and permissions with the mouse while preserving the draft", async () => {
    const { driver, fixture, id } = await setup(true);
    await driver.input.typeText("review the design");
    await clickControl(driver, "composer-mode");
    await clickLabel(driver, "Plan");
    await clickControl(driver, "composer-permissions");
    await clickLabel(driver, "Supervised");
    expect(driver.registry.get(fixture.client.actions.state(id))).toMatchObject({
      draft: "review the design",
      interactionMode: "plan",
      runtimeMode: "approval-required",
    });
    expect(fixture.commands).toHaveLength(0);
    expect(driver.captureFrame()).toContain("Plan ▼");
    expect(driver.captureFrame()).toContain("Supervised ▼");
    await driver.input.pressKey("RETURN");
    expect(fixture.commands.at(-1)).toMatchObject({
      type: "thread.turn.start",
      runtimeMode: "approval-required",
      interactionMode: "plan",
      message: { text: "review the design" },
    });
  });
  it("offers keyboard access to mode and permission selectors", async () => {
    const { driver, fixture, id } = await setup(true);
    await driver.input.pressKey("TAB");
    await driver.input.pressKey("TAB");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("Mode — next message");
    await driver.input.pressKey("ARROW_DOWN");
    await driver.input.pressKey("RETURN");
    expect(driver.registry.get(fixture.client.actions.state(id)).interactionMode).toBe("plan");
    for (let i = 0; i < 3; i++) await driver.input.pressKey("TAB");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("Permissions — next message");
    await driver.input.pressKey("RETURN");
    expect(driver.registry.get(fixture.client.actions.state(id)).runtimeMode).toBe(
      "approval-required",
    );
  });
  it("shows repository skills before global skills in the workspace menu", async () => {
    const { driver, fixture } = await setup(true);
    const skill = fixture.provider.skills[0]!;
    await act(async () =>
      driver.registry.update(fixture.providers, (catalog) => ({
        ...catalog,
        providers: [
          {
            ...fixture.provider,
            workspaceSnapshots: [
              {
                cwd: "/workspace/alpha",
                checkedAt: fixture.provider.checkedAt,
                slashCommands: [],
                skills: [
                  {
                    ...skill,
                    name: "global-first",
                    displayName: "Global first",
                    scope: "user",
                    path: "/home/user/.codex/skills/global/SKILL.md",
                  },
                  {
                    ...skill,
                    name: "repo-second",
                    displayName: "Repo second",
                    scope: "repo",
                    path: "/workspace/alpha/.agents/skills/repo/SKILL.md",
                  },
                  {
                    ...skill,
                    name: "unscoped-local",
                    displayName: "Unscoped local",
                    scope: undefined,
                    path: "/workspace/alpha/.agents/skills/local/SKILL.md",
                  },
                ],
              },
            ],
          },
        ],
      })),
    );
    await driver.input.typeText("/");
    const frame = driver.captureFrame();
    expect(frame.indexOf("Repo second")).toBeGreaterThanOrEqual(0);
    expect(frame.indexOf("Repo second")).toBeLessThan(frame.indexOf("Unscoped local"));
    expect(frame.indexOf("Unscoped local")).toBeLessThan(frame.indexOf("Global first"));
  });
  it("selects the model and reasoning from visible clickable dropdowns without losing the prompt", async () => {
    const { driver, fixture, id } = await setup(true);
    await driver.input.typeText("analyze this change");
    await clickControl(driver, "composer-models");
    expect(driver.captureFrame()).toContain("Alternate model");
    await clickLabel(driver, "Alternate model");
    expect(driver.captureFrame()).toContain("Reasoning: Quick");
    await clickControl(driver, "composer-option:budget-tier");
    await clickLabel(driver, "Deep");
    expect(Option.getOrThrow(driver.registry.get(fixture.states[0]!).data).modelSelection).toEqual({
      instanceId: fixture.provider.instanceId,
      model: "opaque/model-b",
      options: [{ id: "budget-tier", value: "deep:v2" }],
    });
    expect(driver.registry.get(fixture.client.actions.state(id)).draft).toBe("analyze this change");
    expect(fixture.commands).toHaveLength(2);
    await driver.input.pressKey("RETURN");
    expect(fixture.commands[2]).toMatchObject({
      type: "thread.turn.start",
      modelSelection: { model: "opaque/model-b" },
      message: { text: "analyze this change" },
    });
  });

  it.each([false, true])(
    "uses Tab and Enter for dropdowns without function keys (kitty=%s)",
    async (kitty) => {
      const { driver, fixture } = await setup(kitty);
      await driver.input.typeText("draft");
      await driver.input.pressKey("TAB");
      await driver.input.pressKey("RETURN");
      await driver.input.typeText("alternate");
      await driver.input.pressKey("RETURN");
      expect(fixture.commands[0]).toMatchObject({
        type: "thread.meta.update",
        modelSelection: { model: "opaque/model-b" },
      });
      await driver.input.pressKey("TAB");
      await driver.input.pressKey("TAB");
      await driver.input.pressKey("RETURN");
      await driver.input.pressKey("ARROW_DOWN");
      await driver.input.pressKey("ARROW_DOWN");
      await driver.input.pressKey("RETURN");
      expect(fixture.commands[1]).toMatchObject({
        modelSelection: { options: [{ id: "budget-tier", value: "deep:v2" }] },
      });
    },
  );

  it.each([false, true])(
    "opens all skills on slash, filters as you type, and selects without submitting (kitty=%s)",
    async (kitty) => {
      const { driver, fixture, id } = await setup(kitty);
      await act(async () =>
        driver.registry.set(fixture.providers, {
          status: "live",
          providers: [
            {
              ...fixture.provider,
              skills: [
                ...fixture.provider.skills,
                {
                  ...fixture.provider.skills[0]!,
                  name: "testing",
                  path: "/skills/testing",
                  displayName: "Run tests",
                  description: "Run the test suite",
                },
              ],
            },
          ],
        }),
      );
      await driver.input.typeText("/");
      expect(driver.captureFrame()).toContain("Review changes");
      expect(driver.captureFrame()).toContain("Run tests");
      await driver.input.typeText("rev");
      expect(driver.captureFrame()).toContain("Review changes");
      expect(driver.captureFrame()).not.toContain("Run tests");
      await driver.input.pressKey("RETURN");
      expect(fixture.commands).toHaveLength(0);
      expect(driver.registry.get(fixture.client.actions.state(id)).draft).toBe("$review:changes ");
      await driver.input.typeText("check this change");
      await driver.input.pressKey("RETURN");
      expect(fixture.commands[0]).toMatchObject({
        type: "thread.turn.start",
        message: { text: "$review:changes check this change" },
      });
    },
  );

  it("opens slash skills in the composer and allows choosing a result by mouse", async () => {
    const { driver, fixture, id } = await setup(true);
    await driver.input.pressKey("ESCAPE");
    await driver.input.pressKey("i");
    await driver.input.pressKey("/");
    expect(driver.captureFrame()).toContain("Review changes");
    await clickLabel(driver, "Review changes");
    expect(driver.registry.get(fixture.client.actions.state(id)).draft).toBe("$review:changes ");
    expect(fixture.commands).toHaveLength(0);
  });

  it("keeps newline and pasted slash text from submitting a prompt", async () => {
    const { driver, fixture, id } = await setup(true);
    await driver.input.paste("/rev");
    expect(driver.captureFrame()).toContain("Review changes");
    expect(fixture.commands).toHaveLength(0);
    await driver.input.pressKey("j", { ctrl: true });
    expect(driver.registry.get(fixture.client.actions.state(id)).draft).toBe("/rev\n");
    expect(driver.captureFrame()).not.toContain("Review changes");
    expect(fixture.commands).toHaveLength(0);
  });

  it("dismisses an unmatched slash menu without sending or discarding text", async () => {
    const { driver, fixture, id } = await setup(true);
    await driver.input.typeText("/missing");
    expect(driver.captureFrame()).toContain("No matches");
    await driver.input.pressKey("RETURN");
    expect(fixture.commands).toHaveLength(0);
    await driver.input.pressKey("ESCAPE");
    expect(driver.registry.get(fixture.client.actions.state(id)).draft).toBe("/missing");
    expect(driver.captureFrame()).not.toContain("No matches");
    await driver.input.pressKey("RETURN");
    expect(fixture.commands[0]).toMatchObject({ message: { text: "/missing" } });
  });

  it("replaces a token at the caret while preserving Unicode, tabs, and trailing text", async () => {
    const { driver, fixture, id } = await setup(true);
    await driver.input.paste("界e\u0301\u{1D518}\t /rev suffix");
    expect(fixture.commands).toHaveLength(0);
    for (let index = 0; index < 7; index += 1) await driver.input.pressKey("ARROW_LEFT");
    expect(driver.captureFrame()).toContain("Review changes");
    await driver.input.pressKey("RETURN");
    await driver.input.typeText("new ");
    expect(driver.registry.get(fixture.client.actions.state(id)).draft).toBe(
      "$review:changes 界e\u0301\u{1D518}\t new suffix",
    );
    expect(fixture.commands).toHaveLength(0);
  });

  it("keeps paths out of slash search and preserves the draft across resize", async () => {
    const { driver, fixture, id } = await setup(true);
    await driver.input.paste("Read https://host/path and /tmp/file");
    expect(driver.captureFrame()).not.toContain("Review changes");
    await clickControl(driver, "composer-models");
    await driver.resize(46, 20);
    expect(driver.captureFrame()).toContain("Current model");
    await driver.input.pressKey("ESCAPE");
    expect(driver.registry.get(fixture.client.actions.state(id)).draft).toBe(
      "Read https://host/path and /tmp/file",
    );
    expect(fixture.commands).toHaveLength(0);
  });
});
