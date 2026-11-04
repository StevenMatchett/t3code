import { FormInput } from "../../ui/FormField.tsx";
import { ListView } from "../../ui/ListView.tsx";
import { Panel } from "../../ui/Panel.tsx";
import { Text } from "../../ui/primitives.tsx";
import { SelectionRow } from "../../ui/SelectionRow.tsx";

export interface ComposerMenuRow {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
}

/** The dropdown above the composer. Skills filter from the draft, so only the rest show an input. */
export function ComposerMenu({
  menu,
  title,
  rows,
  selected,
  bottom,
  height,
  count,
  active,
  query,
  onQuery,
  onChoose,
  status,
  statusFailed,
  empty,
}: {
  readonly menu: string;
  readonly title: string;
  readonly rows: readonly ComposerMenuRow[];
  readonly selected: number;
  readonly bottom: number;
  readonly height: number;
  readonly count: number;
  readonly active: boolean;
  readonly query: string;
  readonly onQuery: (value: string) => void;
  readonly onChoose: (index: number) => void;
  readonly status: string;
  readonly statusFailed: boolean;
  readonly empty: string;
}) {
  return (
    <Panel
      id="composer-dropdown"
      position="absolute"
      bottom={bottom}
      left={0}
      zIndex={20}
      width="100%"
      height={height}
      borderTone="borderFocused"
      title={title}
      flexDirection="column"
    >
      {menu !== "skills" ? (
        <FormInput
          id="composer-filter"
          width="100%"
          focused={active}
          value={query}
          placeholder="Search..."
          onInput={onQuery}
        />
      ) : null}
      <ListView
        items={rows}
        selected={selected}
        height={count}
        showCounter={false}
        itemKey={(row) => row.id}
        empty={<Text tone="muted">{empty}</Text>}
        onActivate={(_row, index) => onChoose(index)}
        renderItem={(row, index) => (
          <SelectionRow label={row.label} selected={index === selected} />
        )}
      />
      <Text
        height={1}
        flexShrink={0}
        tone={statusFailed ? "danger" : "muted"}
        wrapMode="none"
        truncate
      >
        {status}
      </Text>
    </Panel>
  );
}
