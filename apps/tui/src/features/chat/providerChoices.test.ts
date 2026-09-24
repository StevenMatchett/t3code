import { describe, it, expect } from "@effect/vitest";
import { ProviderDriverKind, TurnId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/unstable/reactivity";
import * as Option from "effect/Option";
import { makeClientFixture } from "../../testing/clientFixture.ts";
import {
  modelChangeProblem,
  selectionForModel,
  skillPrefix,
  selectableSkills,
} from "./providerChoices.ts";

describe("provider choices", () => {
  it("preserves native model and option IDs in shared state and subsequent prompts", async () => {
    const f = makeClientFixture();
    const registry = AtomRegistry.make();
    const id = f.details[0]!.id;
    try {
      f.client.actions.setDraft(registry, id, "keep my draft");
      const selection = {
        instanceId: f.provider.instanceId,
        model: "opaque/model-b",
        options: [{ id: "budget-tier", value: "deep:v2" }],
      };
      expect(await f.client.actions.changeModel(registry, id, selection)).toBe(true);
      expect(Option.getOrThrow(registry.get(f.states[0]!).data).modelSelection).toEqual(selection);
      expect(registry.get(f.client.actions.state(id)).draft).toBe("keep my draft");
      expect(await f.client.actions.send(registry, id)).toBe(true);
      expect(f.commands.at(-1)).toMatchObject({
        type: "thread.turn.start",
        modelSelection: selection,
        message: { text: "keep my draft" },
      });
    } finally {
      registry.dispose();
    }
  });
  it("refuses stale options and providers that require a fresh thread", async () => {
    const f = makeClientFixture();
    const registry = AtomRegistry.make();
    const id = f.details[0]!.id;
    try {
      expect(
        await f.client.actions.changeModel(registry, id, {
          instanceId: f.provider.instanceId,
          model: "opaque/model-b",
          options: [{ id: "budget-tier", value: "made-up" }],
        }),
      ).toBe(false);
      const thread = {
        ...f.details[0]!,
        latestTurn: {
          turnId: TurnId.make("active"),
          state: "running" as const,
          requestedAt: f.details[0]!.createdAt,
          startedAt: null,
          completedAt: null,
          assistantMessageId: null,
        },
      };
      registry.update(f.states[0]!, (value) => ({ ...value, data: Option.some(thread) }));
      expect(
        modelChangeProblem(
          { ...thread, latestTurn: { ...thread.latestTurn, state: "completed" } },
          { ...f.provider, requiresNewThreadForModelChange: true },
          { instanceId: f.provider.instanceId, model: "opaque/model-b" },
        ),
      ).toContain("new thread");
      expect(f.commands).toHaveLength(0);
    } finally {
      registry.dispose();
    }
  });
  it("changes the selected model during a turn and uses it on the next turn", async () => {
    const f = makeClientFixture();
    const registry = AtomRegistry.make();
    const id = f.details[0]!.id;
    const original = f.details[0]!.modelSelection;
    const selection = { instanceId: f.provider.instanceId, model: "opaque/model-b" };
    try {
      const running = {
        ...f.details[0]!,
        latestTurn: {
          turnId: TurnId.make("active"),
          state: "running" as const,
          requestedAt: f.details[0]!.createdAt,
          startedAt: null,
          completedAt: null,
          assistantMessageId: null,
        },
      };
      registry.update(f.states[0]!, (value) => ({ ...value, data: Option.some(running) }));
      f.client.actions.setDraft(registry, id, "queued follow-up");
      expect(await f.client.actions.send(registry, id)).toBe(true);
      expect(registry.get(f.client.actions.state(id)).queue[0]?.command.modelSelection).toEqual(
        original,
      );
      expect(await f.client.actions.changeModel(registry, id, selection)).toBe(true);
      expect(f.commands[0]).toMatchObject({
        type: "thread.meta.update",
        modelSelection: selection,
      });
      expect(registry.get(f.client.actions.state(id)).notice).toBe(
        "Model selected for the next turn.",
      );
      expect(registry.get(f.client.actions.state(id)).error).toBeNull();
      expect(running.modelSelection).toEqual(original);
      expect(Option.getOrThrow(registry.get(f.states[0]!).data).modelSelection).toEqual(selection);
      expect(registry.get(f.client.actions.state(id)).queue[0]?.command.modelSelection).toEqual(
        selection,
      );

      registry.update(f.states[0]!, (value) => ({
        ...value,
        data: Option.map(value.data, (thread) => ({
          ...thread,
          latestTurn: { ...running.latestTurn, state: "completed" as const },
        })),
      }));
      expect(await f.client.actions.flushQueue(registry, id)).toBe(true);
      expect(f.commands.at(-1)).toMatchObject({
        type: "thread.turn.start",
        modelSelection: selection,
        message: { text: "queued follow-up" },
      });
    } finally {
      registry.dispose();
    }
  });

  it("preserves compatible options without inventing values when switching models", () => {
    const f = makeClientFixture();
    expect(
      selectionForModel(f.provider, "opaque/model-b", {
        ...f.details[0]!.modelSelection,
        options: [
          { id: "budget-tier", value: "deep:v2" },
          { id: "unsupported", value: true },
        ],
      }),
    ).toEqual({
      instanceId: f.provider.instanceId,
      model: "opaque/model-b",
      options: [{ id: "budget-tier", value: "deep:v2" }],
    });
  });
  it("inserts a skill without sending, preserves the draft, and blocks it if disabled later", async () => {
    const f = makeClientFixture();
    const registry = AtomRegistry.make();
    const id = f.details[0]!.id;
    const skill = f.provider.skills[0]!;
    try {
      f.client.actions.setDraft(registry, id, "check authentication");
      expect(f.client.actions.selectSkill(registry, id, skill)).toBe(true);
      expect(registry.get(f.client.actions.state(id)).draft).toBe(
        "$review:changes check authentication",
      );
      expect(f.commands).toHaveLength(0);
      registry.set(f.providers, {
        status: "live",
        providers: [{ ...f.provider, skills: [{ ...skill, enabled: false }] }],
      });
      expect(await f.client.actions.send(registry, id)).toBe(false);
      f.client.actions.setDraft(registry, id, "ordinary prompt");
      expect(registry.get(f.client.actions.state(id)).skill).toBeNull();
      expect(await f.client.actions.send(registry, id)).toBe(true);
    } finally {
      registry.dispose();
    }
  });
  it("uses workspace overrides and omits disabled and agent-only skills", () => {
    const f = makeClientFixture();
    const skill = f.provider.skills[0]!;
    const provider = {
      ...f.provider,
      workspaceSnapshots: [
        {
          cwd: "/actual/worktree",
          checkedAt: f.provider.checkedAt,
          slashCommands: [],
          skills: [
            { ...skill, name: "local" },
            { ...skill, name: "off", enabled: false },
            { ...skill, name: "agent-only", userInvocable: false },
          ],
        },
      ],
    };
    expect(selectableSkills(provider, "/actual/worktree").map((item) => item.name)).toEqual([
      "local",
    ]);
    expect(
      skillPrefix({ ...provider, driver: ProviderDriverKind.make("claudeAgent") }, skill),
    ).toBe("/review:changes ");
    expect(skillPrefix({ ...provider, driver: ProviderDriverKind.make("cursor") }, skill)).toBe(
      "/review:changes ",
    );
  });
  it("puts unscoped workspace skills first and prefers them over global duplicates", () => {
    const f = makeClientFixture();
    const skill = { ...f.provider.skills[0]!, scope: undefined };
    const provider = {
      ...f.provider,
      skills: [
        { ...skill, name: "shared", path: "/home/user/.codex/skills/shared/SKILL.md" },
        { ...skill, name: "global", path: "/home/user/.codex/skills/global/SKILL.md" },
        { ...skill, name: "sibling", path: "/repo-other/.agents/skills/sibling/SKILL.md" },
        { ...skill, name: "shared", path: "/repo/.agents/skills/shared/SKILL.md" },
        { ...skill, name: "local", path: "/repo/.claude/skills/local/SKILL.md" },
      ],
    };
    const result = selectableSkills(provider, "/repo/");
    expect(result.map((item) => item.name)).toEqual(["shared", "local", "global", "sibling"]);
    expect(result[0]!.path).toBe("/repo/.agents/skills/shared/SKILL.md");
  });
});
