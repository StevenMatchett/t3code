import { useTerminalDimensions } from "@opentui/react";
import type { ReactNode } from "react";
import { clampBox } from "./layout.ts";
import { Panel } from "./Panel.tsx";
import { Stack } from "./primitives.tsx";

/** A centered box above everything, clamped to the terminal. Clicks never fall through it. */
export function Dialog({
  id,
  title,
  width,
  height,
  gap,
  paddingTop,
  children,
  zIndex = 100,
}: {
  readonly id: string;
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly gap?: number;
  readonly paddingTop?: number;
  readonly zIndex?: number;
  readonly children?: ReactNode;
}) {
  const terminal = useTerminalDimensions();
  const box = clampBox(
    { width: terminal.width - 2, height: terminal.height - 2 },
    { width, height },
  );
  return (
    <Stack
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      zIndex={zIndex}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <Panel
        id={id}
        title={title}
        position="absolute"
        left={box.left + 1}
        top={box.top + 1}
        width={box.width}
        height={box.height}
        flexDirection="column"
        borderTone="borderFocused"
        {...(gap === undefined ? {} : { gap })}
        {...(paddingTop === undefined ? {} : { paddingTop })}
      >
        {children}
      </Panel>
    </Stack>
  );
}
