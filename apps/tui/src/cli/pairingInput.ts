import { RemotePairingTokenMissingError, resolveRemotePairingTarget } from "@t3tools/shared/remote";
import * as Schema from "effect/Schema";

import { TuiCliUsageError } from "./options.ts";

const isPairingTokenMissing = Schema.is(RemotePairingTokenMissingError);

export async function readPairingCredential(
  input: AsyncIterable<Uint8Array> & { readonly isTTY?: boolean },
  expectedOrigin: string,
): Promise<Uint8Array> {
  if (input.isTTY) {
    throw new TuiCliUsageError(
      "--pair-stdin requires a pipe. Do not put a pairing token in command arguments.",
    );
  }
  const buffer = new Uint8Array(8_192);
  let length = 0;
  try {
    for await (const chunk of input) {
      try {
        if (length + chunk.byteLength > buffer.byteLength) {
          throw new TuiCliUsageError("Pairing input exceeds the size limit.");
        }
        buffer.set(chunk, length);
        length += chunk.byteLength;
      } finally {
        chunk.fill(0);
      }
    }
    const text = new TextDecoder().decode(buffer.subarray(0, length)).trim();
    if (!text)
      throw new TuiCliUsageError(
        "Pairing input is empty. Copy a complete pairing link or token first.",
      );
    const url = URL.parse(text);
    if (url?.username || url?.password) {
      throw new TuiCliUsageError("Pairing links must not contain URL userinfo.");
    }
    let target;
    try {
      target = resolveRemotePairingTarget(
        url ? { pairingUrl: text } : { host: expectedOrigin, pairingCode: text },
      );
    } catch (error) {
      throw new TuiCliUsageError(
        isPairingTokenMissing(error)
          ? "The pairing link is missing its token. Copy the complete link from T3 Code's Connections settings."
          : "Pairing input is invalid. Supply one complete T3 pairing link or pairing token.",
      );
    }
    const backend = new URL(target.httpBaseUrl);
    if (backend.username || backend.password) {
      throw new TuiCliUsageError("Pairing backends must not contain URL userinfo.");
    }
    if (backend.origin !== URL.parse(expectedOrigin)?.origin) {
      throw new TuiCliUsageError(
        "The pairing link's backend differs from the selected origin. Set --connect to its exact scheme, hostname, and port; localhost and 127.0.0.1 are different origins.",
      );
    }
    if (/\s/.test(target.credential)) {
      throw new TuiCliUsageError(
        "The pairing token contains whitespace. Copy only the complete link or token, not surrounding text.",
      );
    }
    return new TextEncoder().encode(target.credential);
  } finally {
    buffer.fill(0);
  }
}
