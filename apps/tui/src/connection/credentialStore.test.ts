/// <reference types="node" />
// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics preferSchemaOverJson:off

import { EnvironmentId } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeFSP from "node:fs/promises";
import * as NodeCrypto from "node:crypto";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  makePosixFileTuiCredentialStore,
  makeProtectedFileTuiCredentialStore,
  makeTuiCredentialStore,
  TuiCredentialStoreError,
  type TuiCredentialProtection,
} from "./credentialStore.ts";

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

function makeProtectionFixture(): TuiCredentialProtection {
  const key = NodeCrypto.randomBytes(32);
  return {
    async protect(bytes) {
      const iv = NodeCrypto.randomBytes(12);
      const cipher = NodeCrypto.createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([cipher.update(bytes), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    async unprotect(bytes) {
      const cipher = NodeCrypto.createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      cipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]);
    },
  };
}

describe("protected TUI credential store", () => {
  it.effect("persists only ciphertext and wipes plaintext buffers", () =>
    Effect.gen(function* () {
      const root = yield* withTemporaryDirectory;
      const protection = makeProtectionFixture();
      const buffers: Uint8Array[] = [];
      const store = makeProtectedFileTuiCredentialStore({
        stateDirectory: root,
        protection: {
          protect: async (bytes) => {
            buffers.push(bytes);
            return protection.protect(bytes);
          },
          unprotect: async (bytes) => {
            const plain = await protection.unprotect(bytes);
            buffers.push(plain);
            return plain;
          },
        },
      });
      yield* store.write(credential);
      const ciphertext = yield* Effect.promise(() =>
        NodeFSP.readFile(store.credentialPath, "utf8"),
      );
      assert.notInclude(ciphertext, BEARER);
      assert.notInclude(ciphertext, credential.httpOrigin);
      assert.deepEqual(yield* store.read(), credential);
      assert.isTrue(buffers.every((bytes) => bytes.every((byte) => byte === 0)));
      assert.deepEqual(yield* Effect.promise(() => NodeFSP.readdir(root)), [
        "environment-credential.dpapi",
      ]);
    }),
  );

  it.effect("preserves the saved credential if protection fails and redacts its cause", () =>
    Effect.gen(function* () {
      const root = yield* withTemporaryDirectory;
      const protection = makeProtectionFixture();
      const store = makeProtectedFileTuiCredentialStore({ stateDirectory: root, protection });
      yield* store.write(credential);
      const broken = makeProtectedFileTuiCredentialStore({
        stateDirectory: root,
        protection: {
          ...protection,
          protect: async () => {
            throw new Error(BEARER);
          },
        },
      });
      const error = yield* broken
        .write({ ...credential, bearerToken: "new-token" })
        .pipe(Effect.flip);
      assert.equal(error.failure, "io");
      assert.notInclude(String(error), BEARER);
      assert.deepEqual(yield* store.read(), credential);
      assert.deepEqual(yield* Effect.promise(() => NodeFSP.readdir(root)), [
        "environment-credential.dpapi",
      ]);
    }),
  );

  it.effect("rejects a damaged protected credential without trying a plaintext fallback", () =>
    Effect.gen(function* () {
      const root = yield* withTemporaryDirectory;
      const store = makeProtectedFileTuiCredentialStore({
        stateDirectory: root,
        protection: makeProtectionFixture(),
      });
      yield* store.write(credential);
      yield* makePosixFileTuiCredentialStore({ stateDirectory: root }).write(credential);
      yield* Effect.promise(() => NodeFSP.writeFile(store.credentialPath, "AAAA", { mode: 0o600 }));
      const error = yield* store.read().pipe(Effect.flip);
      assert.equal(error.failure, "io");
      assert.notInclude(String(error), BEARER);
    }),
  );

  it.effect("rejects oversized writes without replacing a valid credential", () =>
    Effect.gen(function* () {
      const root = yield* withTemporaryDirectory;
      const store = makeProtectedFileTuiCredentialStore({
        stateDirectory: root,
        protection: makeProtectionFixture(),
      });
      yield* store.write(credential);
      const error = yield* store
        .write({ ...credential, bearerToken: "x".repeat(70_000) })
        .pipe(Effect.flip);
      assert.equal(error.failure, "invalid");
      assert.deepEqual(yield* store.read(), credential);
    }),
  );

  it.effect("rejects linked protected credential files before decryption", () =>
    Effect.gen(function* () {
      const root = yield* withTemporaryDirectory;
      const store = makeProtectedFileTuiCredentialStore({
        stateDirectory: root,
        protection: makeProtectionFixture(),
      });
      yield* store.write(credential);
      yield* Effect.promise(() =>
        NodeFSP.link(store.credentialPath, NodePath.join(root, "linked")),
      );
      assert.equal((yield* store.read().pipe(Effect.flip)).failure, "unsafe");
      assert.equal((yield* store.write(credential).pipe(Effect.flip)).failure, "unsafe");
    }),
  );

  it("selects protected storage for Windows and POSIX storage elsewhere", () => {
    assert.include(
      makeTuiCredentialStore({ stateDirectory: "/tmp/state", platform: "win32" }).credentialPath,
      ".dpapi",
    );
    assert.include(
      makeTuiCredentialStore({ stateDirectory: "/tmp/state", platform: "darwin" }).credentialPath,
      ".json",
    );
    assert.include(
      makeTuiCredentialStore({ stateDirectory: "/tmp/state", platform: "linux" }).credentialPath,
      ".json",
    );
  });
});

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
