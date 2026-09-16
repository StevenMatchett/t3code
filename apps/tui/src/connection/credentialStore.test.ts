/// <reference types="node" />
// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics preferSchemaOverJson:off

import { EnvironmentId } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { makePosixFileTuiCredentialStore, TuiCredentialStoreError } from "./credentialStore.ts";

const BEARER = "derived-bearer-fixture";
const BOOTSTRAP_SECRET = "bootstrap-secret-must-never-land-on-disk";

const credential = {
  version: 1,
  httpOrigin: "http://127.0.0.1:43220",
  environmentId: EnvironmentId.make("credential-store-test"),
  bearerToken: BEARER,
  expiresAtEpochMs: 1_800_000_000_000,
} as const;

const withTemporaryDirectory = Effect.acquireRelease(
  Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-tui-credential-"))),
  (directory) => Effect.promise(() => NodeFSP.rm(directory, { recursive: true, force: true })),
);

describe("POSIX TUI credential store", () => {
  it.effect("reports a missing credential without creating state", () =>
    Effect.gen(function* () {
      const root = yield* withTemporaryDirectory;
      const stateDirectory = NodePath.join(root, "state");
      const store = makePosixFileTuiCredentialStore({ stateDirectory });

      const error = yield* Effect.flip(store.read());

      assert.instanceOf(error, TuiCredentialStoreError);
      assert.equal(error.failure, "missing");
      assert.isFalse(
        yield* Effect.promise(() =>
          NodeFSP.lstat(stateDirectory).then(
            () => true,
            () => false,
          ),
        ),
      );
    }),
  );

  it.effect("atomically replaces a mode-0600 file containing only reattachment fields", () =>
    Effect.gen(function* () {
      const root = yield* withTemporaryDirectory;
      const stateDirectory = NodePath.join(root, "state");
      const store = makePosixFileTuiCredentialStore({ stateDirectory });

      yield* store.write(credential);
      const firstStat = yield* Effect.promise(() => NodeFSP.lstat(store.credentialPath));
      yield* store.write({ ...credential, expiresAtEpochMs: credential.expiresAtEpochMs + 1 });
      const secondStat = yield* Effect.promise(() => NodeFSP.lstat(store.credentialPath));
      const contents = yield* Effect.promise(() => NodeFSP.readFile(store.credentialPath, "utf8"));
      const persisted = JSON.parse(contents) as Record<string, unknown>;
      const entries = yield* Effect.promise(() => NodeFSP.readdir(stateDirectory));

      assert.equal(firstStat.mode & 0o777, 0o600);
      assert.equal(secondStat.mode & 0o777, 0o600);
      assert.notEqual(firstStat.ino, secondStat.ino);
      assert.deepEqual(entries, ["environment-credential.json"]);
      assert.deepEqual(Object.keys(persisted).toSorted(), [
        "bearerToken",
        "environmentId",
        "expiresAtEpochMs",
        "httpOrigin",
        "version",
      ]);
      assert.equal(persisted.bearerToken, BEARER);
      assert.notInclude(contents, BOOTSTRAP_SECRET);
      assert.deepEqual(yield* store.read(), {
        ...credential,
        expiresAtEpochMs: credential.expiresAtEpochMs + 1,
      });
    }),
  );

  it.effect("refuses a credential file readable by another user", () =>
    Effect.gen(function* () {
      const root = yield* withTemporaryDirectory;
      const store = makePosixFileTuiCredentialStore({
        stateDirectory: NodePath.join(root, "state"),
      });
      yield* store.write(credential);
      yield* Effect.promise(() => NodeFSP.chmod(store.credentialPath, 0o644));

      const readError = yield* Effect.flip(store.read());
      const writeError = yield* Effect.flip(store.write(credential));

      assert.instanceOf(readError, TuiCredentialStoreError);
      assert.equal(readError.failure, "unsafe");
      assert.instanceOf(writeError, TuiCredentialStoreError);
      assert.equal(writeError.failure, "unsafe");
    }),
  );

  it.effect("refuses symlinked state and credential targets", () =>
    Effect.gen(function* () {
      const root = yield* withTemporaryDirectory;
      const realState = NodePath.join(root, "real-state");
      const linkedState = NodePath.join(root, "linked-state");
      yield* Effect.promise(() => NodeFSP.mkdir(realState, { mode: 0o700 }));
      yield* Effect.promise(() => NodeFSP.symlink(realState, linkedState));
      const linkedStore = makePosixFileTuiCredentialStore({ stateDirectory: linkedState });
      const stateError = yield* Effect.flip(linkedStore.write(credential));
      assert.equal(stateError.failure, "unsafe");

      const store = makePosixFileTuiCredentialStore({ stateDirectory: realState });
      const exposed = NodePath.join(root, "exposed.json");
      yield* Effect.promise(() => NodeFSP.writeFile(exposed, "{}", { mode: 0o600 }));
      yield* Effect.promise(() => NodeFSP.symlink(exposed, store.credentialPath));
      const fileError = yield* Effect.flip(store.read());
      assert.equal(fileError.failure, "unsafe");
    }),
  );
});
