import { useAtomValue } from "@effect/atom-react";
import type { SyntaxStyle } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { Atom } from "effect/unstable/reactivity";
import { memo, useEffect, useState } from "react";

export function makeStreamingSpikeFixture() {
  return {
    rows: Array.from({ length: 5_000 }, (_, index) => Atom.make(`Recorded activity ${index}`)),
    stream: Atom.make({ markdown: "Streaming **response**", code: "const update = 0;" }),
    mountedRows: new Set<number>(),
    renders: new Map<number, number>(),
  };
}

type Fixture = ReturnType<typeof makeStreamingSpikeFixture>;

const RecordedRow = memo(function RecordedRow({
  fixture,
  index,
  selected,
  onSelect,
}: {
  readonly fixture: Fixture;
  readonly index: number;
  readonly selected: boolean;
  readonly onSelect: (index: number) => void;
}) {
  const content = useAtomValue(fixture.rows[index]!);
  fixture.renders.set(index, (fixture.renders.get(index) ?? 0) + 1);
  useEffect(() => {
    fixture.mountedRows.add(index);
    return () => {
      fixture.mountedRows.delete(index);
    };
  }, [fixture, index]);
  return (
    <box height={1} flexShrink={0} onMouseDown={() => onSelect(index)}>
      <text wrapMode="none">{`${selected ? ">" : " "} ${content}`}</text>
    </box>
  );
});

function Stream({
  fixture,
  syntaxStyle,
}: {
  readonly fixture: Fixture;
  readonly syntaxStyle: SyntaxStyle;
}) {
  const { markdown, code } = useAtomValue(fixture.stream);
  return (
    <box height={5} flexShrink={0} flexDirection="column" overflow="hidden">
      <markdown height={3} flexShrink={0} content={markdown} syntaxStyle={syntaxStyle} streaming />
      <code
        height={2}
        flexShrink={0}
        content={code}
        syntaxStyle={syntaxStyle}
        streaming
        drawUnstyledText
      />
    </box>
  );
}

export function StreamingSpike({
  fixture,
  syntaxStyle,
}: {
  readonly fixture: Fixture;
  readonly syntaxStyle: SyntaxStyle;
}) {
  const { height } = useTerminalDimensions();
  const [selected, setSelected] = useState(2_500);
  const [picker, setPicker] = useState(false);
  const [choice, setChoice] = useState(0);
  const visibleCount = Math.max(1, height - 9);
  const start = Math.min(selected, fixture.rows.length - visibleCount);
  const indices = Array.from({ length: visibleCount }, (_, offset) => start + offset);

  useKeyboard((key) => {
    if (key.name === "f6" || (picker && key.name === "escape")) {
      key.preventDefault();
      key.stopPropagation();
      setPicker((open) => !open);
    }
  });

  return (
    <box width="100%" height="100%" flexDirection="column">
      <text height={1} flexShrink={0}>{`Selected ${selected} | Choice ${choice}`}</text>
      <box height={visibleCount} flexShrink={0} flexDirection="column" overflow="hidden">
        {indices.map((index) => (
          <RecordedRow
            key={index}
            fixture={fixture}
            index={index}
            selected={index === selected}
            onSelect={setSelected}
          />
        ))}
      </box>
      <Stream fixture={fixture} syntaxStyle={syntaxStyle} />
      <textarea id="spike-composer" height={3} flexShrink={0} focused={!picker} />
      {picker && (
        <box position="absolute" top={1} left={0} width="100%" height={5} border>
          <select
            focused
            width="100%"
            height={3}
            showDescription={false}
            selectedIndex={choice}
            options={[
              { name: "First choice", description: "" },
              { name: "Second choice", description: "" },
            ]}
            onChange={setChoice}
            onSelect={() => setPicker(false)}
          />
        </box>
      )}
    </box>
  );
}
