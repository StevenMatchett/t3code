import type { ThreadId } from "@t3tools/contracts";
import type {
  ThreadPendingApproval,
  ThreadPendingUserInput,
} from "@t3tools/client-runtime/state/thread-requests";
import type { TuiClient } from "../../connection/clientRuntime.ts";
import { inlineTerminalText } from "../../ui/textLayout.ts";
import { Panel } from "../../ui/Panel.tsx";
import { Approval, Questions } from "../RequestsPanel.tsx";

/** The approval or question the agent is waiting on, docked above the composer. */
export function RequestDock({
  approval,
  question,
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
  readonly focused: boolean;
  readonly active: boolean;
  readonly client: TuiClient;
  readonly threadId: ThreadId;
  readonly width: number;
  readonly height: number;
  readonly onFocus: () => void;
  readonly onBack: () => void;
}) {
  if (!approval && !question) return null;
  const heading = approval
    ? `Approval needed: ${inlineTerminalText(approval.appName ?? approval.requestKind)}`
    : "Agent question";
  return (
    <Panel
      id={approval ? "inline-approval" : "inline-question"}
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
      ) : null}
    </Panel>
  );
}
