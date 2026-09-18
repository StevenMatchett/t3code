import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { EnvironmentId } from "@t3tools/contracts";
import { makeTuiCredentialStore } from "../dist/connection/credentialStore.js";

if (NodeProcess.platform !== "win32") {
  it.skip("Windows DPAPI native credential round trip requires Windows", () => {});
} else {
  it.live(
    "protects a derived credential with Windows DPAPI and rejects corruption",
    () =>
      Effect.gen(function* () {
        const root = yield* Effect.acquireRelease(
          Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "tui-dpapi-"))),
          (path) => Effect.promise(() => NodeFSP.rm(path, { recursive: true, force: true })),
        );
        const options = { stateDirectory: NodePath.join(root, "state") };
        const store = makeTuiCredentialStore(options);
        const credential = {
          version: 1,
          httpOrigin: "http://127.0.0.1:43220",
          environmentId: EnvironmentId.make("windows-dpapi-fixture"),
          bearerToken: "derived-windows-bearer-fixture",
          expiresAtEpochMs: 1_900_000_000_000,
        };
        NodeAssert.equal((yield* store.read().pipe(Effect.flip)).failure, "missing");
        yield* store.write(credential);
        NodeAssert.deepEqual(yield* makeTuiCredentialStore(options).read(), credential);
        yield* store.write({ ...credential, expiresAtEpochMs: credential.expiresAtEpochMs + 1 });
        NodeAssert.equal((yield* store.read()).expiresAtEpochMs, credential.expiresAtEpochMs + 1);
        const bytes = yield* Effect.promise(() => NodeFSP.readFile(store.credentialPath, "utf8"));
        NodeAssert.equal(bytes.includes(credential.bearerToken), false);
        NodeAssert.equal(bytes.includes(credential.httpOrigin), false);
        NodeAssert.deepEqual(yield* Effect.promise(() => NodeFSP.readdir(options.stateDirectory)), [
          "environment-credential.dpapi",
        ]);
        yield* Effect.promise(() => NodeFSP.writeFile(store.credentialPath, "AAAA"));
        const error = yield* store.read().pipe(Effect.flip);
        NodeAssert.equal(error.failure, "io");
        NodeAssert.equal(String(error).includes(credential.bearerToken), false);
      }).pipe(Effect.scoped),
    45_000,
  );
}
