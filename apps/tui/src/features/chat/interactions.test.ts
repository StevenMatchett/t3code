import { describe, expect, it } from "@effect/vitest";
import {
  ApprovalRequestId,
  EventId,
  TurnId,
  type UploadChatImageAttachment,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AtomRegistry } from "effect/unstable/reactivity";
import { makeClientFixture } from "../../testing/clientFixture.ts";
import {
  answersAreComplete,
  makeThreadInteractions,
  type TuiThreadCommand,
} from "./interactions.ts";

function fixture(
  dispatch: (command: TuiThreadCommand) => Promise<boolean>,
  loadImageAttachment?: (path: string) => Promise<UploadChatImageAttachment>,
) {
  const data = makeClientFixture();
  const registry = AtomRegistry.make();
  const actions = makeThreadInteractions({
    thread: data.client.thread,
    connection: data.client.connection,
    dispatch: (_registry, command) => dispatch(command),
    ...(loadImageAttachment ? { loadImageAttachment } : {}),
  });
  const id = data.details[0]!.id;
  return { ...data, registry, actions, id };
}

describe("thread interactions", () => {
  it("submits the selected thread's exact model and modes and retains edits made while waiting", async () => {
    const receipt = Promise.withResolvers<boolean>();
    const commands: TuiThreadCommand[] = [];
    const f = fixture(async (command) => {
      commands.push(command);
      return receipt.promise;
    });
    try {
      f.actions.setDraft(f.registry, f.id, "  inspect this\nthen explain  ");
      const submitted = f.actions.send(f.registry, f.id);
      expect(await f.actions.send(f.registry, f.id)).toBe(false);
      expect(commands).toHaveLength(1);
      expect(commands[0]).toMatchObject({
        type: "thread.turn.start",
        threadId: f.id,
        modelSelection: f.details[0]!.modelSelection,
        runtimeMode: f.details[0]!.runtimeMode,
        interactionMode: f.details[0]!.interactionMode,
        message: { text: "  inspect this\nthen explain  ", attachments: [] },
      });
      f.actions.setDraft(f.registry, f.id, "next draft");
      receipt.resolve(true);
      expect(await submitted).toBe(true);
      expect(f.registry.get(f.actions.state(f.id)).draft).toBe("next draft");
      expect(f.registry.get(f.actions.state(f.id)).pending).toBeNull();
    } finally {
      f.registry.dispose();
    }
  });

  it("preserves failed input and retries the same immutable command instead of duplicating a turn", async () => {
    const commands: TuiThreadCommand[] = [];
    const f = fixture(async (command) => {
      commands.push(command);
      return commands.length > 1;
    });
    try {
      f.actions.setDraft(f.registry, f.id, "retry me");
      expect(await f.actions.send(f.registry, f.id)).toBe(false);
      expect(f.registry.get(f.actions.state(f.id)).draft).toBe("retry me");
      expect(await f.actions.send(f.registry, f.id)).toBe(true);
      expect(commands[1]).toEqual(commands[0]);
      expect(f.registry.get(f.actions.state(f.id)).draft).toBe("");
    } finally {
      f.registry.dispose();
    }
  });

  it("sends attachment-only prompts and keeps images available for a failed retry", async () => {
    const commands: TuiThreadCommand[] = [];
    const image = {
      type: "image" as const,
      id: "fixture-image",
      name: "photo.png",
      mimeType: "image/png",
      sizeBytes: 4,
      dataUrl: "data:image/png;base64,iVBORw==",
    };
    const f = fixture(
      async (command) => {
        commands.push(command);
        return commands.length > 1;
      },
      async () => image,
    );
    try {
      expect(await f.actions.attachImages(f.registry, f.id, ["/tmp/photo.png"])).toBe(true);
      expect(f.registry.get(f.actions.state(f.id)).attachments).toEqual([image]);
      expect(await f.actions.send(f.registry, f.id)).toBe(false);
      expect(commands[0]).toMatchObject({
        type: "thread.turn.start",
        message: { text: "", attachments: [image] },
      });
      expect(f.registry.get(f.actions.state(f.id)).attachments).toEqual([image]);
      expect(await f.actions.send(f.registry, f.id)).toBe(true);
      expect(commands[1]).toEqual(commands[0]);
      expect(f.registry.get(f.actions.state(f.id)).attachments).toEqual([]);
    } finally {
      f.registry.dispose();
    }
  });

  it("folds pastes over 200 characters in the draft and expands them when sending", async () => {
    const commands: TuiThreadCommand[] = [];
    const f = fixture(async (command) => {
      commands.push(command);
      return true;
    });
    const paste = "p".repeat(201);
    try {
      expect(f.actions.addPaste(f.registry, f.id, "p".repeat(200))).toBe(false);
      expect(f.actions.addPaste(f.registry, f.id, paste)).toBe(true);
      expect(f.registry.get(f.actions.state(f.id)).draft).toBe("[paste 201 characters]");
      expect(await f.actions.send(f.registry, f.id)).toBe(true);
      expect(commands[0]).toMatchObject({
        type: "thread.turn.start",
        message: { text: paste },
      });
      expect(f.registry.get(f.actions.state(f.id)).draft).toBe("");
      expect(f.registry.get(f.actions.state(f.id)).pastes).toEqual([]);
    } finally {
      f.registry.dispose();
    }
  });

  it("accepts the authoritative message after a lost reply without submitting it again", async () => {
    const f = fixture(async () => false);
    try {
      f.actions.setDraft(f.registry, f.id, "known accepted");
      await f.actions.send(f.registry, f.id);
      const attempt = f.registry.get(f.actions.state(f.id)).attempt!;
      const thread = f.details[0]!;
      f.registry.set(f.states[0]!, {
        ...f.registry.get(f.states[0]!),
        data: Option.some({
          ...thread,
          messages: [
            ...thread.messages,
            {
              id: attempt.message.messageId,
              role: "user" as const,
              text: attempt.message.text,
              turnId: null,
              streaming: false,
              createdAt: attempt.createdAt,
              updatedAt: attempt.createdAt,
            },
          ],
        }),
      });
      f.actions.observe(f.registry, f.id);
      expect(f.registry.get(f.actions.state(f.id))).toMatchObject({
        draft: "",
        attempt: null,
        error: null,
      });
    } finally {
      f.registry.dispose();
    }
  });

  it("keeps drafts when data is stale and targets Stop at the currently running turn", async () => {
    const commands: TuiThreadCommand[] = [];
    const f = fixture(async (command) => {
      commands.push(command);
      return true;
    });
    try {
      f.actions.setDraft(f.registry, f.id, "keep me");
      f.registry.set(f.states[0]!, { ...f.registry.get(f.states[0]!), status: "cached" });
      expect(await f.actions.send(f.registry, f.id)).toBe(false);
      expect(commands).toHaveLength(0);
      const latestTurn = {
        turnId: TurnId.make("running-turn"),
        state: "running" as const,
        requestedAt: f.details[0]!.createdAt,
        startedAt: null,
        completedAt: null,
        assistantMessageId: null,
      };
      f.registry.set(f.states[0]!, {
        ...f.registry.get(f.states[0]!),
        status: "live",
        data: Option.some({ ...f.details[0]!, latestTurn }),
      });
      expect(await f.actions.send(f.registry, f.id)).toBe(false);
      expect(await f.actions.interrupt(f.registry, f.id)).toBe(true);
      expect(commands[0]).toMatchObject({
        type: "thread.turn.interrupt",
        turnId: latestTurn.turnId,
        threadId: f.id,
      });
      expect(f.registry.get(f.actions.state(f.id)).draft).toBe("keep me");
    } finally {
      f.registry.dispose();
    }
  });

  it("honors provider approval options, prevents repeated replies, and rejects resolved requests", async () => {
    const commands: TuiThreadCommand[] = [];
    const f = fixture(async (command) => {
      commands.push(command);
      return true;
    });
    const requestId = ApprovalRequestId.make("native-request");
    const activity = {
      id: EventId.make("approval-event"),
      kind: "approval.requested",
      tone: "approval" as const,
      summary: "Approve read",
      turnId: null,
      createdAt: f.details[0]!.createdAt,
      payload: {
        requestId,
        requestKind: "file-read",
        options: [
          { decision: "accept", label: "Allow once" },
          { decision: "decline", label: "No" },
        ],
      },
    };
    try {
      f.registry.set(f.states[0]!, {
        ...f.registry.get(f.states[0]!),
        data: Option.some({ ...f.details[0]!, activities: [activity] }),
      });
      expect(
        await f.actions.reply(f.registry, f.id, {
          kind: "approval",
          requestId,
          decision: "acceptAlways",
        }),
      ).toBe(false);
      expect(
        await f.actions.reply(f.registry, f.id, {
          kind: "approval",
          requestId,
          decision: "accept",
        }),
      ).toBe(true);
      expect(
        await f.actions.reply(f.registry, f.id, {
          kind: "approval",
          requestId,
          decision: "accept",
        }),
      ).toBe(false);
      expect(commands).toHaveLength(1);
      f.registry.set(f.states[0]!, {
        ...f.registry.get(f.states[0]!),
        data: Option.some(f.details[0]!),
      });
      expect(
        await f.actions.reply(f.registry, f.id, {
          kind: "approval",
          requestId,
          decision: "accept",
        }),
      ).toBe(false);
    } finally {
      f.registry.dispose();
    }
  });

  it("preserves opaque question option values rather than submitting display labels", () => {
    const request = {
      requestId: ApprovalRequestId.make("input"),
      createdAt: "2026-01-01T00:00:00Z",
      dismissible: false,
      questions: [
        {
          id: " native id ",
          header: "Pick",
          question: "Pick one",
          multiSelect: true,
          allowCustomAnswer: false,
          options: [{ label: "Pretty label", value: " opaque value ", description: "" }],
        },
      ],
    };
    expect(answersAreComplete(request, { " native id ": [" opaque value "] })).toBe(true);
    expect(answersAreComplete(request, { " native id ": ["Pretty label"] })).toBe(false);
    expect(answersAreComplete(request, { " native id ": "custom" })).toBe(false);
  });
});
