import { preparePeer } from "./provider-peer-fixture.mjs";
import * as NodeAssert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Option, Stream } from "effect";
import { AtomRegistry } from "effect/reactivity";
import { createTuiClient } from "../dist/connection/clientRuntime.js";
import { makeTerminalEnvironmentFixture } from "./terminal-fixture.mjs";

it.live(
  "creates and updates projects and threads through the negotiated protocol",
  () =>
    Effect.gen(function* () {
      const fixture = yield* makeTerminalEnvironmentFixture({
        serverEntryPath: process.env.TUI_TEST_SERVER_ENTRY,
        prepare: (root) => preparePeer(root, "choices"),
      });
      const client = createTuiClient({ ...fixture.environment, readiness: fixture.readiness });
      const registry = AtomRegistry.make();
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
      const wait = (atom, predicate) =>
        AtomRegistry.toStream(registry, atom).pipe(
          Stream.filter(predicate),
          Stream.take(1),
          Stream.runCollect,
          Effect.map((values) => values[0]),
          Effect.timeout("15 seconds"),
        );
      for (const atom of [client.connection, client.shell, client.providers]) {
        const unmount = registry.mount(atom);
        yield* Effect.addFinalizer(() => Effect.sync(unmount));
      }
      yield* wait(client.connection, (state) => state.phase === "connected");
      yield* wait(client.shell, (state) => state.status === "live");
      const projectId = yield* Effect.promise(() =>
        client.newProjects.createLocal(registry, `${fixture.root}/workspace`),
      );
      NodeAssert.ok(projectId, JSON.stringify(registry.get(client.newProjects.state)));
      yield* wait(
        client.shell,
        (state) =>
          Option.isSome(state.snapshot) &&
          state.snapshot.value.projects.some((project) => project.id === projectId),
      );
      yield* wait(
        client.providers,
        (value) =>
          value.status === "live" &&
          value.providers.some((provider) =>
            provider.models.some((model) => model.slug === "fixture-model-b"),
          ),
      );
      const threadId = yield* Effect.promise(() =>
        client.newThreads.create(registry, {
          projectId,
          title: "Compatible thread",
          mode: "local",
          baseRef: "HEAD",
          modelSelection: { instanceId: "codex", model: "fixture-model-b" },
          runtimeMode: "full-access",
        }),
      );
      NodeAssert.ok(threadId, JSON.stringify(registry.get(client.newThreads.state)));
      const detail = yield* wait(
        client.thread(threadId),
        (state) => state.status === "live" && Option.isSome(state.data),
      );
      NodeAssert.equal(detail.data.value.title, "Compatible thread");
      NodeAssert.equal(detail.data.value.projectId, projectId);
      const archive = yield* Effect.promise(() =>
        client.threadManagement.archive(registry, threadId),
      );
      NodeAssert.equal(archive, true);
      yield* wait(
        client.archivedThreads,
        (state) =>
          state.status === "live" && state.threads.some((thread) => thread.id === threadId),
      );
    }).pipe(Effect.scoped),
  { timeout: 90_000 },
);
