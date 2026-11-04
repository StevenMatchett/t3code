import type { ReactNode } from "react";
import { useThemeColor } from "./context.tsx";
import { Stack, Text } from "./primitives.tsx";

/** A labelled row. The label marks focus so the active field reads without color. */
export function FormRow({
  label,
  labelWidth = 10,
  focused = false,
  children,
}: {
  readonly label: string;
  readonly labelWidth?: number;
  readonly focused?: boolean;
  readonly children?: ReactNode;
}) {
  return (
    <Stack height={1} flexShrink={0} flexDirection="row">
      <Text
        width={labelWidth}
        flexShrink={0}
        height={1}
        wrapMode="none"
        tone={focused ? "accent" : "text"}
        strong={focused}
      >
        {label}
      </Text>
      {children}
    </Stack>
  );
}

/** One-line text entry with theme colors and focus handling every form shares. */
export function FormInput({
  id,
  value,
  placeholder,
  focused,
  onInput,
  onFocusRequest,
  width,
}: {
  readonly id: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly focused: boolean;
  readonly onInput: (value: string) => void;
  readonly onFocusRequest?: () => void;
  readonly width?: number | "100%";
}) {
  const background = useThemeColor("panel");
  const foreground = useThemeColor("text");
  const muted = useThemeColor("muted");
  return (
    <input
      id={id}
      {...(width === undefined ? { flexGrow: 1, minWidth: 1 } : { width })}
      value={value}
      {...(placeholder === undefined ? {} : { placeholder })}
      focused={focused}
      onInput={onInput}
      {...(onFocusRequest ? { onMouseDown: () => onFocusRequest() } : {})}
      {...(background ? { backgroundColor: background, focusedBackgroundColor: background } : {})}
      {...(foreground ? { textColor: foreground, focusedTextColor: foreground } : {})}
      {...(muted ? { placeholderColor: muted } : {})}
    />
  );
}
