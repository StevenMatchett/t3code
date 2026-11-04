import { useEffect, useState } from "react";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { Stack, Text } from "./primitives.tsx";
import { resolveGlyph } from "./glyphs.tsx";
import { useUi } from "./context.tsx";

export interface Toast {
  readonly text: string;
  readonly failed: boolean;
}

/** Holds a toast long enough to read, then clears it. Replacing the toast restarts the wait. */
export function useToast(durationMs = 2_000) {
  const [toast, setToast] = useState<Toast | null>(null);
  useEffect(() => {
    if (!toast) return;
    const fiber = Effect.runFork(
      Effect.sleep(durationMs).pipe(
        Effect.andThen(
          Effect.sync(() => setToast((current) => (current === toast ? null : current))),
        ),
      ),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [toast, durationMs]);
  return [toast, setToast] as const;
}

/** One reserved row for a toast, so feedback never moves anything. */
export function ToastLine({ toast }: { readonly toast: Toast }) {
  const { capabilities } = useUi();
  return (
    <Stack height={1} flexShrink={0} flexDirection="row" width="100%">
      <Text
        height={1}
        flexGrow={1}
        minWidth={0}
        tone={toast.failed ? "danger" : "success"}
        wrapMode="none"
        truncate
      >
        {`${resolveGlyph(toast.failed ? "error" : "success", capabilities.unicode)} ${toast.text}`}
      </Text>
    </Stack>
  );
}

/** True only after `active` has held for the delay, so fast work never flashes a spinner. */
export function useDelayedFlag(active: boolean, delayMs = 200) {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active) {
      setElapsed(false);
      return;
    }
    const fiber = Effect.runFork(
      Effect.sleep(delayMs).pipe(Effect.andThen(Effect.sync(() => setElapsed(true)))),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [active, delayMs]);
  return active && elapsed;
}
