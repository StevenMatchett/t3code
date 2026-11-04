import type { ThreadId } from "@t3tools/contracts";
import type {
  ThreadPendingApproval,
  ThreadPendingUserInput,
} from "@t3tools/client-runtime/state/thread-requests";
import type { TuiClient } from "../../connection/clientRuntime.ts";
import type { TuiSecretRequest } from "../../connection/models.ts";
import { inlineTerminalText } from "../../ui/textLayout.ts";
import { Panel } from "../../ui/Panel.tsx";
import { Approval, Questions } from "../RequestsPanel.tsx";
import { SecretRequestForm } from "./SecretRequestForm.tsx";

/** The approval, question, or secret request the agent is waiting on, docked above the composer. */
export function RequestDock({
  approval,
  question,
  secret,
  focused,
  active,
  client,
  threadId,
  width,
  height,
  onFocus,
  onBack,
}: {
  readonly approval: ThreadPendingApproval | undefined;
  readonly question: ThreadPendingUserInput | undefined;
  readonly secret?: TuiSecretRequest | undefined;
  readonly focused: boolean;
  readonly active: boolean;
  readonly client: TuiClient;
  readonly threadId: ThreadId;
  readonly width: number;
  readonly height: number;
  readonly onFocus: () => void;
  readonly onBack: () => void;
}) {
  if (!approval && !question && !secret) return null;
  const heading = approval
    ? `Approval needed: ${inlineTerminalText(approval.appName ?? approval.requestKind)}`
    : question
      ? "Agent question"
      : `Secret needed: ${inlineTerminalText(secret?.label ?? "")}`;
  return (
    <Panel
      id={approval ? "inline-approval" : question ? "inline-question" : "inline-secret"}
      title={focused ? heading : `${heading} · A responds`}
      height={height}
      flexShrink={0}
      width="100%"
      flexDirection="column"
      borderTone={focused ? "borderFocused" : "warning"}
      onMouseDown={(event) => {
        if (!active || event.button !== 0 || focused) return;
        event.preventDefault();
        event.stopPropagation();
        onFocus();
      }}
    >
      {approval ? (
        <Approval
          key={approval.requestId}
          request={approval}
          client={client}
          threadId={threadId}
          active={active && focused}
          width={Math.max(1, width - 4)}
          height={height - 2}
          onBack={onBack}
        />
      ) : question ? (
        <Questions
          key={question.requestId}
          request={question}
          client={client}
          threadId={threadId}
          active={active && focused}
          width={Math.max(1, width - 4)}
          height={height - 2}
          onBack={onBack}
        />
      ) : secret ? (
        <SecretRequestForm
          key={secret.id}
          request={secret}
          client={client}
          active={active && focused}
          width={Math.max(1, width - 4)}
          height={height - 2}
          onBack={onBack}
        />
      ) : null}
    </Panel>
  );
}
