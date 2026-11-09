import { useState } from "react";
import { useUi } from "../../ui/context.tsx";
import { Stack, Text } from "../../ui/primitives.tsx";

/** Columns the rail reserves: the widest mark plus a gap before the transcript. */
export const PROMPT_RAIL_WIDTH = 5;
const MARK_WIDTHS = [4, 3] as const;
const BASE_MARK_WIDTH = 2;

/** Dock-style magnification: the hovered mark is widest and its neighbors grow a little. */
export function promptMarkWidth(index: number, hovered: number | null) {
  if (hovered === null) return BASE_MARK_WIDTH;
  return MARK_WIDTHS[Math.abs(index - hovered)] ?? BASE_MARK_WIDTH;
}

/** The prompts that fit in `height` rows, kept around the current one when there are more. */
export function promptRailWindow(total: number, height: number, current: number) {
  if (total <= height) return { from: 0, to: total };
  const from = Math.max(0, Math.min(total - height, current - Math.floor(height / 2)));
  return { from, to: from + height };
}

/** One row per prompt, clustered in the middle of the transcript like the web minimap. */
export function PromptRail({
  prompts,
  height,
  start,
  count,
  current,
  onJump,
  onMenu,
}: {
  /** Line indexes where each prompt starts. */
  readonly prompts: readonly number[];
  readonly height: number;
  /** The first visible line and how many lines are visible. */
  readonly start: number;
  readonly count: number;
  /** Zero-based index of the prompt whose turn holds the top line, or -1. */
  readonly current: number;
  readonly onJump: (line: number) => void;
  /** Right-click on a mark, at the mouse's screen position. */
  readonly onMenu: (line: number, position: { x: number; y: number }) => void;
}) {
  const { capabilities } = useUi();
  const [hovered, setHovered] = useState<number | null>(null);
  const { from, to } = promptRailWindow(prompts.length, height, Math.max(0, current));
  return (
    <Stack
      id="prompt-rail"
      width={PROMPT_RAIL_WIDTH}
      height={height}
      flexShrink={0}
      flexDirection="column"
      justifyContent="center"
    >
      {prompts.slice(from, to).map((line, offset) => {
        const index = from + offset;
        const active = index === hovered || index === current;
        const inView = line >= start && line < start + count;
        const glyph = active
          ? capabilities.unicode
            ? "━"
            : "="
          : capabilities.unicode
            ? "─"
            : "-";
        return (
          <Text
            key={line}
            height={1}
            width={PROMPT_RAIL_WIDTH}
            wrapMode="none"
            tone={active ? "accent" : inView ? "text" : "muted"}
            strong={active}
            onMouseOver={() => setHovered(index)}
            onMouseMove={() => setHovered(index)}
            onMouseOut={() => setHovered((value) => (value === index ? null : value))}
            onMouseDown={(event) => {
              if (event.button === 0) onJump(line);
              else if (event.button === 2) {
                event.preventDefault();
                event.stopPropagation();
                onMenu(line, { x: event.x, y: event.y });
              }
            }}
          >
            {glyph.repeat(promptMarkWidth(index, hovered))}
          </Text>
        );
      })}
    </Stack>
  );
}
