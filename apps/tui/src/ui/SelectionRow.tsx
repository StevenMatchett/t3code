import type { ReactNode } from "react";
import { useThemeColor } from "./context.tsx";
import { Stack, Text } from "./primitives.tsx";
import { inlineTerminalText } from "./textLayout.ts";

export function SelectionRow({
  label,
  selected,
  active = true,
  trailing,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly active?: boolean;
  readonly trailing?: ReactNode;
}) {
  const background = useThemeColor("selection");
  return (
    <Stack
      height={1}
      flexShrink={0}
      width="100%"
      flexDirection="row"
      {...(selected && background ? { backgroundColor: background } : {})}
    >
      <Text
        height={1}
        flexGrow={1}
        minWidth={0}
        wrapMode="none"
        truncate
        tone={selected && active ? "accent" : selected ? "text" : "muted"}
        strong={selected && active}
      >
        {`${selected ? ">" : " "} ${inlineTerminalText(label)}`}
      </Text>
      {trailing}
    </Stack>
  );
}
