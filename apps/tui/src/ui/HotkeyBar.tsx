import stringWidth from "string-width";
import { Stack, Text } from "./primitives.tsx";
import { useThemeColor } from "./context.tsx";

export interface HotkeyHint {
  readonly key: string;
  readonly label: string;
}

export interface HotkeyState {
  readonly context: string;
  readonly hints: readonly HotkeyHint[];
}

export function HotkeyBar({
  context,
  hints,
  width,
}: {
  readonly context: string;
  readonly hints: readonly HotkeyHint[];
  readonly width: number;
}) {
  const keyBackground = useThemeColor("selection");
  const rows: [HotkeyHint[], HotkeyHint[]] = [[], []];
  let row = 0;
  let used = stringWidth(context) + 1;
  for (const hint of hints) {
    const hintWidth = stringWidth(hint.key) + stringWidth(hint.label) + 4;
    if (row === 0 && rows[0].length > 0 && used + hintWidth > width) {
      row = 1;
      used = 0;
    }
    rows[row]!.push(hint);
    used += hintWidth;
  }
  return (
    <Stack
      id="active-hotkeys"
      height={2}
      width="100%"
      flexShrink={0}
      flexDirection="column"
      overflow="hidden"
    >
      {rows.map((hintsInRow, rowIndex) => (
        <Stack
          key={rowIndex === 0 ? "primary" : "secondary"}
          height={1}
          width="100%"
          flexShrink={0}
          flexDirection="row"
          overflow="hidden"
          gap={1}
        >
          {rowIndex === 0 ? (
            <Text height={1} flexShrink={0} tone="muted" strong>
              {context.toUpperCase()}
            </Text>
          ) : null}
          {hintsInRow.map((hint) => (
            <Stack key={`${hint.key}:${hint.label}`} height={1} flexShrink={0} flexDirection="row">
              <Stack
                height={1}
                flexShrink={0}
                {...(keyBackground ? { backgroundColor: keyBackground } : {})}
              >
                <Text height={1} tone="accent" strong>{` ${hint.key} `}</Text>
              </Stack>
              <Text height={1} tone="muted">{` ${hint.label}`}</Text>
            </Stack>
          ))}
        </Stack>
      ))}
    </Stack>
  );
}
