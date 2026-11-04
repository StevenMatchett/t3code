import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

const startOfNextDay = (now: number) => {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime();
};

/**
 * Drives spinners and elapsed time, and only runs while something subscribes. Day labels share one
 * sleep until midnight, so a completed turn costs no wakeups.
 */
export function createActivityClock(
  schedule: (tick: () => void) => () => void = (tick) => {
    const fiber = Effect.runFork(
      Effect.forever(Effect.sleep("250 millis").pipe(Effect.andThen(Effect.sync(tick)))),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  },
  scheduleAt: (at: number, run: () => void) => () => void = (at, run) => {
    const fiber = Effect.runFork(
      Effect.sleep(Math.max(0, at - Date.now())).pipe(Effect.andThen(Effect.sync(run))),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  },
) {
  const listeners = new Set<() => void>();
  let snapshot = { frame: 0, now: Date.now() };
  let stop: (() => void) | undefined;
  let day = new Date().setHours(0, 0, 0, 0);
  const dayListeners = new Set<() => void>();
  let stopDay: (() => void) | undefined;
  return {
    snapshot: () => snapshot,
    localDay: () => day,
    subscribeDay: (listener: () => void) => {
      dayListeners.add(listener);
      const arm = () => {
        stopDay = scheduleAt(startOfNextDay(Date.now()), () => {
          day = new Date().setHours(0, 0, 0, 0);
          for (const notify of dayListeners) notify();
          arm();
        });
      };
      if (!stopDay) arm();
      return () => {
        dayListeners.delete(listener);
        if (dayListeners.size === 0) {
          stopDay?.();
          stopDay = undefined;
        }
      };
    },
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
