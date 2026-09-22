// @effect-diagnostics nodeBuiltinImport:off
import { afterEach, describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, ThreadId, TurnId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/unstable/reactivity";
import * as Option from "effect/Option";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import * as NodeSqlite from "node:sqlite";
import { openTuiSessionState } from "./sessionStore.ts";
import { makeClientFixture } from "../testing/clientFixture.ts";

const cleanups: (() => void)[] = [];
afterEach(() =>
  cleanups
    .splice(0)
    .toReversed()
    .forEach((cleanup) => cleanup()),
);
function directory() {
  const path = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "tui-session-"));
  cleanups.push(() => NodeFS.rmSync(path, { recursive: true, force: true }));
  return path;
}
function open(
  stateDirectory: string,
  environmentId = EnvironmentId.make("test-env"),
  httpOrigin = "http://localhost:3773",
) {
  const registry = AtomRegistry.make();
  const session = openTuiSessionState({ stateDirectory, environmentId, httpOrigin, registry });
  cleanups.push(() => {
    session.close();
    registry.dispose();
  });
  const fixture = makeClientFixture(
    undefined,
    async () => ({
      type: "image",
      id: "image",
      name: "image.png",
      mimeType: "image/png",
      sizeBytes: 1,
      dataUrl: "data:image/png;base64,AA==",
    }),
    session,
  );
  return {
    registry,
    session,
    fixture,
    actions: fixture.client.actions,
    id: fixture.details[0]!.id,
  };
}

