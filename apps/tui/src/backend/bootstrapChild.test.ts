/// <reference types="node" />
// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics preferSchemaOverJson:off globalErrorInEffectCatch:off globalErrorInEffectFailure:off -- These fixtures intentionally inspect raw child-process JSON and failures at the process boundary.

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { Readable } from "node:stream";

import {
  BootstrapChildStartError,
  BootstrapSecretClearedError,
  type BootstrapDelivery,
  startBootstrapChild,
} from "./bootstrapChild.ts";

const bootstrap = {
  mode: "desktop",
  noBrowser: true,
  port: 43_219,
  t3Home: "/tmp/t3-tui-bootstrap-test",
  host: "127.0.0.1",
  tailscaleServeEnabled: false,
  tailscaleServePort: 443,
} as const;

const MockChildReceipt = Schema.Struct({
  bootstrapFd: Schema.Int,
  lineCount: Schema.Int,
  tokenLength: Schema.Int,
  tokenIsHex: Schema.Boolean,
  tokenInArgv: Schema.Boolean,
  tokenInEnvironment: Schema.Boolean,
  bootstrap: Schema.Struct({
    mode: Schema.String,
    noBrowser: Schema.Boolean,
    port: Schema.Int,
    t3Home: Schema.String,
    host: Schema.String,
    desktopBootstrapToken: Schema.Literal("<redacted>"),
    tailscaleServeEnabled: Schema.Boolean,
    tailscaleServePort: Schema.Int,
  }),
});

const decodeMockChildReceipt = Schema.decodeUnknownSync(Schema.fromJsonString(MockChildReceipt));

const mockChildSource = String.raw`
import fs from "node:fs";
const fdFlag = process.argv.indexOf("--bootstrap-fd");
const bootstrapFd = Number(process.argv[fdFlag + 1]);
const raw = fs.readFileSync(bootstrapFd, "utf8");
const lines = raw.split("\n").filter((line) => line.length > 0);
const envelope = JSON.parse(lines[0]);
const token = envelope.desktopBootstrapToken;
process.stdout.write(JSON.stringify({
  bootstrapFd,
  lineCount: lines.length,
  tokenLength: token.length,
  tokenIsHex: /^[0-9a-f]{48}$/i.test(token),
  tokenInArgv: process.argv.includes(token),
  tokenInEnvironment: Object.values(process.env).includes(token),
  bootstrap: { ...envelope, desktopBootstrapToken: "<redacted>" },
}) + "\n");
`;

const closeBootstrapInputSource = String.raw`
import fs from "node:fs";
const fdFlag = process.argv.indexOf("--bootstrap-fd");
const bootstrapFd = Number(process.argv[fdFlag + 1]);
fs.closeSync(bootstrapFd);
process.exit(17);
`;

const readAll = (stream: Readable) =>
  Effect.tryPromise({
    try: async () => {
      let contents = "";
      for await (const chunk of stream) {
        contents += String(chunk);
      }
      return contents;
    },
    catch: (cause) => new Error(`Failed to read mock child output: ${String(cause)}`),
  });

const startMockChild = (delivery: BootstrapDelivery) =>
  startBootstrapChild({
    executable: process.execPath,
    args: ["--input-type=module", "--eval", mockChildSource, "--"],
    env: { ...process.env, T3_TUI_BOOTSTRAP_TEST: delivery },
    delivery,
    bootstrap,
  });

describe("bootstrap child transport", () => {
  it.effect.each(["fd3", "stdin"] as const)(
    "writes one bootstrap envelope through %s without exposing its secret",
    (delivery) =>
      Effect.gen(function* () {
        const child = yield* startMockChild(delivery);
        yield* Effect.addFinalizer(() => Effect.sync(() => void child.terminate("SIGKILL")));

        const [stdout, exit] = yield* Effect.all([readAll(child.stdout), child.waitForExit()], {
          concurrency: "unbounded",
        });
        const receipt = decodeMockChildReceipt(stdout.trim());
        const tokenShape = yield* child.useBootstrapToken((token) =>
          Effect.succeed({ length: token.length, isHex: /^[0-9a-f]{48}$/i.test(token) }),
        );

        assert.equal(exit.exitCode, 0);
        assert.isNull(exit.signal);
        assert.equal(receipt.bootstrapFd, delivery === "fd3" ? 3 : 0);
        assert.equal(child.bootstrapFd, receipt.bootstrapFd);
        assert.equal(receipt.lineCount, 1);
        assert.deepEqual(tokenShape, { length: 48, isHex: true });
        assert.equal(receipt.tokenLength, 48);
        assert.isTrue(receipt.tokenIsHex);
        assert.isFalse(receipt.tokenInArgv);
        assert.isFalse(receipt.tokenInEnvironment);
        assert.deepEqual(receipt.bootstrap, {
          ...bootstrap,
          desktopBootstrapToken: "<redacted>",
        });
        assert.deepEqual(JSON.parse(JSON.stringify(child)), {
          pid: child.pid,
          bootstrapFd: delivery === "fd3" ? 3 : 0,
        });
        assert.isTrue(child.isOwnedPid(child.pid));
        assert.isFalse(child.isOwnedPid(child.pid + 1));

        child.clearBootstrapSecret();
        assert.isTrue(child.isBootstrapSecretCleared());
        const cleared = yield* child.useBootstrapToken(() => Effect.void).pipe(Effect.flip);
        assert.instanceOf(cleared, BootstrapSecretClearedError);
      }).pipe(Effect.scoped),
  );

  it.effect("reports an executable failure in the child-spawn phase", () =>
    Effect.gen(function* () {
      const error = yield* startBootstrapChild({
        executable: "/definitely-not-a-t3-tui-executable",
        args: [],
        delivery: "fd3",
        bootstrap,
      }).pipe(Effect.flip);

      assert.instanceOf(error, BootstrapChildStartError);
      assert.equal(error.phase, "child-spawn");
      assert.isUndefined(error.pid);
      assert.notInclude(JSON.stringify(error), "desktopBootstrapToken");
    }),
  );

  it.effect("rejects an invalid envelope before spawning a child", () =>
    Effect.gen(function* () {
      const error = yield* startBootstrapChild({
        executable: "/definitely-not-a-t3-tui-executable",
        args: [],
        delivery: "fd3",
        bootstrap: { ...bootstrap, port: 0 },
      }).pipe(Effect.flip);

      assert.instanceOf(error, BootstrapChildStartError);
      assert.equal(error.phase, "envelope-encoding");
      assert.isUndefined(error.pid);
      assert.notInclude(JSON.stringify(error), "desktopBootstrapToken");
    }),
  );

  it.effect("reports an early child exit in the bootstrap-write phase", () =>
    Effect.gen(function* () {
      const privateHost = "x".repeat(2 * 1024 * 1024);
      const error = yield* startBootstrapChild({
        executable: process.execPath,
        args: ["--input-type=module", "--eval", closeBootstrapInputSource, "--"],
        delivery: "fd3",
        bootstrap: {
          ...bootstrap,
          host: privateHost,
        },
      }).pipe(Effect.flip);

      assert.instanceOf(error, BootstrapChildStartError);
      assert.equal(error.phase, "bootstrap-write");
      assert.isNumber(error.pid);
      assert.notInclude(JSON.stringify(error), privateHost);
      assert.notInclude(JSON.stringify(error), "desktopBootstrapToken");
    }),
  );
});
