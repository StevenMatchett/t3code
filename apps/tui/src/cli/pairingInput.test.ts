import { describe, expect, it } from "@effect/vitest";

import { readPairingCredential } from "./pairingInput.ts";

const origin = "http://127.0.0.1:43110";

function input(text: string, isTTY = false) {
  const bytes = new TextEncoder().encode(text);
  return {
    bytes,
    isTTY,
    async *[Symbol.asyncIterator]() {
      yield bytes;
    },
  };
}

describe("pairing stdin", () => {
  it.each(["fixture-token\n", `${origin}/pair#token=fixture-token`])(
    "accepts a token or matching direct link",
    async (text) => {
      const stream = input(text);
      const credential = await readPairingCredential(stream, origin);
      expect(new TextDecoder().decode(credential)).toBe("fixture-token");
      expect(stream.bytes.every((byte) => byte === 0)).toBe(true);
      credential.fill(0);
    },
  );

  it.each([
    { name: "query token", link: `${origin}/pair?token=fixture-token` },
    { name: "root query token", link: `${origin}/?token=fixture-token` },
    {
      name: "hosted link",
      link: `https://app.t3.codes/pair?host=${encodeURIComponent(origin)}#token=fixture-token`,
    },
    { name: "WebSocket link", link: "ws://127.0.0.1:43110/pair#token=fixture-token" },
  ])("accepts the canonical T3 $name format", async ({ link }) => {
    const stream = input(link);
    const credential = await readPairingCredential(stream, origin);
    expect(new TextDecoder().decode(credential)).toBe("fixture-token");
    expect(stream.bytes.every((byte) => byte === 0)).toBe(true);
    credential.fill(0);
  });

  it.each([
    { link: `${origin}/pair`, message: /missing.*token/i },
    {
      link: `https://app.t3.codes/pair?host=https://other.example.test#token=fixture-token`,
      message: /backend.*selected origin/i,
    },
    {
      link: `${origin}/pair?host=https://other.example.test#token=fixture-token`,
      message: /backend.*selected origin/i,
    },
    {
      link: `http://user:fixture-token@127.0.0.1:43110/pair#token=fixture-token`,
      message: /userinfo/i,
    },
    {
      link: `https://app.t3.codes/pair?host=${encodeURIComponent("http://user:fixture-token@127.0.0.1:43110")}#token=fixture-token`,
      message: /userinfo/i,
    },
  ])("rejects $link with a safe specific diagnostic", async ({ link, message }) => {
    const stream = input(link);
    const result = readPairingCredential(stream, origin);
    await expect(result).rejects.toThrow(message);
    await expect(result).rejects.not.toThrow("fixture-token");
    expect(stream.bytes.every((byte) => byte === 0)).toBe(true);
  });

  it.each([
    "",
    "two tokens",
    "https://other.example.test/pair#token=fixture-token",
    "x".repeat(8_193),
  ])("rejects invalid input without echoing it", async (text) => {
    const stream = input(text);
    await expect(readPairingCredential(stream, origin)).rejects.not.toThrow("fixture-token");
    expect(stream.bytes.every((byte) => byte === 0)).toBe(true);
  });

  it("refuses interactive input before reading a token", async () => {
    const stream = input("fixture-token", true);
    await expect(readPairingCredential(stream, origin)).rejects.toThrow("requires a pipe");
    expect(new TextDecoder().decode(stream.bytes)).toBe("fixture-token");
  });
});