describe("TUI session persistence", () => {
  it("restores navigation, folded pastes and attachments in a fresh client", async () => {
    const path = directory();
    const first = open(path);
    first.session.saveShell({
      route: "conversation",
      sidebarView: "recent",
      projectId: ProjectId.make("alpha"),
      threadId: first.id,
      modal: "help",
    });
    first.actions.setDraft(first.registry, first.id, "Unsent ");
    first.actions.addPaste(first.registry, first.id, "long paste ".repeat(50));
    await first.actions.attachImages(first.registry, first.id, ["image.png"]);
    const second = open(path);
    expect(second.session.shell).toEqual({
      route: "conversation",
      sidebarView: "recent",
      projectId: "alpha",
      threadId: first.id,
      modal: null,
    });
    expect(second.registry.get(second.actions.state(second.id))).toMatchObject({
      draft: first.registry.get(first.actions.state(first.id)).draft,
      pastes: [{ text: "long paste ".repeat(50) }],
      attachments: [{ dataUrl: "data:image/png;base64,AA==" }],
      pending: null,
    });
    second.actions.setDraft(second.registry, second.id, "");
    const third = open(path);
    expect(third.registry.get(third.actions.state(second.id)).draft).toBe("");
  });

  it("separates environments and origins even when their thread IDs match", () => {
    const path = directory();
    const first = open(path);
    first.actions.setDraft(first.registry, first.id, "Private draft");
    expect(open(path, EnvironmentId.make("other-env")).session.interactions.size).toBe(0);
    expect(
      open(path, EnvironmentId.make("test-env"), "http://localhost:4000").session.interactions.size,
    ).toBe(0);
    expect(open(path).session.interactions.get(first.id)?.draft).toBe("Private draft");
  });

  it("restores queues paused and retries the original command identity", async () => {
    const path = directory();
    const first = open(path);
    const turnId = TurnId.make("running");
    first.registry.update(first.fixture.states[0]!, (state) => ({
      ...state,
      data: Option.map(state.data, (thread) => ({
        ...thread,
        latestTurn: {
          turnId,
          state: "running" as const,
          requestedAt: "2026-01-01T00:00:00.000Z",
          startedAt: null,
          completedAt: null,
          assistantMessageId: null,
        },
      })),
    }));
    first.actions.setDraft(first.registry, first.id, "Queued request");
    await first.actions.send(first.registry, first.id);
    const command = first.registry.get(first.actions.state(first.id)).queue[0]!.command;
    const second = open(path);
    expect(second.registry.get(second.actions.queuedThreads)).toEqual([second.id]);
    expect(second.registry.get(second.actions.state(second.id)).queue[0]?.status).toBe("held");
    expect(await second.actions.flushQueue(second.registry, second.id)).toBe(false);
    expect(second.fixture.commands).toEqual([]);
    expect(await second.actions.flushQueue(second.registry, second.id, true)).toBe(true);
    expect(second.fixture.commands).toEqual([command]);
  });

  it("does not resend a restored queued message already present on the server", async () => {
    const path = directory();
    const first = open(path);
    first.registry.update(first.fixture.states[0]!, (state) => ({
      ...state,
      data: Option.map(state.data, (thread) => ({
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
    first.actions.setDraft(first.registry, first.id, "Queued once");
    await first.actions.send(first.registry, first.id);
    const command = first.registry.get(first.actions.state(first.id)).queue[0]!.command;
    const second = open(path);
    second.registry.update(second.fixture.states[0]!, (state) => ({
      ...state,
      data: Option.map(state.data, (thread) => ({
        ...thread,
        messages: [
          ...thread.messages,
          {
            id: command.message.messageId,
            role: "user" as const,
            text: command.message.text,
            turnId: null,
            streaming: false,
            createdAt: command.createdAt,
            updatedAt: command.createdAt,
          },
        ],
      })),
    }));
    await second.actions.flushQueue(second.registry, second.id);
    expect(second.fixture.commands).toEqual([]);
    expect(second.registry.get(second.actions.state(second.id)).queue).toEqual([]);
  });

  it("preserves an unconfirmed send for idempotent retry", async () => {
    const path = directory();
    const first = open(path);
    const failedClient = makeClientFixture(async () => false, undefined, first.session);
    failedClient.client.actions.setDraft(first.registry, first.id, "Unconfirmed");
    expect(await failedClient.client.actions.send(first.registry, first.id)).toBe(false);
    const original = failedClient.commands[0];
    const second = open(path);
    expect(second.registry.get(second.actions.state(second.id)).attempt).toEqual(original);
    await second.actions.send(second.registry, second.id);
    expect(second.fixture.commands).toEqual([original]);
  });

  it("skips malformed saved fields and reports the problem", () => {
    const path = directory();
    const first = open(path);
    first.actions.setDraft(first.registry, first.id, "Draft");
    const db = new NodeSqlite.DatabaseSync(NodePath.join(path, "ui-state.sqlite"));
    db.prepare("UPDATE ui_state_v1 SET value = ? WHERE field = 'draft'").run("{broken");
    db.close();
    const second = open(path);
    expect(second.session.interactions.size).toBe(0);
    expect(second.registry.get(second.session.error)).toContain("Could not save or restore");
  });

  it("recovers committed state after SIGKILL without running close", async () => {
    const path = directory();
    const script = `
      import { openTuiSessionState } from ${JSON.stringify(new URL("./sessionStore.ts", import.meta.url).href)};
      import { AtomRegistry } from 'effect/unstable/reactivity';
      const session = openTuiSessionState({ stateDirectory: process.argv[1], environmentId: 'test-env', httpOrigin: 'http://localhost:3773', registry: AtomRegistry.make() });
      session.saveShell({ route: 'conversation', sidebarView: 'recent', projectId: 'alpha', threadId: 'thread-0', modal: null });
      session.saveInteraction('thread-0', { draft: 'Saved before kill', pastes: [], attachments: [], skill: null, queue: [], attempt: null, attemptDraft: null });
      process.on('message', () => {});
      process.send('saved');
    `;
    const child = NodeChildProcess.spawn(
      process.execPath,
      ["--input-type=module", "-e", script, path],
      {
        cwd: NodePath.resolve(import.meta.dirname, "../.."),
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    let error = "";
    child.stderr?.on("data", (chunk) => {
      error += chunk;
    });
    const exited = new Promise<void>((resolve, reject) => {
      child.once("exit", () => resolve());
      child.once("error", reject);
    });
    try {
      const ready = await Promise.race([
        new Promise<NodeChildProcess.Serializable>((resolve) => child.once("message", resolve)),
        exited.then(() => {
          throw new Error(error || "Child exited before saving");
        }),
      ]);
      expect(ready).toBe("saved");
      child.kill("SIGKILL");
      await exited;
      const recovered = open(path);
      expect(recovered.session.shell?.threadId).toBe("thread-0");
      expect(recovered.session.interactions.get(ThreadId.make("thread-0"))?.draft).toBe(
        "Saved before kill",
      );
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await exited;
      }
    }
  });
});
