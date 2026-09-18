import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

export function createActivityClock(
  schedule: (tick: () => void) => () => void = (tick) => {
    const fiber = Effect.runFork(
      Effect.forever(Effect.sleep("250 millis").pipe(Effect.andThen(Effect.sync(tick)))),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  },
) {
  const listeners = new Set<() => void>();
  let frame = 0;
  let stop: (() => void) | undefined;
  return {
    snapshot: () => frame,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      stop ??= schedule(() => {
        frame = (frame + 1) % 4;
        for (const notify of listeners) notify();
      });
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stop?.();
          stop = undefined;
        }
      };
    },
  };
}
export type ActivityClock = ReturnType<typeof createActivityClock>;
