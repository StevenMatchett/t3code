import type { TextareaRenderable } from "@opentui/core";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { Stack } from "../ui/primitives.tsx";
import { PromptScrollbar } from "./PromptScrollbar.tsx";
import { useThemeColor } from "../ui/context.tsx";

export interface PromptSnapshot {
  readonly text: string;
  readonly cursor: number;
}

export interface PromptEditorControl {
  readonly isAtHistoryBoundary: (direction: "backward" | "forward") => boolean;
  readonly snapshot: () => PromptSnapshot;
  readonly replace: (text: string, cursor: number) => void;
}

function cursorInText(editor: TextareaRenderable) {
  return editor.editBuffer.getTextRange(0, editor.cursorOffset).length;
}

function moveToTextOffset(editor: TextareaRenderable, cursor: number) {
  editor.gotoBufferEnd();
  let low = 0;
  let high = editor.cursorOffset;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (editor.editBuffer.getTextRange(0, middle).length <= cursor) low = middle;
    else high = middle - 1;
  }
  editor.cursorOffset = low;
}

export function PromptEditor({
  value,
  onChange,
  onSubmit,
  focused,
  height = 4,
  placeholder = "Write a prompt...",
  control,
  initialCursor,
  onSnapshot,
  onActivate,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: (value: string) => void;
  readonly focused: boolean;
  readonly height?: number;
  readonly placeholder?: string;
  readonly control?: Ref<PromptEditorControl>;
  readonly initialCursor?: number;
  readonly onSnapshot?: (snapshot: PromptSnapshot) => void;
  readonly onActivate?: () => void;
}) {
  const editor = useRef<TextareaRenderable | null>(null);
  const updating = useRef(false);
  const initialPosition = useRef(initialCursor);
  const initialized = useRef(false);
  const background = useThemeColor("panel");
  const foreground = useThemeColor("text");
  const muted = useThemeColor("muted");
  const accent = useThemeColor("accent");
  const snapshot = () =>
    editor.current
      ? { text: editor.current.plainText, cursor: cursorInText(editor.current) }
      : { text: value, cursor: value.length };
  const replace = (text: string, cursor: number) => {
    const current = editor.current;
    if (!current) return;
    updating.current = true;
    try {
      current.replaceText(text);
      moveToTextOffset(current, cursor);
    } finally {
      updating.current = false;
    }
    onChange(text);
    onSnapshot?.(snapshot());
  };
  useImperativeHandle(control, () => ({
    snapshot,
    replace,
    isAtHistoryBoundary: (direction) => {
      const current = editor.current;
      if (!current || current.hasSelection()) return false;
      const row = current.scrollY + current.visualCursor.visualRow;
      return direction === "backward"
        ? row === 0
        : row === current.editorView.getTotalVirtualLineCount() - 1;
    },
  }));
  useEffect(() => {
    const current = editor.current;
    if (!current) return;
    if (!initialized.current) {
      initialized.current = true;
      moveToTextOffset(current, initialPosition.current ?? value.length);
    } else if (current.plainText !== value) {
      current.setText(value);
      current.gotoBufferEnd();
    }
  }, [value]);
  return (
    <Stack flexDirection="row" height={height} width="100%" flexShrink={0}>
      <textarea
        ref={editor}
        id="prompt-editor"
        initialValue={value}
        height={height}
        flexShrink={0}
        flexGrow={1}
        minWidth={1}
        focused={focused}
        placeholder={placeholder}
        {...(background ? { backgroundColor: background, focusedBackgroundColor: background } : {})}
        {...(foreground ? { textColor: foreground, focusedTextColor: foreground } : {})}
        {...(muted ? { placeholderColor: muted } : {})}
        {...(accent ? { cursorColor: accent } : {})}
        cursorStyle={{ style: "line", blinking: false }}
        keyBindings={[
          { name: "return", action: "submit" },
          { name: "return", shift: true, action: "newline" },
          { name: "j", ctrl: true, action: "newline" },
          { name: "linefeed", action: "newline" },
        ]}
        onMouseDown={() => onActivate?.()}
        onKeyDown={(key) => {
          if (key.repeated && (key.name === "return" || key.name === "enter")) {
            key.preventDefault();
            key.stopPropagation();
            return;
          }
          // Some terminal bindings send ESC+CR for Shift+Enter without a Shift
          // modifier. Treat that legacy sequence as a newline (also Alt+Enter).
          if (key.sequence === "\x1b\r") {
            key.preventDefault();
            key.stopPropagation();
            editor.current?.newLine();
          }
        }}
        onCursorChange={() => {
          if (!updating.current && editor.current) onSnapshot?.(snapshot());
        }}
        onContentChange={() => {
          if (!updating.current && editor.current) {
            onChange(editor.current.plainText);
            onSnapshot?.(snapshot());
          }
        }}
        onSubmit={() => {
          const text = editor.current?.plainText ?? value;
          onChange(text);
          onSubmit(text);
        }}
      />
      <PromptScrollbar editor={editor} />
    </Stack>
  );
}
