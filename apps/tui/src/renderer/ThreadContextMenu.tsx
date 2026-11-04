import { useState } from "react";
import { useKeyLayer } from "../ui/keymap.ts";
import { listWindowStart } from "../ui/ListView.tsx";
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

export function NavigationContextMenu<Action extends string>({
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
  readonly actions: readonly {
    readonly action: Action;
    readonly label: string;
    readonly disabled?: boolean;
  }[];
  readonly onChoose: (action: Action) => void;
}) {
  const [selected, setSelected] = useState(0);
  // A short terminal scrolls the menu, so the selection is always on screen.
  const menuHeight = Math.min(actions.length + 2, height);
  const visible = Math.max(1, menuHeight - 2);
  const first = listWindowStart(selected, visible, actions.length);
  const choose = (index: number) => {
    if (!actions[index]!.disabled) onChoose(actions[index]!.action);
  };
  const move = (offset: number) =>
    setSelected((current) => (current + offset + actions.length) % actions.length);
  useKeyLayer("contextMenu", {
    modal: true,
    bindings: {
      "contextMenu.close": onClose,
      "contextMenu.up": () => move(-1),
      "contextMenu.down": () => move(1),
      "contextMenu.choose": () => choose(selected),
    },
  });
  const longest = Math.max(...actions.map(({ label }) => label.length));
  const menuWidth = Math.min(Math.max(20, longest + 6), width);
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
        {actions.slice(first, first + visible).map(({ action, label, disabled }, offset) => {
          const index = first + offset;
          return (
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
                if (event.button === 0) choose(index);
              }}
            >
              <SelectionRow
                label={disabled ? `${label} (running)` : label}
                selected={selected === index}
              />
            </Stack>
          );
        })}
      </Panel>
    </Stack>
  );
}
