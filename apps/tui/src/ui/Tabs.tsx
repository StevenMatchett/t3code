import { Fragment } from "react";
import { Text } from "./primitives.tsx";

/** A one-row tab strip. Brackets mark the current tab so it reads without color. */
export function tabsLabel<Id extends string>(
  tabs: ReadonlyArray<{ readonly id: Id; readonly label: string }>,
  selected: Id,
) {
  return tabs.map((tab) => (tab.id === selected ? `[${tab.label}]` : tab.label)).join(" ");
}

export function Tabs<Id extends string>({
  id,
  tabs,
  selected,
  onPress,
}: {
  readonly id: string;
  readonly tabs: ReadonlyArray<{ readonly id: Id; readonly label: string }>;
  readonly selected: Id;
  /** Pressing the strip advances it, the same as the keyboard shortcut. */
  readonly onPress?: () => void;
}) {
  return (
    <Text
      id={id}
      height={1}
      flexShrink={0}
      tone="muted"
      wrapMode="none"
      truncate
      onMouseDown={(event) => {
        if (event.button !== 0 || !onPress) return;
        event.preventDefault();
        event.stopPropagation();
        onPress();
      }}
    >
      {tabs.map((tab, index) => (
        <Fragment key={tab.id}>
          {index ? " " : ""}
          {tab.id === selected ? <strong>{`[${tab.label}]`}</strong> : tab.label}
        </Fragment>
      ))}
    </Text>
  );
}
