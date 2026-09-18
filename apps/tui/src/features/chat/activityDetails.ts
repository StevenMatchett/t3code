import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { normalizeTerminalText } from "./terminalText.ts";

const record = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown));
const array = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown));
const string = Schema.decodeUnknownOption(Schema.String);
const text = (value: unknown) => Option.getOrUndefined(string(value));
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
  const input = Option.getOrNull(record(data?.rawInput ?? data?.input));
  const command = text(data?.command) ?? text(input?.command) ?? text(payload?.command);
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
