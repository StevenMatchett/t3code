import * as NodeAssert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { createTuiClient } from "../dist/connection/clientRuntime.js";
import { makeTerminalEnvironmentFixture } from "./terminal-fixture.mjs";
import { preparePeer } from "./provider-peer-fixture.mjs";

it.live("offers no current-server features on the older protocol", () =>
  Effect.gen(function* () {
    const fixture = yield* makeTerminalEnvironmentFixture({
      serverEntryPath: process.env.TUI_TEST_SERVER_ENTRY,
      prepare: (root) => preparePeer(root, "complete"),
    });
    const { descriptor } = fixture.readiness;
    const older = createTuiClient({
      readiness: {
        ...fixture.readiness,
        descriptor: { ...descriptor, orchestrationProtocolVersion: 1 },
      },
      bearer: fixture.environment.bearer,
    });
    NodeAssert.equal(older.git, undefined);
    NodeAssert.equal(older.pullRequests, undefined);
    NodeAssert.equal(older.forkThreadFromRun, undefined);
    const current = createTuiClient({
      readiness: fixture.readiness,
      bearer: fixture.environment.bearer,
    });
    NodeAssert.ok(current.git && current.pullRequests && current.forkThreadFromRun);
  }).pipe(Effect.scoped),
);
