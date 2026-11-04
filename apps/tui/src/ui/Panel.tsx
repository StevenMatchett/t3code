import type { BorderCharacters } from "@opentui/core";
import type { BoxProps } from "@opentui/react";

import { useThemeColor, useUi } from "./context.tsx";
import { calculatePanelLayout } from "./layout.ts";
import type { ThemeToken } from "./theme.ts";

export const asciiBorderCharacters: BorderCharacters = Object.freeze({
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

/**
 * Without color a panel has no background to cover what is behind it, so floating panels paint
 * blank cells first. The parent clips them to its own size.
 */
function OpaqueFill() {
  return (
    <text position="absolute" top={0} left={0} wrapMode="none" selectable={false}>
      {Array.from({ length: 120 }, () => " ".repeat(300)).join("\n")}
    </text>
  );
}

export function Panel({
  bordered = true,
  borderTone = "border",
  children,
  paddingX = 1,
  width,
  title,
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
      {...(props.position === "absolute" ? { overflow: "hidden" as const } : {})}
      {...(title === undefined
        ? {}
        : {
            // Without color a border cannot show focus, so the title marks it.
            title: !capabilities.color && borderTone === "borderFocused" ? `${title} *` : title,
          })}
      border={bordered}
      paddingX={resolvedPadding}
      {...(backgroundColor ? { backgroundColor } : {})}
      {...(borderColor ? { borderColor } : {})}
      {...(bordered && !capabilities.unicode ? { customBorderChars: asciiBorderCharacters } : {})}
      {...(focusedBorderColor ? { focusedBorderColor } : {})}
      {...(titleColor ? { titleColor } : {})}
      {...(width === undefined ? {} : { width })}
    >
      {props.position === "absolute" && !capabilities.color ? <OpaqueFill /> : null}
      {children}
    </box>
  );
}
