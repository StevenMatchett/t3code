import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { ThreadId } from "@t3tools/contracts";
import { useContext, useEffect } from "react";
import type { TuiClient } from "../connection/clientRuntime.ts";

function QueueDelivery({
  client,
  threadId,
}: {
  readonly client: TuiClient;
  readonly threadId: ThreadId;
}) {
  const registry = useContext(RegistryContext);
  const thread = useAtomValue(client.thread(threadId));
  const connection = useAtomValue(client.connection);
  const interaction = useAtomValue(client.actions.state(threadId));
  useEffect(() => {
    void client.actions.flushQueue(registry, threadId);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Recheck delivery when a tool completes, a connection recovers, or an in-flight command settles.
  }, [client, registry, threadId, thread, connection, interaction]);
  return null;
}

// Keep queued threads subscribed even when the user navigates away from their conversation.
export function QueuedMessages({ client }: { readonly client: TuiClient }) {
  const threads = useAtomValue(client.actions.queuedThreads);
  return threads.map((threadId) => (
    <QueueDelivery key={threadId} client={client} threadId={threadId} />
  ));
}
