import type { KeyEvent } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { useRef, useState } from "react";
import type { ConversationLine } from "../ui/conversationLines.ts";

interface Position {
  readonly id: string;
  readonly line: number;
  readonly column: number;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const characters = (text: string) => Array.from(segmenter.segment(text), (part) => part.segment);

/** A cursor addresses rendered lines by identity so streamed output and older pages don't shift it. */
export function useOutputVim({
  lines,
  start,
  count,
  scrollTo,
  onPaste,
}: {
  readonly lines: readonly ConversationLine[];
  readonly start: number;
  readonly count: number;
  readonly scrollTo: (start: number) => void;
  readonly onPaste: (text: string) => void;
}) {
  const renderer = useRenderer();
  const [snapshot, setSnapshot] = useState({
    cursor: null as Position | null,
    selection: null as Position | null,
    linewise: false,
    notice: "",
  });
  const state = useRef(snapshot);
  const update = (patch: Partial<typeof snapshot>) => {
    state.current = { ...state.current, ...patch };
    setSnapshot(state.current);
  };
  const setCursor = (cursor: Position | null) => update({ cursor });
  const setSelection = (selection: Position | null) => update({ selection });
  const setLinewise = (linewise: boolean) => update({ linewise });
  const setNotice = (notice: string) => update({ notice });
  const register = useRef("");
  const pendingG = useRef(false);
  // Terminal input can deliver several keystrokes before React renders again.
  const view = ({ cursor, selection, linewise, notice }: typeof snapshot) => {
    const indexOf = (position: Position | null) =>
      position
        ? lines.findIndex((line) => line.id === position.id && line.line === position.line)
        : -1;
    const index = Math.max(0, indexOf(cursor) < 0 ? start : indexOf(cursor));
    const column = Math.min(
      cursor?.column ?? 0,
      Math.max(0, characters(lines[index]?.text ?? "").length - 1),
    );
    const position = (row: number, col: number): Position => ({
      id: lines[row]!.id,
      line: lines[row]!.line,
      column: Math.max(0, Math.min(col, Math.max(0, characters(lines[row]!.text).length - 1))),
    });
    const move = (row: number, col = column) => {
      row = Math.max(0, Math.min(lines.length - 1, row));
      setCursor(position(row, col));
      // Pin the viewport while navigating, including when it currently ends at live output.
      scrollTo(row < start ? row : row >= start + count ? row - count + 1 : start);
    };
    const selectionIndex = indexOf(selection);
    const first = selectionIndex < 0 ? index : Math.min(index, selectionIndex);
    const last = selectionIndex < 0 ? index : Math.max(index, selectionIndex);
    const forward =
      selectionIndex < index || (selectionIndex === index && (selection?.column ?? 0) <= column);
    const fromColumn = forward ? (selection?.column ?? column) : column;
    const toColumn = forward ? column : (selection?.column ?? column);
    const range = (row: number) => {
      if (!lines.length || row < first || row > last) return undefined;
      const chars = characters(lines[row]?.text ?? "");
      const from = selection && linewise ? 0 : row === first ? fromColumn : 0;
      const to = selection && linewise ? chars.length : row === last ? toColumn + 1 : chars.length;
      return {
        cursor: selection === null,
        start: chars.slice(0, from).join("").length,
        end: chars.slice(0, to).join("").length,
      };
    };
    const reset = () => {
      setCursor(null);
      setSelection(null);
      setNotice("");
      pendingG.current = false;
    };
    const handleKey = (key: KeyEvent) => {
      if (key.meta || key.option || !lines.length) return false;
      const name = key.name;
      if (key.ctrl && !["d", "u", "f"].includes(name)) return false;
      const gg = pendingG.current && name === "g" && !key.shift;
      pendingG.current = false;
      if (key.ctrl) {
        move(
          index +
            (["u", "b"].includes(name) ? -1 : 1) *
              Math.max(1, Math.floor(count / (["d", "u"].includes(name) ? 2 : 1))),
        );
      } else if (name === "g") {
        if (key.shift) move(lines.length - 1, 0);
        else if (gg) move(0, 0);
        else {
          pendingG.current = true;
          move(index);
        }
      } else if (name === "j" || name === "down") move(index + 1);
      else if (name === "k" || name === "up") move(index - 1);
      else if (name === "h" || name === "left") move(index, column - 1);
      else if (name === "l" || name === "right") move(index, column + 1);
      else if (name === "0" || (cursor && name === "home")) move(index, 0);
      else if (name === "$" || (name === "4" && key.shift)) move(index, Infinity);
      else if (cursor && name === "pageup") move(index - count);
      else if (cursor && name === "pagedown") move(index + count);
      else if (name === "w" || name === "b") {
        let row = index;
        let col = column;
        const wordClass = (character: string) =>
          /\s/u.test(character) ? 0 : /[\p{L}\p{N}_]/u.test(character) ? 1 : 2;
        if (name === "w") {
          let chars = characters(lines[row]!.text);
          const current = wordClass(chars[col] ?? " ");
          while (col < chars.length && wordClass(chars[col]!) === current) col++;
          while (true) {
            while (col < chars.length && wordClass(chars[col]!) === 0) col++;
            if (col < chars.length || row === lines.length - 1) break;
            chars = characters(lines[++row]!.text);
            col = 0;
          }
        } else {
          col--;
          while (true) {
            const chars = characters(lines[row]!.text);
            while (col >= 0 && wordClass(chars[col]!) === 0) col--;
            if (col >= 0) {
              const current = wordClass(chars[col]!);
              while (col > 0 && wordClass(chars[col - 1]!) === current) col--;
              break;
            }
            if (row === 0) break;
            col = characters(lines[--row]!.text).length - 1;
          }
        }
        move(row, col);
      } else if (name === "v") {
        move(index);
        if (selection && linewise === key.shift) setSelection(null);
        else {
          setSelection(position(index, column));
          setLinewise(key.shift);
        }
      } else if (name === "y") {
        const text =
          selection && selectionIndex >= 0
            ? lines
                .slice(first, last + 1)
                .map((line, offset) => {
                  const selected = range(first + offset)!;
                  return line.text.slice(selected.start, selected.end);
                })
                .join("\n") + (linewise ? "\n" : "")
            : lines[index]!.text + "\n";
        register.current = text;
        const copied = renderer.copyToClipboardOSC52(text);
        setNotice(copied ? "Yanked to clipboard" : "Yanked locally · clipboard unavailable");
        move(index);
        setSelection(null);
        return true;
      } else if (name === "p") {
        if (register.current) {
          onPaste(register.current);
          reset();
        }
        return true;
      } else if (name === "escape" && selection) {
        setSelection(null);
      } else return false;
      setNotice("");
      return true;
    };
    return {
      handleKey,
      reset,
      range,
      status:
        notice ||
        (selection ? (linewise ? "VISUAL LINE" : "VISUAL") : lines.length ? "NORMAL" : ""),
    };
  };
  return { ...view(snapshot), handleKey: (key: KeyEvent) => view(state.current).handleKey(key) };
}
