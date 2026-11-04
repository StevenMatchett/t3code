import type { BoxProps as OpenTuiBoxProps, TextProps as OpenTuiTextProps } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import { useThemeColor, useUi } from "./context.tsx";
import type { ThemeToken } from "./theme.ts";

export interface StackProps extends OpenTuiBoxProps {}

export function Stack(props: StackProps) {
  return <box {...props} />;
}

export interface TextProps extends OpenTuiTextProps {
  readonly tone?: ThemeToken;
  readonly strong?: boolean;
  readonly dim?: boolean;
}

const ASCII_PUNCTUATION: ReadonlyArray<readonly [string, string]> = [
  ["·", "-"],
  ["…", "..."],
  ["—", "-"],
  ["–", "-"],
  ["›", ">"],
  ["★", "*"],
  ["↕", "^v"],
  ["▼", "v"],
  ["•", "*"],
];

/** Interface copy uses a little punctuation beyond ASCII, so terminals without it get plain text. */
export function asciiPunctuation(text: string) {
  return ASCII_PUNCTUATION.reduce((result, [from, to]) => result.replaceAll(from, to), text);
}

export function Text({
  tone = "text",
  strong = false,
  dim = false,
  attributes,
  children,
  ...props
}: TextProps) {
  const { capabilities } = useUi();
  const color = useThemeColor(tone);
  const asciiChild = (child: unknown) =>
    typeof child === "string" ? asciiPunctuation(child) : child;
  const content = capabilities.unicode
    ? children
    : Array.isArray(children)
      ? (children.map(asciiChild) as typeof children)
      : (asciiChild(children) as typeof children);
  return (
    <text
      {...(color ? { fg: color } : {})}
      {...props}
      attributes={
        (attributes ?? 0) | (strong ? TextAttributes.BOLD : 0) | (dim ? TextAttributes.DIM : 0)
      }
    >
      {content}
    </text>
  );
}
