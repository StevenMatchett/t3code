import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useKeyboard } from "@opentui/react";
import {
  type PendingApproval,
  type PendingUserInput,
} from "@t3tools/client-runtime/pending-requests";
import type { ThreadId } from "@t3tools/contracts";
import { useContext, useState } from "react";
import type { TuiClient } from "../connection/clientRuntime.ts";
import {
  approvalOptions,
  answersAreComplete,
  type QuestionAnswers,
} from "../features/chat/interactions.ts";
import { Stack, Text } from "../ui/primitives.tsx";
import { SelectionRow } from "../ui/SelectionRow.tsx";
import { inlineTerminalText, wrapTerminalLines } from "../ui/textLayout.ts";
import { PromptEditor } from "./PromptEditor.tsx";

interface RequestViewProps {
  readonly client: TuiClient;
  readonly threadId: ThreadId;
  readonly active: boolean;
  readonly width: number;
  readonly height: number;
  readonly onBack: () => void;
}

export function Approval({
  request,
  client,
  threadId,
  active,
  width,
  height,
  onBack,
}: RequestViewProps & { readonly request: PendingApproval }) {
  const registry = useContext(RegistryContext);
  const state = useAtomValue(client.actions.state(threadId));
  const options = approvalOptions(request);
  const [choice, setChoice] = useState(
    Math.max(
      0,
      options.findIndex((option) => option.decision === "cancel" || option.decision === "decline"),
    ),
  );
  const [offset, setOffset] = useState(0);
  const selectedIndex = Math.min(choice, options.length - 1);
  const selected = options[selectedIndex]!;
  const waiting =
    state.pending !== null || state.replies.some((reply) => reply.requestId === request.requestId);
  const lines = wrapTerminalLines(
    [request.detail ?? request.requestKind, selected.warning ?? ""].filter(Boolean).join("\n"),
    width,
  );
  const count = Math.max(1, height - options.length - 4);
  useKeyboard((key) => {
    if (!active || key.ctrl || key.meta || key.option) return;
    switch (key.name) {
      case "escape":
        onBack();
        break;
      case "pageup":
        setOffset((value) => Math.max(0, value - count));
        break;
      case "pagedown":
        setOffset((value) => Math.min(Math.max(0, lines.length - count), value + count));
        break;
      case "up":
        setChoice((value) => Math.max(0, value - 1));
        setOffset(0);
        break;
      case "down":
        setChoice((value) => Math.min(options.length - 1, value + 1));
        setOffset(0);
        break;
      case "return":
      case "enter":
        if (!waiting) {
          void client.actions.reply(registry, threadId, {
            kind: "approval",
            requestId: request.requestId,
            decision: selected.decision,
          });
        }
        break;
      default:
        return;
    }
    key.preventDefault();
    key.stopPropagation();
  });
  return (
    <Stack flexDirection="column" height="100%" overflow="hidden">
      <Text
        height={1}
        wrapMode="none"
      >{`Approval: ${inlineTerminalText(request.appName ?? request.requestKind)}`}</Text>
      <Stack height={count} flexShrink={0} flexDirection="column" overflow="hidden">
        <Text height={count} wrapMode="none">
          {lines.slice(offset, offset + count).join("\n")}
        </Text>
      </Stack>
      {options.map((option, index) => (
        <SelectionRow
          key={option.decision}
          label={option.label}
          selected={index === selectedIndex}
          active={active && !waiting}
        />
      ))}
      <Text height={1} wrapMode="none">
        {waiting
          ? "Response queued; waiting for provider."
          : "Up/Down choose | Enter submit | Esc chat"}
      </Text>
      <Text height={1} wrapMode="none">
        PgUp/PgDn scroll full request details
      </Text>
      <Text height={1} wrapMode="none">
        {state.error ?? ""}
      </Text>
    </Stack>
  );
}

