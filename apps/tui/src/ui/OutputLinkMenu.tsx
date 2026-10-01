import type { BoxRenderable, KeyEvent } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { useState, type RefObject } from "react";
import { openBrowser } from "../platform/browser.ts";
import { Panel } from "./Panel.tsx";
import { SelectionRow } from "./SelectionRow.tsx";
import { Stack } from "./primitives.tsx";

export function useOutputLinkMenu({
  active,
  width,
  height,
  container,
}: {
  active: boolean;
  width: number;
  height: number;
  container: RefObject<BoxRenderable | null>;
}) {
  const renderer = useRenderer();
  const [menu, setMenu] = useState<{ href: string; x: number; y: number; selected: number } | null>(
    null,
  );
  const [notice, setNotice] = useState("");
  const select = (index: number) => {
    setMenu((current) =>
      current === null || current.selected === index ? current : { ...current, selected: index },
    );
  };
  const menuWidth = Math.min(20, width);
  const open = (href: string, position: { x: number; y: number }) => {
    if (!active) return;
    renderer.clearSelection();
    setNotice("");
    setMenu({
      href,
      x: Math.max(0, Math.min(width - menuWidth, position.x - (container.current?.screenX ?? 0))),
      y: Math.max(0, Math.min(height - 4, position.y - (container.current?.screenY ?? 0))),
      selected: 0,
    });
  };
  const choose = (index: number) => {
    if (!menu) return;
    const href = menu.href;
    setMenu(null);
    if (index === 0) {
      const copied = renderer.copyToClipboardOSC52(href);
      setNotice(copied ? "Copied link" : "Clipboard unavailable");
    } else {
      setNotice("Opening link...");
      void openBrowser(href).then(
        (opened) => setNotice(opened ? "Opened in browser" : "Browser unavailable · copy the link"),
        () => setNotice("Could not open browser · copy the link"),
      );
    }
  };
  return {
    open,
    isOpen: active && menu !== null,
    notice,
    handleKey: (key: KeyEvent) => {
      if (!active || !menu) return false;
      if (key.name === "escape") setMenu(null);
      else if (key.name === "up" || key.name === "down" || key.name === "tab")
        setMenu({ ...menu, selected: 1 - menu.selected });
      else if ((key.name === "return" || key.name === "enter") && !key.repeated)
        choose(menu.selected);
      return true;
    },
    element:
      active && menu ? (
        <Stack
          id="output-link-menu-backdrop"
          position="absolute"
          top={0}
          left={0}
          width="100%"
          height="100%"
          zIndex={100}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setMenu(null);
          }}
        >
          <Panel
            id="output-link-menu"
            position="absolute"
            top={menu.y}
            left={menu.x}
            width={menuWidth}
            height={4}
            borderTone="borderFocused"
            flexDirection="column"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            {["Copy link", "Go to link"].map((label, index) => (
              <Stack
                key={label}
                id={`output-link-menu-${index}`}
                height={1}
                width="100%"
                onMouseOver={() => select(index)}
                onMouseMove={() => select(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.button === 0) choose(index);
                }}
              >
                <SelectionRow label={label} selected={index === menu.selected} />
              </Stack>
            ))}
          </Panel>
        </Stack>
      ) : null,
  };
}
