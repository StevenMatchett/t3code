import type { BoxProps as OpenTuiBoxProps, TextProps as OpenTuiTextProps } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import { useThemeColor } from "./context.tsx";
import type { ThemeToken } from "./theme.ts";

export interface StackProps extends OpenTuiBoxProps {}

export function Stack(props: StackProps) {
  return <box {...props} />;
}

export interface TextProps extends OpenTuiTextProps {
  readonly tone?: ThemeToken;
  readonly strong?: boolean;
}

export function Text({ tone = "text", strong = false, attributes, ...props }: TextProps) {
  const color = useThemeColor(tone);
  return (
    <text
      {...(color ? { fg: color } : {})}
      {...props}
      attributes={(attributes ?? 0) | (strong ? TextAttributes.BOLD : 0)}
    />
  );
}
