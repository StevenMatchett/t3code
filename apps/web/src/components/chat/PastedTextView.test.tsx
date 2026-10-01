import { EnvironmentId } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { PastedTextView } from "./PastedTextView";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn<() => Promise<string | null>>() }));

vi.mock("~/assets/assetUrls", () => ({ useAssetUrlRefresh: () => refresh }));
vi.mock("~/hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: () => ({ copyToClipboard: vi.fn(), isCopied: false }),
}));
vi.mock("~/hooks/useSettings", () => ({
  useClientSettings: () => false,
  useUpdateClientSettings: () => vi.fn(),
}));
vi.mock("~/components/ChatMarkdown", () => ({ default: () => null }));
vi.mock("~/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../files/ReadOnlySourcePreview", () => ({
  default: ({ text }: { text: string }) => <pre>{text}</pre>,
}));
vi.mock("../files/fileSurfaceChrome", () => ({
  FILE_SURFACE_SUBHEADER_CLASS: "",
  FileSurfaceAction: () => null,
  FileSurfaceFailure: ({ message }: { message: string }) => <div role="alert">{message}</div>,
  FileSurfaceLoading: () => <div role="status">Loading</div>,
  FileSurfaceNotice: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe("pasted text visibility", () => {
  let renderer: ReactTestRenderer;
  const text = "Dictated text\n".repeat(3000) + "The end of the dictation.";

  beforeEach(async () => {
    await import("../files/ReadOnlySourcePreview");
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    refresh.mockReset().mockResolvedValue("https://environment.test/paste.txt");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(text)),
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:paste");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  afterEach(async () => {
    if (renderer) await act(() => renderer.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const toggle = async () => {
    await act(async () => renderer.root.findByType("button").props.onClick());
  };

  it("shows the entire local paste, collapses it, and can reveal it again", async () => {
    const file = new File([text], "pasted-text.txt", { type: "text/plain" });
    vi.spyOn(file, "stream").mockImplementation(() => new Response(text).body!);
    await act(async () => {
      renderer = create(
        <PastedTextView
          files={[
            {
              id: "paste",
              name: file.name,
              mimeType: file.type,
              sizeBytes: file.size,
              file,
            },
          ]}
        />,
      );
    });
    expect(renderer.root.findAllByType("pre")).toHaveLength(0);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    await toggle();
    expect(renderer.root.findByType("pre").children).toEqual([text]);
    await toggle();
    expect(renderer.root.findAllByType("pre")).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:paste");
    await toggle();
    expect(renderer.root.findByType("pre").children).toEqual([text]);
    expect(await file.text()).toBe(text);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("loads a sent paste from its environment only when revealed", async () => {
    await act(async () => {
      renderer = create(
        <PastedTextView
          files={[
            {
              id: "sent",
              name: "pasted-text.txt",
              mimeType: "text/plain",
              sizeBytes: text.length,
              asset: { environmentId: EnvironmentId.make("remote"), attachmentId: "sent" },
            },
          ]}
        />,
      );
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    await toggle();
    expect(renderer.root.findByType("pre").children).toEqual([text]);
    expect(fetch).toHaveBeenCalledWith("https://environment.test/paste.txt", expect.any(Object));
    await toggle();
    expect(renderer.root.findAllByType("pre")).toHaveLength(0);
  });
});
