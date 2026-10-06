import type { TuiThread, TuiThreadState } from "../../connection/models.ts";
import type { MessageId } from "@t3tools/contracts";

import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import type { Atom, AtomRegistry } from "effect/reactivity";

/** Match the GUI's Edit from here targets: the user prompt preceding a checkpointed reply. */
export function checkpointRestoreTargets(thread: TuiThread) {
  const checkpoints = new Map(
    thread.checkpoints.map((checkpoint) => [checkpoint.assistantMessageId, checkpoint]),
  );
  const targets: { message: TuiThread["messages"][number]; turnCount: number }[] = [];
  let prompt: TuiThread["messages"][number] | undefined;
  for (const message of thread.messages) {
    if (message.role === "user") prompt = message;
    else if (prompt) {
      const checkpoint = checkpoints.get(message.id);
      if (!checkpoint) continue;
      targets.push({ message: prompt, turnCount: Math.max(0, checkpoint.checkpointTurnCount - 1) });
      prompt = undefined;
    }
  }
  return targets;
}

/** Dispatch acknowledgement precedes the asynchronous rewind; observe its projected result. */
export function waitForCheckpointRestore(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<TuiThreadState>,
  messageId: MessageId,
  turnCount: number,
  dispatch: () => Promise<boolean>,
): Promise<void> {
  const initial = Option.getOrThrow(registry.get(atom).data);
  return new Promise((resolve, reject) => {
    let accepted = false;
    let settled = false;
    let unsubscribe = () => {};
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      Effect.runFork(Fiber.interrupt(timeout));
      unsubscribe();
      if (error) reject(error);
      else resolve();
    };
    const inspect = () => {
      const thread = Option.getOrNull(registry.get(atom).data);
      if (!thread) return;
      if (
        thread.rollbackFailure &&
        thread.rollbackFailure.requestId !== initial.rollbackFailure?.requestId
      ) {
        finish(new Error(thread.rollbackFailure.message));
        return;
      }
      if (
        accepted &&
        !thread.messages.some((m) => m.id === messageId) &&
        thread.checkpoints.every((c) => c.checkpointTurnCount <= turnCount) &&
        (turnCount === 0
          ? thread.latestTurn === null
          : thread.checkpoints.some((c) => c.turnId === thread.latestTurn?.turnId))
      ) {
        finish();
      }
    };
    const timeout = Effect.runFork(
      Effect.sleep("120 seconds").pipe(
        Effect.andThen(
          Effect.sync(() =>
            finish(
              new Error(
                "Timed out waiting for the thread to rewind. Check the thread before retrying.",
              ),
            ),
          ),
        ),
      ),
    );
    unsubscribe = registry.subscribe(atom, inspect);
    Promise.resolve()
      .then(dispatch)
      .then(
        (result) => {
          if (!result) return finish(new Error("The environment did not accept the rewind."));
          accepted = true;
          inspect();
        },
        (error: unknown) =>
          finish(error instanceof Error ? error : new Error("Failed to rewind thread.")),
      );
  });
}
