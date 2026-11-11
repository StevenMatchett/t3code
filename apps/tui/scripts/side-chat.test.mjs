import * as NodeAssert from "node:assert/strict";
import * as NodePath from "node:path";
import { it } from "@effect/vitest";
import { Effect, Option, Stream } from "effect";
import { AtomRegistry } from "effect/reactivity";
import { createElement } from "react";
import {
  CommandId,
  ORCHESTRATION_V2_WS_METHODS,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WS_METHODS,
} from "@t3tools/contracts";
import { AppShell } from "../dist/renderer/AppShell.js";
import { createTuiTestDriver } from "../dist/testing/driver.js";
import { createTuiClient } from "../dist/connection/clientRuntime.js";
import {
  makeTerminalEnvironmentFixture,
  openTerminalFixtureConnection,
} from "./terminal-fixture.mjs";
import { preparePeer } from "./provider-peer-fixture.mjs";

it.live("opens the side chat /btw starts, goes back with U, and returns from the list", () =>
  Effect.gen(function* () {
    const fixture = yield* makeTerminalEnvironmentFixture({
      serverEntryPath: process.env.TUI_TEST_SERVER_ENTRY,
      prepare: (root) => preparePeer(root, "complete"),
    });
    const seed = yield* openTerminalFixtureConnection(fixture);
    const projectId = ProjectId.make("side-chat-project");
    const threadId = ThreadId.make("side-chat-parent");
    const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" };
    yield* seed.client[WS_METHODS.projectsMutate]({
      type: "project.create",
      commandId: CommandId.make("side-chat-project-create"),
      projectId,
      title: "Side chat fixture",
      workspaceRoot: NodePath.join(fixture.root, "workspace"),
      defaultModelSelection: modelSelection,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    yield* seed.client[ORCHESTRATION_V2_WS_METHODS.dispatchCommand]({
      type: "thread.create",
      createdBy: "user",
      creationSource: "web",
      commandId: CommandId.make("side-chat-thread-create"),
      projectId,
      threadId,
      title: "Main thread",
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: "2026-01-01T00:00:01.000Z",
    });
    const client = createTuiClient({
      readiness: fixture.readiness,
      bearer: fixture.environment.bearer,
    });
    const registry = yield* Effect.acquireRelease(
      Effect.sync(() => AtomRegistry.make()),
      (value) => Effect.sync(() => value.dispose()),
    );
    const unmountShell = registry.mount(client.shell);
    yield* Effect.addFinalizer(() => Effect.sync(unmountShell));
    const shellHas = (predicate) =>
      AtomRegistry.toStream(registry, client.shell).pipe(
        Stream.filter(
          (state) =>
            state.status === "live" &&
            Option.exists(state.snapshot, (snapshot) => snapshot.threads.some(predicate)),
        ),
        Stream.take(1),
        Stream.runCollect,
        Effect.timeout("15 seconds"),
      );
    yield* shellHas((thread) => thread.id === threadId);
    const driver = yield* Effect.acquireRelease(
      Effect.promise(() =>
        createTuiTestDriver(createElement(AppShell, { client }), {
          registry,
          width: 100,
          height: 30,
          kittyKeyboard: true,
        }),
      ),
      (value) => Effect.promise(() => value.close()),
    );
    const press = (key) => Effect.promise(() => driver.input.pressKey(key));
    const header = () => driver.captureFrame().split("\n")[0] ?? "";
    yield* press("RETURN");
    yield* press("RETURN");
    NodeAssert.match(header(), /Main thread/);

    yield* press("i");
    yield* Effect.promise(() => driver.input.typeText("/btw hello"));
    yield* press("RETURN");
    yield* shellHas((thread) => thread.lineage?.sideChat === true);
    // Opening waits for the shell's thread list, and Parent for the side chat's details. The
    // server may rename the side chat after its question, so only leaving the parent counts.
    while (/Main thread/.test(header()) || !/U Parent/.test(driver.captureFrame()))
      yield* Effect.promise(() => driver.flush());
    NodeAssert.match(driver.captureFrame(), /hello/);

    yield* press("u");
    NodeAssert.match(header(), /Main thread/);
    // Side chats never list in the sidebar, so the parent is the way back in.
    NodeAssert.match(driver.captureFrame(), /S Side chats 1/);
    yield* press("s");
    NodeAssert.match(driver.captureFrame(), /> .+ · \d/);
    yield* press("RETURN");
    NodeAssert.doesNotMatch(header(), /Main thread/);
    NodeAssert.match(driver.captureFrame(), /U Parent/);
  }).pipe(Effect.scoped),
);
