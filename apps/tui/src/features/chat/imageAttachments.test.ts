// @effect-diagnostics nodeBuiltinImport:off

import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import {
  loadImageAttachment,
  pastedImagePaths,
  trailingPastedImagePaths,
} from "./imageAttachments.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => NodeFSP.rm(path, { recursive: true })),
  );
});

describe("terminal image attachments", () => {
  it("parses quoted, escaped, and file URL image paths without claiming normal text", () => {
    expect(pastedImagePaths("'/tmp/first image.png' /tmp/second\\ image.webp")).toEqual([
      "/tmp/first image.png",
      "/tmp/second image.webp",
    ]);
    expect(pastedImagePaths("file:///tmp/photo%20one.jpg")).toEqual(["/tmp/photo one.jpg"]);
    expect(pastedImagePaths("hello from the clipboard")).toBeNull();
    expect(pastedImagePaths("/tmp/notes.txt")).toBeNull();
    expect(trailingPastedImagePaths("review this/tmp/screen\\ shot.png")).toEqual({
      start: 11,
      paths: ["/tmp/screen shot.png"],
    });
    expect(trailingPastedImagePaths("review this'/tmp/screen shot.png'")).toEqual({
      start: 11,
      paths: ["/tmp/screen shot.png"],
    });
  });

  it("loads a dropped image as an inline upload", async () => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-tui-image-"));
    temporaryDirectories.push(directory);
    const path = NodePath.join(directory, "pixel.png");
    await NodeFSP.writeFile(path, Uint8Array.from([137, 80, 78, 71]));

    const attachment = await loadImageAttachment(path);

    expect(attachment).toMatchObject({
      type: "image",
      name: "pixel.png",
      mimeType: "image/png",
      sizeBytes: 4,
      dataUrl: "data:image/png;base64,iVBORw==",
    });
    expect(attachment.id).toMatch(/^tui-/u);
  });
});
