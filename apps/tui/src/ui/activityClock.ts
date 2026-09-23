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
  let snapshot = { frame: 0, now: Date.now() };
  let stop: (() => void) | undefined;
  return {
    snapshot: () => snapshot,
    localDay: () => new Date(snapshot.now).setHours(0, 0, 0, 0),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      stop ??= schedule(() => {
        snapshot = { frame: (snapshot.frame + 1) % 4, now: Date.now() };
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
