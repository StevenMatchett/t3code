import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { Rpc } from "effect/rpc";

import { ResolvedKeybindingsConfig } from "./keybindings.ts";

const decode = <S extends Schema.Top>(
  schema: S,
  input: unknown,
): Effect.Effect<Schema.Schema.Type<S>, Schema.SchemaError, never> =>
  Schema.decodeUnknownEffect(schema as never)(input) as Effect.Effect<
    Schema.Schema.Type<S>,
    Schema.SchemaError,
    never
  >;

const shortcut = {
  key: "p",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  modKey: true,
};

it.effect("drops resolved rules with commands this build does not know", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(ResolvedKeybindingsConfig, [
      { command: "terminal.toggle", shortcut },
      { command: "someFuture.toggle", shortcut },
      { command: "filePicker.toggle", shortcut },
    ]);
    assert.deepEqual(
      parsed.map((rule) => rule.command),
      ["terminal.toggle", "filePicker.toggle"],
    );
  }),
);

it.effect("drops unknown commands inside JSON RPC responses", () =>
  Effect.gen(function* () {
    const rpc = Rpc.make("test.getConfig", {
      success: Schema.Struct({ keybindings: ResolvedKeybindingsConfig }),
    });
    const wireSchema = Schema.toCodecJson(Rpc.exitSchema(rpc));
    const known = [
      { command: "terminal.toggle", shortcut },
      { command: "script.build.run", shortcut },
    ] as const;
    const parsed = yield* Schema.decodeEffect(wireSchema)({
      _tag: "Success",
      value: {
        keybindings: [known[0], { command: "someFuture.toggle", shortcut }, known[1]],
      },
    });
    assert.isTrue(Exit.isSuccess(parsed));
    if (Exit.isSuccess(parsed)) {
      assert.deepEqual(parsed.value.keybindings, known);
      const encoded = yield* Schema.encodeEffect(wireSchema)(parsed);
      assert.deepEqual(encoded, { _tag: "Success", value: { keybindings: known } });
    }
  }),
);

it.effect("drops resolved rules with unknown when-node types", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(ResolvedKeybindingsConfig, [
      {
        command: "terminal.toggle",
        shortcut,
        whenAst: { type: "xor", left: 1, right: 2 },
      },
      { command: "terminal.split", shortcut },
    ]);
    assert.deepEqual(
      parsed.map((rule) => rule.command),
      ["terminal.split"],
    );
  }),
);

it.effect("drops malformed resolved rule entries", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(ResolvedKeybindingsConfig, [
      "garbage",
      { command: "terminal.toggle", shortcut },
      null,
    ]);
    assert.deepEqual(
      parsed.map((rule) => rule.command),
      ["terminal.toggle"],
    );
  }),
);
