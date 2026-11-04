import type { BoxProps } from "@opentui/react";

import { useThemeColor, useUi } from "./context.tsx";
import { resolveGlyph, type GlyphName } from "./glyphs.tsx";
import { useDelayedFlag } from "./StatusLine.tsx";
import type { ThemeToken } from "./theme.ts";

interface StateMessageProps extends Omit<BoxProps, "children"> {
  readonly description?: string;
  readonly glyph: GlyphName;
  readonly title: string;
  readonly tone: ThemeToken;
}

function StateMessage({ description, glyph, title, tone, ...props }: StateMessageProps) {
  const { capabilities } = useUi();
  const toneColor = useThemeColor(tone);
  const mutedColor = useThemeColor("muted");
  return (
    <box {...props} flexDirection="column">
      <text {...(toneColor ? { fg: toneColor } : {})} truncate>
        {resolveGlyph(glyph, capabilities.unicode)} {title}
      </text>
      {description ? (
        <text {...(mutedColor ? { fg: mutedColor } : {})} wrapMode="word">
          {description}
        </text>
      ) : null}
    </box>
  );
}

export interface StateProps extends Omit<BoxProps, "children"> {
  readonly title: string;
  /** Names the next action, such as "Press P to add one." */
  readonly description?: string;
}

const optional = (description: string | undefined) =>
  description === undefined ? {} : { description };

export function EmptyState({ description, title, ...props }: StateProps) {
  return (
    <StateMessage {...props} glyph="empty" title={title} tone="muted" {...optional(description)} />
  );
}

export function ErrorState({ description, title, ...props }: StateProps) {
  return (
    <StateMessage {...props} glyph="error" title={title} tone="danger" {...optional(description)} />
  );
}

/** Stays blank for the first 200ms, so work that finishes quickly never flashes a message. */
export function LoadingState({ description, title, ...props }: StateProps) {
  const visible = useDelayedFlag(true);
  if (!visible) return <box {...props} />;
  return (
    <StateMessage
      {...props}
      glyph="pending"
      title={title}
      tone="muted"
      {...optional(description)}
    />
  );
}
