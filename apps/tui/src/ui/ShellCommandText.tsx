import type { ConversationLine } from "./conversationLines.ts";
import { TextAttributes } from "@opentui/core";
import { useUi } from "./context.tsx";
import { Stack, Text } from "./primitives.tsx";
import { shellHighlightTokens, type ShellTokenKind } from "./shellHighlight.ts";
import type { ThemeToken } from "./theme.ts";

const themeKey: Record<Exclude<ShellTokenKind, "plain">, ThemeToken> = {
  command: "syntaxCommand",
  flag: "syntaxFlag",
  operator: "syntaxOperator",
  string: "syntaxString",
  variable: "syntaxVariable",
  number: "syntaxNumber",
};

export function ConversationText({ line }: { readonly line: ConversationLine }) {
  const { capabilities, theme } = useUi();
  let offset = 0;
  const backgroundColor = line.highlight && capabilities.color ? theme.selection : undefined;
  return (
    <Stack
      height={1}
      flexShrink={0}
      width="100%"
      flexDirection="row"
      paddingX={line.highlight ? 1 : 0}
      {...(backgroundColor ? { backgroundColor } : {})}
    >
      <Text
        height={1}
        wrapMode="none"
        tone={line.tone}
        strong={line.strong}
        {...(line.highlight && !capabilities.color ? { attributes: TextAttributes.INVERSE } : {})}
      >
        {line.spans
          ? line.spans.map((span) => {
              const key = String(offset);
              offset += span.text.length;
              const attributes =
                (span.bold ? TextAttributes.BOLD : 0) | (span.italic ? TextAttributes.ITALIC : 0);
              return (
                <span
                  key={key}
                  attributes={attributes}
                  {...(span.code && capabilities.color
                    ? { fg: theme.syntaxString, bg: theme.selection }
                    : {})}
                >
                  {span.text}
                </span>
              );
            })
          : line.shell
            ? shellHighlightTokens(line.text).map((token) => {
                const key = `${offset}:${token.text}`;
                offset += token.text.length;
                const color =
                  capabilities.color && token.kind !== "plain" ? theme[themeKey[token.kind]] : null;
                return (
                  <span key={key} {...(color ? { fg: color } : {})}>
                    {token.text}
                  </span>
                );
              })
            : line.text}
      </Text>
    </Stack>
  );
}
