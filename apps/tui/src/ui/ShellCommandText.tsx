import type { ConversationLine } from "./conversationLines.ts";
import { TextAttributes } from "@opentui/core";
import { useUi } from "./context.tsx";
import { Stack, Text } from "./primitives.tsx";
import { shellHighlightTokens, type ShellTokenKind } from "./shellHighlight.ts";
import type { ThemeToken } from "./theme.ts";
import { textMatches } from "./textSearch.ts";

const themeKey: Record<Exclude<ShellTokenKind, "plain">, ThemeToken> = {
  command: "syntaxCommand",
  flag: "syntaxFlag",
  operator: "syntaxOperator",
  string: "syntaxString",
  variable: "syntaxVariable",
  number: "syntaxNumber",
};

export function ConversationText({
  line,
  search = "",
  selection,
  onToggleToolGroup,
}: {
  readonly line: ConversationLine;
  readonly search?: string;
  readonly selection?:
    | { readonly start: number; readonly end: number; readonly cursor?: boolean }
    | undefined;
  readonly onToggleToolGroup?: (id: string) => void;
}) {
  const { capabilities, theme } = useUi();
  const matches = selection ? [selection] : textMatches(line.text, search);
  const highlight = (text: string, start: number) => {
    const parts = [];
    let cursor = 0;
    for (const match of matches) {
      const from = Math.max(0, match.start - start);
      const to = Math.min(text.length, Math.max(match.start + 1, match.end) - start);
      if (from >= to) continue;
      parts.push(text.slice(cursor, from));
      parts.push(
        <span
          key={from}
          attributes={
            selection && capabilities.color
              ? TextAttributes.BOLD
              : TextAttributes.INVERSE | TextAttributes.BOLD
          }
          {...(selection && capabilities.color
            ? {
                fg: theme.panel,
                bg: selection.cursor ? theme.text : theme.accent,
              }
            : {})}
        >
          {text.slice(from, to)}
        </span>,
      );
      cursor = to;
    }
    parts.push(text.slice(cursor));
    return parts;
  };
  let offset = 0;
  const backgroundColor = line.highlight && capabilities.color ? theme.selection : undefined;
  return (
    <Stack
      height={1}
      flexShrink={0}
      width="100%"
      flexDirection="row"
      paddingX={line.highlight ? 1 : 0}
      onMouseDown={(event) => {
        if (event.button === 0 && line.toolGroupId && onToggleToolGroup) {
          onToggleToolGroup(line.toolGroupId);
        }
      }}
      {...(backgroundColor ? { backgroundColor } : {})}
    >
      <Text
        height={1}
        wrapMode="none"
        tone={line.tone}
        strong={line.strong}
        {...(line.highlight && !capabilities.color ? { attributes: TextAttributes.INVERSE } : {})}
      >
        {line.spans?.length
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
                  {highlight(span.text, offset - span.text.length)}
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
                    {highlight(token.text, offset - token.text.length)}
                  </span>
                );
              })
            : highlight(line.text || (selection ? " " : ""), 0)}
      </Text>
    </Stack>
  );
}
