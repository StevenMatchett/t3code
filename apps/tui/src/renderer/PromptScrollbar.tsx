import { ScrollBarRenderable, type BoxRenderable, type TextareaRenderable } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { useLayoutEffect, useRef, type RefObject } from "react";
import { useThemeColor } from "../ui/context.tsx";
import { Stack } from "../ui/primitives.tsx";

export function PromptScrollbar({
  editor,
}: {
  readonly editor: RefObject<TextareaRenderable | null>;
}) {
  const renderer = useRenderer();
  const host = useRef<BoxRenderable | null>(null);
  const syncing = useRef(false);
  const scrollbar = useRef<ScrollBarRenderable | null>(null);
  const background = useThemeColor("border");
  const foreground = useThemeColor("muted");
  useLayoutEffect(() => {
    const container = host.current;
    if (!container) return;
    const bar = new ScrollBarRenderable(renderer, {
      id: "prompt-scrollbar",
      orientation: "vertical",
      showArrows: false,
      width: 1,
      height: "100%",
      trackOptions: {
        ...(background ? { backgroundColor: background } : {}),
        ...(foreground ? { foregroundColor: foreground } : {}),
      },
      onChange: (position) => {
        const current = editor.current;
        if (!current || syncing.current) return;
        const viewport = current.editorView.getViewport();
        current.editorView.setViewport(
          viewport.offsetX,
          position,
          viewport.width,
          viewport.height,
          true,
        );
        current.requestRender();
      },
    });
    container.add(bar);
    scrollbar.current = bar;
    return () => {
      scrollbar.current = null;
      if (bar.parent === container) container.remove(bar);
      bar.destroyRecursively();
    };
  }, [renderer, editor, background, foreground]);
  return (
    <Stack
      ref={host}
      width={1}
      height="100%"
      flexShrink={0}
      renderBefore={() => {
        const current = editor.current;
        const bar = scrollbar.current;
        if (!current || !bar) return;
        // Read the actual viewport after layout, including mouse scrolling and wrapping.
        syncing.current = true;
        try {
          bar.scrollSize = current.editorView.getTotalVirtualLineCount();
          bar.viewportSize = current.height;
          bar.scrollPosition = current.scrollY;
        } finally {
          syncing.current = false;
        }
      }}
    />
  );
}
