import type { KeyEvent } from "@opentui/core";
import type { BoxProps } from "@opentui/react";

import { useThemeColor, useUi } from "./context.tsx";
import { resolveGlyph, type GlyphName } from "./glyphs.tsx";
import { KeyHint } from "./KeyHint.tsx";
import type { ThemeToken } from "./theme.ts";

interface StateAction {
  readonly label: string;
  readonly onSelect: () => void;
}

interface StateMessageProps extends Omit<BoxProps, "children" | "onKeyDown"> {
  readonly action?: StateAction;
  readonly description?: string;
  readonly glyph: GlyphName;
  readonly title: string;
  readonly tone: ThemeToken;
}

function isActivationKey(event: KeyEvent) {
  return (
    event.eventType === "press" &&
    !event.repeated &&
    (event.name === "enter" || event.name === "return" || event.name === "space")
  );
}

function StateMessage({ action, description, glyph, title, tone, ...props }: StateMessageProps) {
  const { capabilities } = useUi();
  const toneColor = useThemeColor(tone);
  const mutedColor = useThemeColor("muted");

  return (
    <box
      {...props}
      flexDirection="column"
      focusable={action !== undefined}
      onKeyDown={(event) => {
        if (!action || !isActivationKey(event)) return;
        event.preventDefault();
        event.stopPropagation();
        action.onSelect();
      }}
      {...(action
        ? {
            onMouseDown: (event) => {
              event.preventDefault();
              event.stopPropagation();
              action.onSelect();
            },
          }
        : {})}
    >
      <text {...(toneColor ? { fg: toneColor } : {})} truncate>
        {resolveGlyph(glyph, capabilities.unicode)} {title}
      </text>
      {description ? (
        <text {...(mutedColor ? { fg: mutedColor } : {})} wrapMode="word">
          {description}
        </text>
      ) : null}
      {action ? <KeyHint keys="enter" label={action.label} /> : null}
    </box>
  );
}

export interface EmptyStateProps extends Omit<BoxProps, "children" | "onKeyDown"> {
  readonly actionLabel?: string;
  readonly description?: string;
  readonly onAction?: () => void;
  readonly title: string;
}

export function EmptyState({
  actionLabel = "Continue",
  description,
  onAction,
  title,
  ...props
}: EmptyStateProps) {
  return (
    <StateMessage
      {...props}
      glyph="empty"
      title={title}
      tone="muted"
      {...(onAction ? { action: { label: actionLabel, onSelect: onAction } } : {})}
      {...(description === undefined ? {} : { description })}
    />
  );
}

export interface ErrorStateProps extends Omit<BoxProps, "children" | "onKeyDown"> {
  readonly description?: string;
  readonly onRetry?: () => void;
  readonly retryLabel?: string;
  readonly title?: string;
}

export function ErrorState({
  description,
  onRetry,
  retryLabel = "Retry",
  title = "Something went wrong",
  ...props
}: ErrorStateProps) {
  return (
    <StateMessage
      {...props}
      glyph="error"
      title={title}
      tone="danger"
      {...(onRetry ? { action: { label: retryLabel, onSelect: onRetry } } : {})}
      {...(description === undefined ? {} : { description })}
    />
  );
}
