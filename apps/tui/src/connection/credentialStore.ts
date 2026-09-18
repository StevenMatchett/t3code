/// <reference types="node" />
// @effect-diagnostics nodeBuiltinImport:off

import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeChildProcess from "node:child_process";

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

export interface FileTuiCredentialStore extends TuiCredentialStore {
  readonly credentialPath: string;
}

export type PosixFileTuiCredentialStore = FileTuiCredentialStore;

export interface TuiCredentialProtection {
  readonly protect: (bytes: Uint8Array, signal?: AbortSignal) => Promise<Uint8Array>;
  readonly unprotect: (bytes: Uint8Array, signal?: AbortSignal) => Promise<Uint8Array>;
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

function directoryIsSafe(stat: NodeFS.Stats, encrypted = false): boolean {
  return (
    stat.isDirectory() &&
    !stat.isSymbolicLink() &&
    hasExpectedOwner(stat.uid) &&
    (encrypted || (stat.mode & UNSAFE_DIRECTORY_MODE_BITS) === 0)
  );
}

function fileIsSafe(stat: NodeFS.Stats, encrypted = false): boolean {
  return (
    stat.isFile() &&
    !stat.isSymbolicLink() &&
    stat.nlink === 1 &&
    hasExpectedOwner(stat.uid) &&
    (encrypted || (stat.mode & 0o777) === CREDENTIAL_FILE_MODE)
  );
}

class UnsafeCredentialPathError extends Error {}
class MissingCredentialPathError extends Error {}
class InvalidCredentialFileError extends Error {}

async function inspectStateDirectory(
  stateDirectory: string,
  create: boolean,
  encrypted = false,
): Promise<void> {
  let stat: NodeFS.Stats;
  try {
    stat = await NodeFSP.lstat(stateDirectory);
  } catch (error) {
    if (!isMissing(error)) throw error;
    if (!create) throw new MissingCredentialPathError();
    await NodeFSP.mkdir(stateDirectory, { recursive: true, mode: 0o700 });
    stat = await NodeFSP.lstat(stateDirectory);
  }
  if (!directoryIsSafe(stat, encrypted)) throw new UnsafeCredentialPathError();
}

async function inspectCredentialPath(
  credentialPath: string,
  encrypted = false,
): Promise<NodeFS.Stats | undefined> {
  try {
    const stat = await NodeFSP.lstat(credentialPath);
    if (!fileIsSafe(stat, encrypted)) throw new UnsafeCredentialPathError();
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

async function readCredentialFile(
  stateDirectory: string,
  credentialPath: string,
  encrypted = false,
): Promise<string> {
  await inspectStateDirectory(stateDirectory, false, encrypted);
  const inspected = await inspectCredentialPath(credentialPath, encrypted);
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
    if (
      !fileIsSafe(opened, encrypted) ||
      opened.ino !== inspected.ino ||
      opened.dev !== inspected.dev
    )
      throw new UnsafeCredentialPathError();
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
  encrypted = false,
): Promise<void> {
  if (Buffer.byteLength(contents, "utf8") > MAX_CREDENTIAL_BYTES)
    throw new InvalidCredentialFileError();
  await inspectStateDirectory(stateDirectory, true, encrypted);
  await inspectCredentialPath(credentialPath, encrypted);

  const suffix = NodeCrypto.randomBytes(12).toString("hex");
  const temporaryPath = NodePath.join(
    stateDirectory,
    `.${NodePath.basename(credentialPath)}.${process.pid}.${suffix}.tmp`,
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
    if (!encrypted) await handle.chmod(CREDENTIAL_FILE_MODE);
    await handle.sync();
    await handle.close();
    handle = undefined;

    await inspectStateDirectory(stateDirectory, false, encrypted);
    await inspectCredentialPath(credentialPath, encrypted);
    await NodeFSP.rename(temporaryPath, credentialPath);
    const published = await NodeFSP.lstat(credentialPath);
    if (!fileIsSafe(published, encrypted)) throw new UnsafeCredentialPathError();
  } finally {
    await handle?.close().catch(() => undefined);
    await NodeFSP.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function runWindowsProtection(
  method: "Protect" | "Unprotect",
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const executable = NodePath.win32.join(
    NodeProcess.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const script = [
    "$ErrorActionPreference='Stop'",
    "Add-Type -AssemblyName System.Security",
    "$bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd())",
    "$entropy=[Text.Encoding]::UTF8.GetBytes('t3-tui:credential:v1')",
    "try {",
    `$result=[Security.Cryptography.ProtectedData]::${method}($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)`,
    "[Console]::Out.Write([Convert]::ToBase64String($result))",
    "} finally {",
    "[Array]::Clear($bytes,0,$bytes.Length)",
    "if ($null -ne $result) { [Array]::Clear($result,0,$result.Length) }",
    "}",
  ].join("\n");
  return new Promise((resolve, reject) => {
    const child = NodeChildProcess.spawn(
      executable,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      {
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
        timeout: 10_000,
        ...(signal ? { signal } : {}),
      },
    );
    const chunks: Uint8Array[] = [];
    let length = 0;
    let rejected = false;
    const fail = () => {
      rejected = true;
      for (const chunk of chunks) chunk.fill(0);
      reject(new Error("Windows credential protection failed"));
    };
    child.once("error", fail);
    child.stdin.on("error", fail);
    child.stdout.on("error", fail);
    child.stdout.on("data", (chunk: Uint8Array) => {
      length += chunk.byteLength;
      if (length > MAX_CREDENTIAL_BYTES * 2 || rejected) {
        chunk.fill(0);
        child.kill();
        fail();
      } else chunks.push(chunk);
    });
    child.once("close", (code) => {
      const output = Buffer.concat(chunks);
      try {
        if (code !== 0 || rejected || output.length === 0) {
          fail();
          return;
        }
        const encoded = output.toString("ascii");
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
          fail();
          return;
        }
        resolve(Buffer.from(encoded, "base64"));
      } finally {
        output.fill(0);
        for (const chunk of chunks) chunk.fill(0);
      }
    });
    child.stdin.end(Buffer.from(bytes).toString("base64"), "ascii");
  });
}

const windowsProtection: TuiCredentialProtection = {
  protect: (bytes, signal) => runWindowsProtection("Protect", bytes, signal),
  unprotect: (bytes, signal) => runWindowsProtection("Unprotect", bytes, signal),
};

export function makeProtectedFileTuiCredentialStore(options: {
  readonly stateDirectory: string;
  readonly protection: TuiCredentialProtection;
}): FileTuiCredentialStore {
  const stateDirectory = NodePath.resolve(options.stateDirectory);
  const credentialPath = NodePath.join(stateDirectory, "environment-credential.dpapi");
  return {
    credentialPath,
    read: () =>
      Effect.tryPromise({
        try: async (signal) => {
          const encoded = await readCredentialFile(stateDirectory, credentialPath, true);
          if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new InvalidCredentialFileError();
          const ciphertext = Buffer.from(encoded, "base64");
          let plaintext: Uint8Array | undefined;
          try {
            plaintext = await options.protection.unprotect(ciphertext, signal);
            return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
          } finally {
            plaintext?.fill(0);
            ciphertext.fill(0);
          }
        },
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
            try: async (signal) => {
              const plaintext = new TextEncoder().encode(contents);
              let ciphertext: Uint8Array | undefined;
              try {
                if (plaintext.byteLength > MAX_CREDENTIAL_BYTES)
                  throw new InvalidCredentialFileError();
                ciphertext = await options.protection.protect(plaintext, signal);
                if (ciphertext.byteLength === 0) throw new InvalidCredentialFileError();
                signal.throwIfAborted();
                await writeCredentialFile(
                  stateDirectory,
                  credentialPath,
                  Buffer.from(ciphertext).toString("base64"),
                  true,
                );
              } finally {
                plaintext.fill(0);
                ciphertext?.fill(0);
              }
            },
            catch: (error) => mapFileError("write", error),
          }),
        ),
      ),
  };
}

export function makeTuiCredentialStore(options: {
  readonly stateDirectory: string;
  readonly platform?: NodeJS.Platform;
}): FileTuiCredentialStore {
  return (options.platform ?? NodeProcess.platform) === "win32"
    ? makeProtectedFileTuiCredentialStore({
        stateDirectory: options.stateDirectory,
        protection: windowsProtection,
      })
    : makePosixFileTuiCredentialStore(options);
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
