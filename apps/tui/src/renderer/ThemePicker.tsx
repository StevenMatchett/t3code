import { useEffect, useState } from "react";
import { useKeyLayer } from "../ui/keymap.ts";
import { ListView } from "../ui/ListView.tsx";
import { Stack, Text } from "../ui/primitives.tsx";
import { SelectionRow } from "../ui/SelectionRow.tsx";
import { THEME_CHOICES } from "../ui/theme.ts";
import { useThemeControl } from "./ThemeRoot.tsx";

/** Moving the selection previews the theme live. Esc puts the saved theme back. */
export function ThemePicker({
  active,
  onClose,
}: {
  readonly active: boolean;
  readonly onClose: () => void;
}) {
  const control = useThemeControl();
  const [cursor, setCursor] = useState(() =>
    Math.max(
      0,
      THEME_CHOICES.findIndex((choice) => choice.id === control.preference),
    ),
  );
  const { preview } = control;
  useEffect(() => () => preview(null), [preview]);
  const move = (offset: number) => {
    const next = (cursor + offset + THEME_CHOICES.length) % THEME_CHOICES.length;
    setCursor(next);
    preview(THEME_CHOICES[next]!.id);
  };
  const choose = (index: number) => {
    control.save(THEME_CHOICES[index]!.id);
    onClose();
  };
  useKeyLayer("theme", {
    active,
    modal: true,
    bindings: {
      "theme.up": () => move(-1),
      "theme.down": () => move(1),
      "theme.choose": () => choose(cursor),
      "theme.close": () => {
        preview(null);
        onClose();
      },
    },
  });
  return (
    <Stack width="100%" height="100%" flexDirection="column">
      <ListView
        items={THEME_CHOICES}
        selected={cursor}
        height={THEME_CHOICES.length}
        itemKey={(choice) => choice.id}
        itemId={(choice) => `theme-${choice.id}`}
        onActivate={(_choice, index) => choose(index)}
        renderItem={(choice, index) => (
          <SelectionRow
            selected={index === cursor}
            active={active}
            label={`${choice.id === control.preference ? "* " : ""}${choice.label}`}
          />
        )}
      />
      <Text height={1} flexShrink={0} tone="muted" wrapMode="none" truncate>
        {`${THEME_CHOICES[cursor]!.detail} Now showing ${control.resolved}.`}
      </Text>
    </Stack>
  );
}
