import { useState } from "react";
import type { MouseEvent } from "@opentui/core";
import { useThemeColor } from "./context.tsx";
import { Stack, Text, type StackProps } from "./primitives.tsx";
import type { ThemeToken } from "./theme.ts";

export interface ButtonProps extends Omit<StackProps, "children" | "onMouseDown" | "id"> {
  readonly id: string;
  readonly label: string;
  /** Keyboard focus, shown with the selection color and a bold label. */
  readonly focused?: boolean;
  readonly disabled?: boolean;
  /** Set when this button is the current choice in a group. */
  readonly selected?: boolean;
  readonly tone?: ThemeToken;
  readonly onPress?: () => void;
}

/** A one-row clickable label with hover and press feedback. The whole cell is the target. */
export function Button({
  id,
  label,
  focused = false,
  disabled = false,
  selected = false,
  tone,
  onPress,
  ...props
}: ButtonProps) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const selection = useThemeColor("selection");
  const hover = useThemeColor("hover");
  const background = focused || pressed ? selection : hovered && !disabled ? hover : undefined;
  const press = (event: MouseEvent) => {
    if (event.button !== 0 || disabled) return;
    event.preventDefault();
    event.stopPropagation();
    setPressed(true);
    onPress?.();
  };
  return (
    <Stack
      id={id}
      height={1}
      flexShrink={0}
      {...props}
      {...(background ? { backgroundColor: background } : {})}
      onMouseDown={press}
      onMouseUp={() => setPressed(false)}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => {
        setHovered(false);
        setPressed(false);
      }}
    >
      <Text
        height={1}
        wrapMode="none"
        truncate
        strong={focused || selected}
        tone={disabled ? "muted" : (tone ?? (focused || selected ? "accent" : "muted"))}
      >
        {label}
      </Text>
    </Stack>
  );
}
