import * as NodeAssert from "node:assert/strict";
import * as NodePath from "node:path";
import { it } from "@effect/vitest";
import { Effect, Option, Stream } from "effect";
import { AtomRegistry } from "effect/unstable/reactivity";
import { createElement } from "react";
import { AppShell } from "../dist/renderer/AppShell.js";
import { createTuiTestDriver } from "../dist/testing/driver.js";
import {
  CommandId,
  ProjectId,
  ThreadId,
  ProviderInstanceId,
  ORCHESTRATION_WS_METHODS,
} from "@t3tools/contracts";
import { createTuiClient } from "../dist/connection/clientRuntime.js";
import {
  makeTerminalEnvironmentFixture,
  openTerminalFixtureConnection,
} from "./terminal-fixture.mjs";

it.live(
  "subscribes to real shared projects and threads through the client runtime",
  () =>
    Effect.gen(function* () {
      const fixture = yield* makeTerminalEnvironmentFixture({
        serverEntryPath: process.env.TUI_TEST_SERVER_ENTRY,
      });
      const seed = yield* openTerminalFixtureConnection(fixture);
      const command = seed.client[ORCHESTRATION_WS_METHODS.dispatchCommand];
      const projectId = ProjectId.make("live-client-project");
      const threadId = ThreadId.make("live-client-thread");
      const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" };
      yield* command({
        type: "project.create",
        commandId: CommandId.make("live-create-project"),
        projectId,
        title: "Shared project",
        workspaceRoot: NodePath.join(fixture.root, "workspace"),
        createWorkspaceRootIfMissing: true,
        defaultModelSelection: modelSelection,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      yield* command({
        type: "thread.create",
        commandId: CommandId.make("live-create-thread"),
        threadId,
        projectId,
        title: "Shared conversation",
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
      const unmount = registry.mount(client.shell);
      yield* Effect.addFinalizer(() => Effect.sync(unmount));
      const snapshot = yield* AtomRegistry.toStream(registry, client.shell).pipe(
        Stream.filter(
          (state) =>
            state.status === "live" &&
            Option.isSome(state.snapshot) &&
            state.snapshot.value.threads.some((thread) => thread.id === threadId),
        ),
        Stream.take(1),
        Stream.runCollect,
        Effect.timeout("15 seconds"),
      );
      NodeAssert.equal(
        snapshot[0].snapshot.value.projects.find((project) => project.id === projectId)?.title,
        "Shared project",
      );
      const unmountThread = registry.mount(client.thread(threadId));
      yield* Effect.addFinalizer(() => Effect.sync(unmountThread));
      const details = yield* AtomRegistry.toStream(registry, client.thread(threadId)).pipe(
        Stream.filter((state) => state.status === "live" && Option.isSome(state.data)),
        Stream.take(1),
        Stream.runCollect,
        Effect.timeout("15 seconds"),
      );
      NodeAssert.equal(details[0].data.value.title, "Shared conversation");
      NodeAssert.equal(details[0].data.value.id, threadId);
      yield* command({
        type: "thread.meta.update",
        commandId: CommandId.make("remote-model-change"),
        threadId,
        modelSelection: { ...modelSelection, model: "remote-selected-model" },
      });
      const modelChanged = yield* AtomRegistry.toStream(registry, client.thread(threadId)).pipe(
        Stream.filter(
          (state) =>
            Option.isSome(state.data) &&
            state.data.value.modelSelection.model === "remote-selected-model",
        ),
        Stream.take(1),
        Stream.runCollect,
        Effect.timeout("15 seconds"),
      );
      NodeAssert.equal(modelChanged.length, 1);
      yield* command({
        type: "project.meta.update",
        commandId: CommandId.make("live-rename-project"),
        projectId,
        title: "Renamed in another client",
      });
      const renamed = yield* AtomRegistry.toStream(registry, client.shell).pipe(
        Stream.filter(
          (state) =>
            Option.isSome(state.snapshot) &&
            state.snapshot.value.projects.some(
              (project) => project.title === "Renamed in another client",
            ),
        ),
        Stream.take(1),
        Stream.runCollect,
        Effect.timeout("15 seconds"),
      );
      NodeAssert.equal(renamed.length, 1);
      const driver = yield* Effect.acquireRelease(
        Effect.promise(() =>
          createTuiTestDriver(createElement(AppShell, { client }), {
            registry,
            width: 80,
            height: 24,
            kittyKeyboard: true,
          }),
        ),
        (value) => Effect.promise(() => value.close()),
      );
      NodeAssert.match(driver.captureFrame(), /> Renamed in another client/);
      yield* Effect.promise(() => driver.input.pressKey("RETURN"));
      NodeAssert.match(driver.captureFrame(), /> Shared conversation/);
      yield* Effect.promise(() => driver.input.pressKey("RETURN"));
      NodeAssert.match(driver.captureFrame(), /No messages in this thread/);
      yield* Effect.promise(() => driver.input.pressKey("ESCAPE"));
      NodeAssert.match(driver.captureFrame(), /> Shared conversation/);
    }).pipe(Effect.scoped),
  45_000,
);
