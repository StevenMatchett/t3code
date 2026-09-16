/// <reference types="node" />
// @effect-diagnostics nodeBuiltinImport:off

import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

const CREDENTIAL_FILE_NAME = "environment-credential.json";
const MAX_CREDENTIAL_BYTES = 64 * 1024;
const CREDENTIAL_FILE_MODE = 0o600;
const UNSAFE_DIRECTORY_MODE_BITS = 0o022;

const TuiStoredCredentialSchema = Schema.Struct({
  version: Schema.Literal(1),
  httpOrigin: Schema.String,
  environmentId: EnvironmentId,
  bearerToken: Schema.String,
  expiresAtEpochMs: Schema.Finite,
});

export interface TuiStoredCredential {
  readonly version: 1;
  readonly httpOrigin: string;
  readonly environmentId: EnvironmentId;
  readonly bearerToken: string;
  readonly expiresAtEpochMs: number;
}

export const TuiCredentialStoreFailure = Schema.Literals(["missing", "unsafe", "invalid", "io"]);
export type TuiCredentialStoreFailure = typeof TuiCredentialStoreFailure.Type;

export class TuiCredentialStoreError extends Schema.TaggedError<TuiCredentialStoreError>()(
  "TuiCredentialStoreError",
  {
    failure: TuiCredentialStoreFailure,
    operation: Schema.Literals(["read", "write"]),
    systemCode: Schema.optionalKey(Schema.String),
  },
) {
  override get message(): string {
    switch (this.failure) {
      case "missing":
        return "No saved TUI environment credential exists.";
      case "unsafe":
        return "The saved TUI environment credential has unsafe filesystem metadata.";
      case "invalid":
        return "The saved TUI environment credential is invalid.";
      case "io":
        return `Failed to ${this.operation} the saved TUI environment credential.`;
    }
  }
}

export interface TuiCredentialStore {
  readonly read: () => Effect.Effect<TuiStoredCredential, TuiCredentialStoreError>;
  readonly write: (credential: TuiStoredCredential) => Effect.Effect<void, TuiCredentialStoreError>;
}

export interface PosixFileTuiCredentialStore extends TuiCredentialStore {
  readonly credentialPath: string;
}

function systemCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}

function isMissing(error: unknown): boolean {
  return systemCode(error) === "ENOENT";
}

function currentUid(): number | undefined {
  return typeof process.geteuid === "function" ? process.geteuid() : undefined;
}

function hasExpectedOwner(uid: number): boolean {
  const expected = currentUid();
  return expected === undefined || expected === uid;
}

function directoryIsSafe(stat: NodeFS.Stats): boolean {
  return (
    stat.isDirectory() &&
    !stat.isSymbolicLink() &&
    hasExpectedOwner(stat.uid) &&
    (stat.mode & UNSAFE_DIRECTORY_MODE_BITS) === 0
  );
}

function fileIsSafe(stat: NodeFS.Stats): boolean {
  return (
    stat.isFile() &&
    !stat.isSymbolicLink() &&
    stat.nlink === 1 &&
    hasExpectedOwner(stat.uid) &&
    (stat.mode & 0o777) === CREDENTIAL_FILE_MODE
  );
}

class UnsafeCredentialPathError extends Error {}
class MissingCredentialPathError extends Error {}
class InvalidCredentialFileError extends Error {}

async function inspectStateDirectory(stateDirectory: string, create: boolean): Promise<void> {
  let stat: NodeFS.Stats;
  try {
    stat = await NodeFSP.lstat(stateDirectory);
  } catch (error) {
    if (!isMissing(error)) throw error;
    if (!create) throw new MissingCredentialPathError();
    await NodeFSP.mkdir(stateDirectory, { recursive: true, mode: 0o700 });
    stat = await NodeFSP.lstat(stateDirectory);
  }
  if (!directoryIsSafe(stat)) throw new UnsafeCredentialPathError();
}

