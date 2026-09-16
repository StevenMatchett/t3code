import type { BoxProps as OpenTuiBoxProps, TextProps as OpenTuiTextProps } from "@opentui/react";

export interface StackProps extends OpenTuiBoxProps {}

export function Stack(props: StackProps) {
  return <box {...props} />;
}

export interface TextProps extends OpenTuiTextProps {}

export function Text(props: TextProps) {
  return <text {...props} />;
}
