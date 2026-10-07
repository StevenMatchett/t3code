import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { TuiCommand } from "../commands.ts";
import { ClientOrchestrationCommand } from "./contracts.ts";
import { currentClient } from "./rpc.ts";

const decodeCommand = Schema.decodeUnknownEffect(ClientOrchestrationCommand);
export const encodeV1Command = Effect.fn(function* (command: TuiCommand) {
  return yield* decodeCommand({
    ...command,
    commandId: command.commandId ?? (yield* (yield* Crypto.Crypto).randomUUIDv4.pipe(Effect.orDie)),
    createdAt: command.createdAt ?? DateTime.formatIso(yield* DateTime.now),
    type: command.type === "project.update" ? "project.meta.update" : command.type,
  });
});
export const executeV1Command = Effect.fn("tui.v1.command")(function* (command: TuiCommand) {
  const input = yield* encodeV1Command(command);
  const client = yield* currentClient;
  return yield* client["orchestration.dispatchCommand"](input);
});
