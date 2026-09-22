import { afterEach, describe, expect, it } from "@effect/vitest";
import {
  EventId,
  CheckpointRef,
  MessageId,
  TurnId,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { makeClientFixture } from "../../testing/clientFixture.ts";
import { checkpointRestoreTargets } from "./checkpointRestore.ts";
import { makeThreadInteractions, type TuiThreadCommand } from "./interactions.ts";

const registries: AtomRegistry.AtomRegistry[] = [];
afterEach(() => registries.splice(0).forEach((registry) => registry.dispose()));
const time = "2026-01-01T00:00:00.000Z";
function setup(dispatch?: (command: TuiThreadCommand) => Promise<boolean>) {
  const fixture = makeClientFixture();
  const registry = AtomRegistry.make();
  registries.push(registry);
  const connection = Atom.make(registry.get(fixture.client.connection));
  const id = fixture.details[0]!.id;
  const turnId = TurnId.make("turn-one");
  const prompt = {
    id: MessageId.make("prompt"),
    role: "user" as const,
    text: "Fix the bug",
    turnId,
    streaming: false,
    createdAt: time,
    updatedAt: time,
  };
  const reply = {
    ...prompt,
    id: MessageId.make("reply"),
    role: "assistant" as const,
    text: "Fixed",
  };
  const change = (patch: Partial<OrchestrationThread>) =>
    registry.update(fixture.states[0]!, (value) => ({
      ...value,
      data: Option.map(value.data, (thread) => ({ ...thread, ...patch })),
    }));
  change({
    messages: [prompt, reply],
    checkpoints: [
      {
        turnId,
        checkpointTurnCount: 1,
        checkpointRef: CheckpointRef.make("refs/t3/checkpoint/one"),
        status: "ready",
        files: [],
        assistantMessageId: reply.id,
        completedAt: time,
      },
    ],
  });
  const commands: TuiThreadCommand[] = [];
  const dispatched = Promise.withResolvers<void>();
  const actions = makeThreadInteractions({
    thread: fixture.client.thread,
    connection,
    providers: fixture.providers,
    dispatch: async (_registry, command) => {
      commands.push(command);
      dispatched.resolve();
      return dispatch ? dispatch(command) : true;
    },
  });
  return {
    ...fixture,
    registry,
    id,
    prompt,
    reply,
    change,
    actions,
    commands,
    dispatched,
    connection,
  };
}

describe("checkpoint restore", () => {
  it.each([true, false])(
    "waits for the projected rewind and preserves an unsent draft (restore files: %s)",
    async (restoreFiles) => {
      const f = setup();
      f.actions.setDraft(f.registry, f.id, "Existing draft");
      const restored = f.actions.restoreCheckpoint(f.registry, f.id, f.prompt.id, restoreFiles);
      await f.dispatched.promise;
      expect(f.commands).toMatchObject([
        {
          type: restoreFiles ? "thread.checkpoint.revert" : "thread.conversation.revert",
          turnCount: 0,
          threadId: f.id,
        },
      ]);
      expect(f.registry.get(f.actions.state(f.id))).toMatchObject({
        pending: "rewind",
        draft: "Existing draft",
      });
      expect(await f.actions.send(f.registry, f.id)).toBe(false);
      f.change({ messages: [], checkpoints: [], latestTurn: null });
      expect(await restored).toBe(true);
      expect(f.registry.get(f.actions.state(f.id))).toMatchObject({
        pending: null,
        draft: "Existing draft\n\nFix the bug",
      });
    },
  );

  it("keeps the draft on a reactor failure and exposes the server detail", async () => {
    const f = setup();
    f.actions.setDraft(f.registry, f.id, "Unsent");
    const restored = f.actions.restoreCheckpoint(f.registry, f.id, f.prompt.id, true);
    await f.dispatched.promise;
    f.change({
      activities: [
        {
          id: EventId.make("restore-failed"),
          kind: "checkpoint.revert.failed",
          tone: "error",
          summary: "Rewind failed",
          payload: { detail: "Checkpoint missing" },
          turnId: null,
          createdAt: time,
        },
      ],
    });
    expect(await restored).toBe(false);
    expect(f.registry.get(f.actions.state(f.id))).toMatchObject({
      pending: null,
      draft: "Unsent",
      error: "Checkpoint missing",
    });
  });

  it("handles dispatch rejection without waiting for a projection", async () => {
    const f = setup(async () => false);
    expect(await f.actions.restoreCheckpoint(f.registry, f.id, f.prompt.id, false)).toBe(false);
    expect(f.registry.get(f.actions.state(f.id)).error).toContain("did not accept");
  });

  it("does not guess the checkpoint number from loaded message positions", () => {
    const f = setup();
    const thread = Option.getOrThrow(f.registry.get(f.states[0]!).data);
    const partial = {
      ...thread,
      checkpoints: thread.checkpoints.map((c) => ({ ...c, checkpointTurnCount: 9 })),
    };
    expect(checkpointRestoreTargets(partial)).toMatchObject([
      { message: { id: f.prompt.id }, turnCount: 8 },
    ]);
    expect(
      checkpointRestoreTargets({
        ...partial,
        messages: [f.prompt, { ...f.prompt, id: MessageId.make("steering") }, f.reply],
      }),
    ).toMatchObject([{ message: { id: "steering" }, turnCount: 8 }]);
    expect(checkpointRestoreTargets({ ...partial, checkpoints: [] })).toEqual([]);
  });

  it("blocks unsupported providers, active turns, disconnected and stale targets", async () => {
    const f = setup();
    f.registry.update(f.providers, (catalog) => ({
      ...catalog,
      providers: catalog.providers.map((p) => ({ ...p, supportsConversationRollback: false })),
    }));
    expect(await f.actions.restoreCheckpoint(f.registry, f.id, f.prompt.id, true)).toBe(false);
    f.registry.update(f.providers, (catalog) => ({
      ...catalog,
      providers: catalog.providers.map((p) => ({ ...p, supportsConversationRollback: true })),
    }));
    f.change({
      latestTurn: {
        turnId: TurnId.make("running"),
        state: "running",
        requestedAt: time,
        startedAt: time,
        completedAt: null,
        assistantMessageId: null,
      },
    });
    expect(await f.actions.restoreCheckpoint(f.registry, f.id, f.prompt.id, true)).toBe(false);
    f.change({ latestTurn: null });
    f.registry.update(f.connection, (state) => ({ ...state, phase: "blocked" as const }));
    expect(await f.actions.restoreCheckpoint(f.registry, f.id, f.prompt.id, true)).toBe(false);
    f.registry.update(f.connection, (state) => ({ ...state, phase: "connected" as const }));
    expect(
      await f.actions.restoreCheckpoint(f.registry, f.id, MessageId.make("missing"), true),
    ).toBe(false);
    expect(f.commands).toEqual([]);
  });

  it("prepares attachments before dispatch and restores fresh copies", async () => {
    const f = setup();
    const attachment = {
      type: "image" as const,
      id: "original",
      name: "screen.png",
      mimeType: "image/png",
      sizeBytes: 1,
    };
    f.change({ messages: [{ ...f.prompt, attachments: [attachment] }, f.reply] });
    let prepared = false;
    const actions = makeThreadInteractions({
      thread: f.client.thread,
      connection: f.client.connection,
      providers: f.providers,
      prepareRestoredAttachments: async () => {
        prepared = true;
        return [{ ...attachment, id: "fresh", dataUrl: "data:image/png;base64,AA==" }];
      },
      dispatch: async () => {
        expect(prepared).toBe(true);
        f.change({ messages: [], checkpoints: [] });
        return true;
      },
    });
    expect(await actions.restoreCheckpoint(f.registry, f.id, f.prompt.id, true)).toBe(true);
    expect(f.registry.get(actions.state(f.id)).attachments).toMatchObject([
      { id: "fresh", name: "screen.png" },
    ]);
  });

  it("leaves history untouched if attachment preparation fails", async () => {
    const f = setup();
    f.change({
      messages: [
        {
          ...f.prompt,
          attachments: [
            {
              type: "file",
              id: "original",
              name: "notes.txt",
              mimeType: "text/plain",
              sizeBytes: 1,
            },
          ],
        },
        f.reply,
      ],
    });
    const actions = makeThreadInteractions({
      thread: f.client.thread,
      connection: f.client.connection,
      providers: f.providers,
      prepareRestoredAttachments: async () => {
        throw new Error("Attachment unavailable");
      },
      dispatch: async (_registry, command) => {
        f.commands.push(command);
        return true;
      },
    });
    expect(await actions.restoreCheckpoint(f.registry, f.id, f.prompt.id, true)).toBe(false);
    expect(f.commands).toEqual([]);
    expect(f.registry.get(actions.state(f.id))).toMatchObject({
      pending: null,
      error: "Attachment unavailable",
    });
  });
});
