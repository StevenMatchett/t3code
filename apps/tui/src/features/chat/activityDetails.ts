import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { normalizeTerminalText } from "./terminalText.ts";

const record = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown));
const array = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown));
const string = Schema.decodeUnknownOption(Schema.String);
const text = (value: unknown) => Option.getOrUndefined(string(value));
const commandText = (value: unknown) => {
  const direct = text(value)?.trim();
  if (direct) return direct;
  const parts = Option.getOrUndefined(array(value))
    ?.map((part) => text(part)?.trim())
    .filter((part): part is string => Boolean(part));
  return parts?.length ? parts.join(" ") : undefined;
};
const inline = (value: string) => normalizeTerminalText(value).replace(/\n/gu, " ").trim();
const pathKeys = [
  "path",
  "filePath",
  "file_path",
  "relativePath",
  "filename",
  "newPath",
  "oldPath",
];
const nestedKeys = [
  "item",
  "result",
  "input",
  "rawInput",
  "data",
  "changes",
  "files",
  "edits",
  "patches",
  "operations",
];

export function toolActivityDetails(payloadValue: unknown) {
  const payload = Option.getOrNull(record(payloadValue));
  const data = Option.getOrNull(record(payload?.data));
  const item = Option.getOrNull(record(data?.item));
  const input = Option.getOrNull(record(data?.rawInput ?? data?.input ?? item?.input));
  const result = Option.getOrNull(record(item?.result));
  const actionCommand = Option.getOrUndefined(array(item?.commandActions))
    ?.map((action) => Option.getOrNull(record(action)))
    .find((action) => commandText(action?.command));
  const command =
    commandText(actionCommand?.command) ??
    commandText(item?.command) ??
    commandText(input?.command) ??
    commandText(result?.command) ??
    commandText(data?.command) ??
    commandText(payload?.command) ??
    (payload?.itemType === "command_execution" ? text(payload.detail) : undefined);
  const name = text(data?.toolName) ?? text(payload?.title);
  const paths = new Set<string>();
  let remaining = 256;
  const collect = (value: unknown, depth: number) => {
    if (depth > 4 || remaining-- <= 0 || paths.size >= 24) return;
    const entries = array(value);
    if (Option.isSome(entries)) {
      for (const item of entries.value.slice(0, 64)) collect(item, depth + 1);
      return;
    }
    const object = Option.getOrNull(record(value));
    if (!object) return;
    for (const key of pathKeys) {
      const path = text(object[key]);
      if (path?.trim()) paths.add(inline(path));
    }
    for (const key of nestedKeys) collect(object[key], depth + 1);
  };
  collect(data, 0);
  return {
    ...(name ? { name: inline(name) } : {}),
    ...(command ? { command: inline(command) } : {}),
    files: [...paths],
  };
}