export function Questions({
  request,
  client,
  threadId,
  active,
  width,
  height,
  onBack,
}: RequestViewProps & { readonly request: PendingUserInput }) {
  const registry = useContext(RegistryContext);
  const state = useAtomValue(client.actions.state(threadId));
  const [questionIndex, setQuestionIndex] = useState(0);
  const [choice, setChoice] = useState(0);
  const [answers, setAnswers] = useState<QuestionAnswers>({});
  const [editing, setEditing] = useState(
    request.questions[0]?.options.length === 0 && request.questions[0]?.allowCustomAnswer !== false,
  );
  const [custom, setCustom] = useState("");
  const [offset, setOffset] = useState(0);
  const question = request.questions[questionIndex]!;
  const canCustom = question.allowCustomAnswer !== false;
  const continueIndex = question.options.length + (canCustom ? 1 : 0);
  const waiting =
    state.pending !== null || state.replies.some((reply) => reply.requestId === request.requestId);
  const answer = answers[question.id];
  const selected =
    typeof answer === "string"
      ? question.options.some((option) => (option.value ?? option.label) === answer)
        ? [answer]
        : []
      : (answer ?? []);
  const lines = wrapTerminalLines(
    `${question.question}\n${question.options[choice]?.description ?? ""}`,
    width,
  );
  const editorHeight = editing ? Math.max(1, Math.min(3, Math.floor(height / 3))) : 0;
  const optionRows = Math.max(1, Math.min(continueIndex + 1, 6, height - editorHeight - 4));
  const count = Math.max(1, height - optionRows - editorHeight - 3);
  const toggle = (index = choice) => {
    const option = question.options[index];
    if (!option) return;
    const value = option.value ?? option.label;
    setAnswers((current) => ({
      ...current,
      [question.id]: question.multiSelect
        ? selected.includes(value)
          ? selected.filter((item) => item !== value)
          : [...selected, value]
        : value,
    }));
  };
  const beginCustomAnswer = () => {
    if (!canCustom) return;
    setCustom(
      typeof answer === "string" &&
        !question.options.some((option) => (option.value ?? option.label) === answer)
        ? answer
        : "",
    );
    setChoice(question.options.length);
    setEditing(true);
  };
  const continueOrSubmit = () => {
    if (
      !answersAreComplete(
        { ...request, questions: [question] },
        Object.fromEntries([[question.id, answer ?? ""]]),
      )
    )
      return;
    if (questionIndex < request.questions.length - 1) {
      const nextIndex = questionIndex + 1;
      const next = request.questions[nextIndex]!;
      setQuestionIndex(nextIndex);
      setChoice(0);
      setCustom("");
      setEditing(next.options.length === 0 && next.allowCustomAnswer !== false);
      setOffset(0);
    } else if (answersAreComplete(request, answers))
      void client.actions.reply(registry, threadId, {
        kind: "user-input",
        requestId: request.requestId,
        answers,
      });
  };
  const activate = (index = choice) => {
    if (waiting) return;
    setChoice(index);
    if (index < question.options.length) {
      toggle(index);
      if (!question.multiSelect) setChoice(continueIndex);
    } else if (index < continueIndex) beginCustomAnswer();
    else continueOrSubmit();
  };
  useKeyboard((key) => {
    if (!active || key.ctrl || key.meta || key.option) return;
    if (editing) {
      if (key.name !== "escape") return;
      setEditing(false);
    } else
      switch (key.name) {
        case "escape":
          onBack();
          break;
        case "left":
          if (questionIndex > 0) {
            const previousIndex = questionIndex - 1;
            const previous = request.questions[previousIndex]!;
            setQuestionIndex(previousIndex);
            setChoice(0);
            setEditing(previous.options.length === 0 && previous.allowCustomAnswer !== false);
            setOffset(0);
          }
          break;
        case "up":
          setChoice((value) => Math.max(0, value - 1));
          setOffset(0);
          break;
        case "down":
        case "tab":
          setChoice((value) => (value + (key.shift ? continueIndex : 1)) % (continueIndex + 1));
          setOffset(0);
          break;
        case "pageup":
          setOffset((value) => Math.max(0, value - count));
          break;
        case "pagedown":
          setOffset((value) => Math.min(Math.max(0, lines.length - count), value + count));
          break;
        case "space":
          if (!waiting && choice < question.options.length) toggle();
          break;
        case "e":
          if (!waiting && canCustom) beginCustomAnswer();
          break;
        case "return":
        case "enter":
          activate();
          break;
        default:
          return;
      }
    key.preventDefault();
    key.stopPropagation();
  });
  const items = [
    ...question.options.map((option) => ({
      id: JSON.stringify([question.id, "option", option.value ?? option.label]),
      label: `${selected.includes(option.value ?? option.label) ? "[x]" : "[ ]"} ${inlineTerminalText(option.label)}`,
    })),
    ...(canCustom
      ? [
          {
            id: JSON.stringify([question.id, "custom"]),
            label: `${question.options.length ? "Type a different answer" : "Type your answer"}${typeof answer === "string" && !question.options.some((option) => (option.value ?? option.label) === answer) ? `: ${inlineTerminalText(answer)}` : ""}`,
          },
        ]
      : []),
    {
      id: JSON.stringify([question.id, "submit"]),
      label: questionIndex === request.questions.length - 1 ? "Submit answers" : "Continue",
    },
  ];
  const start = Math.max(
    0,
    Math.min(choice - Math.floor(optionRows / 2), items.length - optionRows),
  );
  return (
    <Stack flexDirection="column" height="100%" overflow="hidden">
      <Text
        height={1}
        wrapMode="none"
      >{`Question ${questionIndex + 1}/${request.questions.length}: ${inlineTerminalText(question.header)}`}</Text>
      <Stack height={count} flexShrink={0} flexDirection="column">
        <Text height={count} wrapMode="none">
          {lines.slice(offset, offset + count).join("\n")}
        </Text>
      </Stack>
      {items.slice(start, start + optionRows).map((item, index) => {
        const itemIndex = start + index;
        return (
          <Stack
            key={item.id}
            height={1}
            flexShrink={0}
            onMouseDown={(event) => {
              if (event.button !== 0 || !active || waiting || editing) return;
              event.preventDefault();
              event.stopPropagation();
              activate(itemIndex);
            }}
          >
            <SelectionRow
              label={item.label}
              selected={itemIndex === choice}
              active={active && !waiting && !editing}
            />
          </Stack>
        );
      })}
      {editing ? (
        <PromptEditor
          key={question.id}
          value={custom}
          onChange={setCustom}
          onSubmit={(value) => {
            if (value.trim()) {
              setAnswers((current) => ({ ...current, [question.id]: value.trim() }));
              setEditing(false);
              setChoice(continueIndex);
            }
          }}
          focused={active && !waiting}
          placeholder="Your answer..."
          height={editorHeight}
        />
      ) : null}
      <Text height={1} wrapMode="none">
        {waiting
          ? "Response queued; waiting for provider."
          : editing
            ? "Enter keeps answer | Shift+Enter newline | Esc cancel"
            : canCustom
              ? "Up/Down choose | Enter select | E type answer | Esc chat"
              : "Up/Down choose | Space/Enter select | Esc chat"}
      </Text>
      <Text height={1} wrapMode="none">
        {state.error ?? "Select an answer, then Continue or Submit. PgUp/PgDn scroll details."}
      </Text>
    </Stack>
  );
}
