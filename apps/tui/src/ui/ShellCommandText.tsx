import type { ConversationLine } from "./conversationLines.ts";
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
  return (
    <Stack
      height={1}
      flexShrink={0}
      width="100%"
      flexDirection="row"
      justifyContent={line.align === "right" ? "flex-end" : "flex-start"}
    >
      <Text height={1} wrapMode="none" tone={line.tone} strong={line.strong}>
        {line.shell
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
