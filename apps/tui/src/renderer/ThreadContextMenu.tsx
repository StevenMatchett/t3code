import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import { Panel } from "../ui/Panel.tsx";
import { SelectionRow } from "../ui/SelectionRow.tsx";
import { Stack } from "../ui/primitives.tsx";

export type ThreadMenuAction = "rename" | "archive" | "delete";

interface MenuPositionProps {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly onClose: () => void;
}

export function ThreadContextMenu({
  archived,
  ...props
}: MenuPositionProps & {
  readonly archived: boolean;
  readonly onChoose: (action: ThreadMenuAction) => void;
}) {
  return (
    <NavigationContextMenu
      {...props}
      id="thread-context"
      actions={[
        { action: "rename", label: "Rename" },
        { action: "archive", label: archived ? "Restore" : "Archive" },
        { action: "delete", label: "Delete" },
      ]}
    />
  );
}

export function ProjectContextMenu(
  props: MenuPositionProps & {
    readonly onChoose: (action: "new-thread") => void;
  },
) {
  return (
    <NavigationContextMenu
      {...props}
      id="project-context"
      actions={[{ action: "new-thread", label: "New thread" }]}
    />
  );
}

function NavigationContextMenu<Action extends string>({
  x,
  y,
  width,
  height,
  id,
  actions,
  onChoose,
  onClose,
}: MenuPositionProps & {
  readonly id: string;
  readonly actions: readonly { readonly action: Action; readonly label: string }[];
  readonly onChoose: (action: Action) => void;
}) {
  const [selected, setSelected] = useState(0);
  const menuHeight = actions.length + 2;
  useKeyboard((key) => {
    key.preventDefault();
    key.stopPropagation();
    if (key.name === "escape") onClose();
    else if (key.name === "up" || key.name === "down" || key.name === "tab") {
      const offset = key.name === "up" || (key.name === "tab" && key.shift) ? -1 : 1;
      setSelected((current) => (current + offset + actions.length) % actions.length);
    } else if ((key.name === "return" || key.name === "enter") && !key.repeated) {
      onChoose(actions[selected]!.action);
    }
  });
  const menuWidth = Math.min(20, width);
  return (
    <Stack
      id={`${id}-backdrop`}
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      zIndex={100}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <Panel
        id={`${id}-menu`}
        position="absolute"
        left={Math.max(0, Math.min(x, width - menuWidth))}
        top={Math.max(0, Math.min(y, height - menuHeight))}
        width={menuWidth}
        height={menuHeight}
        flexDirection="column"
        borderTone="borderFocused"
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {actions.map(({ action, label }, index) => (
          <Stack
            key={action}
            id={`${id}-${action}`}
            height={1}
            width="100%"
            onMouseOver={() => setSelected(index)}
            onMouseMove={() => setSelected(index)}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (event.button === 0) onChoose(action);
            }}
          >
            <SelectionRow label={label} selected={selected === index} />
          </Stack>
        ))}
      </Panel>
    </Stack>
  );
}
