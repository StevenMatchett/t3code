// This is the platform boundary for reading files explicitly dropped into the terminal.
// @effect-diagnostics nodeBuiltinImport:off

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import {
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type UploadChatImageAttachment,
} from "@t3tools/contracts";
import * as Encoding from "effect/Encoding";

const mimeByExtension: Readonly<Record<string, UploadChatImageAttachment["mimeType"]>> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function shellWords(value: string): string[] | null {
  const words: string[] = [];
  let word = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (const character of value.trim()) {
    if (escaped) {
      word += character;
      escaped = false;
    } else if (character === "\\" && quote !== "'") escaped = true;
    else if (quote) {
      if (character === quote) quote = null;
      else word += character;
    } else if (character === "'" || character === '"') quote = character;
    else if (/\s/u.test(character)) {
      if (word) {
        words.push(word);
        word = "";
      }
    } else word += character;
  }
  if (escaped || quote) return null;
  if (word) words.push(word);
  return words;
}

function localPath(value: string): string | null {
  if (value.startsWith("file://")) {
    try {
      return NodeURL.fileURLToPath(value);
    } catch {
      return null;
    }
  }
  return NodePath.isAbsolute(value) ? value : null;
}

/** Terminal file drops arrive as a bracketed paste containing shell-escaped paths. */
export function pastedImagePaths(value: string): readonly string[] | null {
  const words = shellWords(value);
  if (!words?.length) return null;
  const paths = words.map(localPath);
  if (
    paths.some(
      (path) =>
        path === null || mimeByExtension[NodePath.extname(path).toLocaleLowerCase()] === undefined,
    )
  )
    return null;
  return paths as string[];
}

/** Finds a shell-escaped image path sequence appended to ordinary composer text. */
export function trailingPastedImagePaths(
  value: string,
): { readonly start: number; readonly paths: readonly string[] } | null {
  const starts = new Set([0]);
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character === "/" || value.startsWith("file://", index)) starts.add(index);
    if (
      (character === "'" || character === '"') &&
      (value[index + 1] === "/" || value.startsWith("file://", index + 1))
    )
      starts.add(index);
    if (escaped) {
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = null;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/u.test(character)) {
      starts.add(index + 1);
    }
  }
  for (const start of [...starts].sort((left, right) => left - right)) {
    const paths = pastedImagePaths(value.slice(start));
    if (paths) return { start, paths };
  }
  return null;
}

export async function loadImageAttachment(path: string): Promise<UploadChatImageAttachment> {
  const name = NodePath.basename(path);
  const mimeType = mimeByExtension[NodePath.extname(path).toLocaleLowerCase()];
  if (!mimeType) throw new Error(`'${name}' is not a supported image.`);
  const info = await NodeFSP.stat(path);
  if (!info.isFile()) throw new Error(`'${name}' is not a file.`);
  if (info.size === 0) throw new Error(`'${name}' is empty.`);
  if (info.size > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)
    throw new Error(`'${name}' exceeds the 10 MB image limit.`);
  const bytes = await NodeFSP.readFile(path);
  const id = `tui-${Encoding.encodeHex(globalThis.crypto.getRandomValues(new Uint8Array(16)))}`;
  return {
    type: "image",
    id,
    name,
    mimeType,
    sizeBytes: bytes.byteLength,
    dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
  };
}
