import { describe, expect, it } from "@effect/vitest";
import { TurnId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AtomRegistry } from "effect/unstable/reactivity";
import { makeClientFixture } from "../../testing/clientFixture.ts";
import { permissionChoices } from "./composerModes.ts";

describe("composer modes", () => {
  it("never retries an unconfirmed message under different permissions", async () => {
    const f = makeClientFixture(async () => false);
    const registry = AtomRegistry.make();
    const actions = f.client.actions;
    const id = f.details[0]!.id;
    try {
      actions.setDraft(registry, id, "original prompt");
      expect(await actions.send(registry, id)).toBe(false);
      actions.setRuntimeMode(registry, id, "approval-required");
      expect(await actions.send(registry, id)).toBe(false);
      expect(f.commands).toHaveLength(1);
      expect(registry.get(actions.state(id)).error).toContain("original mode and permissions");
    } finally {
      registry.dispose();
    }
  });

  it.each(permissionChoices)(
    "applies $label and plan before sending, and can return to chat",
    async ({ id: runtimeMode }) => {
      const f = makeClientFixture();
      const registry = AtomRegistry.make();
      const actions = f.client.actions;
      const id = f.details[0]!.id;
      try {
        actions.setDraft(registry, id, "Plan this change");
        expect(actions.setRuntimeMode(registry, id, runtimeMode)).toBe(true);
        expect(actions.setInteractionMode(registry, id, "plan")).toBe(true);
        expect(f.commands).toEqual([]);
        expect(await actions.send(registry, id)).toBe(true);
        expect(f.commands.map((command) => command.type)).toEqual([
          ...(runtimeMode === "full-access" ? [] : ["thread.runtime-mode.set"]),
          "thread.interaction-mode.set",
          "thread.turn.start",
        ]);
        expect(f.commands.at(-1)).toMatchObject({
          runtimeMode,
          interactionMode: "plan",
          message: { text: "Plan this change" },
        });
        actions.setInteractionMode(registry, id, "default");
        actions.setDraft(registry, id, "Implement it");
        expect(await actions.send(registry, id)).toBe(true);
        expect(f.commands.at(-2)).toMatchObject({
          type: "thread.interaction-mode.set",
          interactionMode: "default",
        });
        expect(f.commands.at(-1)).toMatchObject({ interactionMode: "default", runtimeMode });
      } finally {
        registry.dispose();
      }
    },
  );

  it("keeps queued settings when the next draft uses different settings", async () => {
    const f = makeClientFixture();
    const registry = AtomRegistry.make();
    const actions = f.client.actions;
    const id = f.details[0]!.id;
    try {
      registry.update(f.states[0]!, (value) => ({
        ...value,
        data: Option.map(value.data, (thread) => ({
          ...thread,
          latestTurn: {
            turnId: TurnId.make("running"),
            state: "running" as const,
            requestedAt: "2026-01-01T00:00:00.000Z",
            startedAt: null,
            completedAt: null,
            assistantMessageId: null,
          },
        })),
      }));
      actions.setRuntimeMode(registry, id, "approval-required");
      actions.setInteractionMode(registry, id, "plan");
      actions.setDraft(registry, id, "queued plan");
      expect(await actions.send(registry, id)).toBe(true);
      expect(f.commands).toEqual([]);
      actions.setRuntimeMode(registry, id, "full-access");
      actions.setInteractionMode(registry, id, "default");
      expect(await actions.flushQueue(registry, id, true)).toBe(true);
      expect(f.commands.at(-1)).toMatchObject({
        interactionMode: "plan",
        runtimeMode: "approval-required",
      });
      expect(registry.get(actions.state(id))).toMatchObject({
        interactionMode: "default",
        runtimeMode: "full-access",
      });
    } finally {
      registry.dispose();
    }
  });

  it.each(["thread.runtime-mode.set", "thread.interaction-mode.set"])(
    "does not send when %s fails and preserves retry identity",
    async (failedType) => {
      let accept = false;
      const f = makeClientFixture(async (command) => command.type !== failedType || accept);
      const registry = AtomRegistry.make();
      const actions = f.client.actions;
      const id = f.details[0]!.id;
      try {
        actions.setRuntimeMode(registry, id, "approval-required");
        actions.setInteractionMode(registry, id, "plan");
        actions.setDraft(registry, id, "keep me");
        expect(await actions.send(registry, id)).toBe(false);
        expect(f.commands.some((command) => command.type === "thread.turn.start")).toBe(false);
        const attempt = registry.get(actions.state(id)).attempt;
        expect(registry.get(actions.state(id)).draft).toBe("keep me");
        accept = true;
        expect(await actions.send(registry, id)).toBe(true);
        expect(f.commands.at(-1)).toEqual(attempt);
      } finally {
        registry.dispose();
      }
    },
  );

  it("rejects unsupported plan mode, including when support disappears before sending", async () => {
    const f = makeClientFixture();
    const registry = AtomRegistry.make();
    const actions = f.client.actions;
    const id = f.details[0]!.id;
    try {
      actions.setInteractionMode(registry, id, "plan");
      registry.update(f.providers, (catalog) => ({
        ...catalog,
        providers: [{ ...f.provider, showInteractionModeToggle: false }],
      }));
      expect(actions.setInteractionMode(registry, id, "plan")).toBe(false);
      actions.setDraft(registry, id, "plan only");
      expect(await actions.send(registry, id)).toBe(false);
      expect(f.commands).toEqual([]);
      expect(registry.get(actions.state(id)).error).toContain("does not support");
    } finally {
      registry.dispose();
    }
  });
});