async function inspectCredentialPath(credentialPath: string): Promise<NodeFS.Stats | undefined> {
  try {
    const stat = await NodeFSP.lstat(credentialPath);
    if (!fileIsSafe(stat)) throw new UnsafeCredentialPathError();
    return stat;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

function mapFileError(operation: "read" | "write", error: unknown): TuiCredentialStoreError {
  const failure =
    error instanceof MissingCredentialPathError
      ? "missing"
      : error instanceof UnsafeCredentialPathError
        ? "unsafe"
        : error instanceof InvalidCredentialFileError
          ? "invalid"
          : "io";
  const code = systemCode(error);
  return new TuiCredentialStoreError({
    operation,
    failure,
    ...(code === undefined ? {} : { systemCode: code }),
  });
}

const decodeStoredCredential = Schema.decodeUnknownEffect(
  Schema.fromJsonString(TuiStoredCredentialSchema),
);
const encodeStoredCredential = Schema.encodeEffect(
  Schema.fromJsonString(TuiStoredCredentialSchema),
);
const isTuiCredentialStoreError = Schema.is(TuiCredentialStoreError);

async function readCredentialFile(stateDirectory: string, credentialPath: string): Promise<string> {
  await inspectStateDirectory(stateDirectory, false);
  const inspected = await inspectCredentialPath(credentialPath);
  if (inspected === undefined) throw new MissingCredentialPathError();

  let handle: NodeFSP.FileHandle;
  try {
    handle = await NodeFSP.open(
      credentialPath,
      NodeFS.constants.O_RDONLY |
        (NodeFS.constants.O_NOFOLLOW ?? 0) |
        (NodeFS.constants.O_NONBLOCK ?? 0),
    );
  } catch (error) {
    if (systemCode(error) === "ELOOP") throw new UnsafeCredentialPathError();
    throw error;
  }

  try {
    const opened = await handle.stat();
    if (!fileIsSafe(opened)) throw new UnsafeCredentialPathError();
    if (opened.size > MAX_CREDENTIAL_BYTES) throw new InvalidCredentialFileError();
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

async function writeCredentialFile(
  stateDirectory: string,
  credentialPath: string,
  contents: string,
): Promise<void> {
  await inspectStateDirectory(stateDirectory, true);
  await inspectCredentialPath(credentialPath);

  const suffix = NodeCrypto.randomBytes(12).toString("hex");
  const temporaryPath = NodePath.join(
    stateDirectory,
    `.${CREDENTIAL_FILE_NAME}.${process.pid}.${suffix}.tmp`,
  );
  let handle: NodeFSP.FileHandle | undefined;
  try {
    handle = await NodeFSP.open(
      temporaryPath,
      NodeFS.constants.O_CREAT |
        NodeFS.constants.O_EXCL |
        NodeFS.constants.O_WRONLY |
        (NodeFS.constants.O_NOFOLLOW ?? 0),
      CREDENTIAL_FILE_MODE,
    );
    await handle.writeFile(contents, "utf8");
    await handle.chmod(CREDENTIAL_FILE_MODE);
    await handle.sync();
    await handle.close();
    handle = undefined;

    await inspectStateDirectory(stateDirectory, false);
    await inspectCredentialPath(credentialPath);
    await NodeFSP.rename(temporaryPath, credentialPath);
    const published = await NodeFSP.lstat(credentialPath);
    if (!fileIsSafe(published)) throw new UnsafeCredentialPathError();
  } finally {
    await handle?.close().catch(() => undefined);
    await NodeFSP.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export function makePosixFileTuiCredentialStore(options: {
  readonly stateDirectory: string;
}): PosixFileTuiCredentialStore {
  const stateDirectory = NodePath.resolve(options.stateDirectory);
  const credentialPath = NodePath.join(stateDirectory, CREDENTIAL_FILE_NAME);

  return {
    credentialPath,
    read: () =>
      Effect.tryPromise({
        try: () => readCredentialFile(stateDirectory, credentialPath),
        catch: (error) => mapFileError("read", error),
      }).pipe(
        Effect.flatMap(decodeStoredCredential),
        Effect.mapError((error) =>
          isTuiCredentialStoreError(error)
            ? error
            : new TuiCredentialStoreError({ failure: "invalid", operation: "read" }),
        ),
      ),
    write: (credential) =>
      encodeStoredCredential(credential).pipe(
        Effect.mapError(
          () => new TuiCredentialStoreError({ failure: "invalid", operation: "write" }),
        ),
        Effect.flatMap((contents) =>
          Effect.tryPromise({
            try: () => writeCredentialFile(stateDirectory, credentialPath, contents),
            catch: (error) => mapFileError("write", error),
          }),
        ),
      ),
  };
}
