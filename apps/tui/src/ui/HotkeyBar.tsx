import stringWidth from "string-width";
import { actionKeyLabel, asciiKeyLabel, formatChord } from "../app/actions.ts";
import { Stack, Text } from "./primitives.tsx";
import { useThemeColor, useUi } from "./context.tsx";
import { useActiveActions, type ActiveAction } from "./keymap.ts";

export interface HotkeyHint {
  readonly key: string;
  readonly label: string;
}

const hintWidth = (hint: HotkeyHint) =>
  stringWidth(hint.key) + 2 + (hint.label ? stringWidth(hint.label) + 1 : 0);

/** The key shown for an action here: `?` becomes F1 while a text field owns printable keys. */
function hintKey(action: ActiveAction, unicode: boolean) {
  const { definition, reachableKeys } = action;
  if (definition.keyLabel && reachableKeys.includes(definition.keys[0]!))
    return actionKeyLabel(definition, unicode);
  const first = reachableKeys[0];
  return first === undefined ? null : formatChord(first, unicode);
}

export function hintsFromActions(actions: readonly ActiveAction[], unicode = true) {
  return actions
    .flatMap((action) => {
      const key = hintKey(action, unicode);
      if (key === null || action.definition.hint === undefined) return [];
      return [
        {
          id: action.id,
          key,
          label: action.label ?? action.title,
          priority: action.definition.hint,
          // Layers arrive top first, so the focused region wins ties.
        },
      ];
    })
    .toSorted((left, right) => right.priority - left.priority);
}

/**
 * Picks hints for two rows by priority, always keeping the pinned ones. The most useful keys stay
 * visible at every width, and nothing is ever cut mid-word.
 */
export function layoutHints(
  context: string,
  hints: readonly (HotkeyHint & { readonly priority: number })[],
  width: number,
) {
  // Below this width the pinned keys drop their labels rather than disappear.
  const pinned = hints
    .filter((hint) => hint.priority >= 100)
    .map((hint) => (width < 60 ? { ...hint, label: "" } : hint));
  const pinnedWidth = pinned.reduce((sum, hint) => sum + hintWidth(hint) + 1, 0);
  const contextWidth = stringWidth(context) + 1;
  const showContext = contextWidth + 18 <= width;
  const rows: [HotkeyHint[], HotkeyHint[]] = [[], []];
  let first = showContext ? contextWidth : 0;
  let second = pinnedWidth;
  for (const hint of hints) {
    if (hint.priority >= 100) continue;
    const size = hintWidth(hint) + 1;
    if (first + size <= width) {
      rows[0].push(hint);
      first += size;
    } else if (second + size <= width) {
      rows[1].push(hint);
      second += size;
    }
  }
  if (second > width) return { showContext, rows: [rows[0], rows[1]] as const, pinned: [] };
  return { showContext, rows: [rows[0], rows[1]] as const, pinned };
}

function Hint({ hint, keyBackground }: { hint: HotkeyHint; keyBackground: string | undefined }) {
  return (
    <Stack height={1} flexShrink={0} flexDirection="row">
      <Stack
        height={1}
        flexShrink={0}
        {...(keyBackground ? { backgroundColor: keyBackground } : {})}
      >
        <Text height={1} tone="accent" strong>{` ${hint.key} `}</Text>
      </Stack>
      {hint.label ? <Text height={1} tone="muted">{` ${hint.label}`}</Text> : null}
    </Stack>
  );
}

/** Two reserved rows of hints for whatever has focus, derived from the action table. */
export function HotkeyBar({
  width,
  notice,
}: {
  readonly width: number;
  readonly notice?: string | null;
}) {
  const keyBackground = useThemeColor("selection");
  const { capabilities } = useUi();
  const { actions, context } = useActiveActions();
  const hints = hintsFromActions(actions, capabilities.unicode);
  const layout = layoutHints(context, hints, width);
  return (
    <Stack
      id="active-hotkeys"
      height={2}
      width="100%"
      flexShrink={0}
      flexDirection="column"
      overflow="hidden"
    >
      <Stack height={1} width="100%" flexShrink={0} flexDirection="row" overflow="hidden" gap={1}>
        {layout.showContext ? (
          <Text height={1} flexShrink={0} tone="muted" strong>
            {context.toUpperCase()}
          </Text>
        ) : null}
        {layout.rows[0].map((hint) => (
          <Hint key={`${hint.key}:${hint.label}`} hint={hint} keyBackground={keyBackground} />
        ))}
      </Stack>
      <Stack height={1} width="100%" flexShrink={0} flexDirection="row" overflow="hidden" gap={1}>
        {layout.rows[1].map((hint) => (
          <Hint key={`${hint.key}:${hint.label}`} hint={hint} keyBackground={keyBackground} />
        ))}
        <Stack flexGrow={1} minWidth={0} />
        {layout.pinned.map((hint) => (
          <Hint key={`${hint.key}:${hint.label}`} hint={hint} keyBackground={keyBackground} />
        ))}
      </Stack>
    </Stack>
  );
}

export { asciiKeyLabel };
