import type { BorderCharacters } from "@opentui/core";
import type { BoxProps } from "@opentui/react";

import { useThemeColor, useUi } from "./context.tsx";
import { calculatePanelLayout } from "./layout.ts";
import type { ThemeToken } from "./theme.ts";

const asciiBorderCharacters: BorderCharacters = Object.freeze({
  bottomLeft: "+",
  bottomRight: "+",
  bottomT: "+",
  cross: "+",
  horizontal: "-",
  leftT: "+",
  rightT: "+",
  topLeft: "+",
  topRight: "+",
  topT: "+",
  vertical: "|",
});

type OwnedPanelProps =
  | "backgroundColor"
  | "border"
  | "borderColor"
  | "children"
  | "customBorderChars"
  | "focusedBorderColor"
  | "paddingX"
  | "titleColor";

export interface PanelProps extends Omit<BoxProps, OwnedPanelProps> {
  readonly bordered?: boolean;
  readonly borderTone?: ThemeToken;
  readonly children?: BoxProps["children"];
  readonly paddingX?: number;
}

export function Panel({
  bordered = true,
  borderTone = "border",
  children,
  paddingX = 1,
  width,
  ...props
}: PanelProps) {
  const { capabilities } = useUi();
  const borderColor = useThemeColor(borderTone);
  const focusedBorderColor = useThemeColor("borderFocused");
  const backgroundColor = useThemeColor("panel");
  const titleColor = useThemeColor("text");
  const resolvedPadding =
    typeof width === "number"
      ? calculatePanelLayout({ bordered, paddingX, width }).paddingX
      : Math.max(0, Math.floor(paddingX));

  return (
    <box
      {...props}
      border={bordered}
      paddingX={resolvedPadding}
      {...(backgroundColor ? { backgroundColor } : {})}
      {...(borderColor ? { borderColor } : {})}
      {...(bordered && !capabilities.unicode ? { customBorderChars: asciiBorderCharacters } : {})}
      {...(focusedBorderColor ? { focusedBorderColor } : {})}
      {...(titleColor ? { titleColor } : {})}
      {...(width === undefined ? {} : { width })}
    >
      {children}
    </box>
  );
}
