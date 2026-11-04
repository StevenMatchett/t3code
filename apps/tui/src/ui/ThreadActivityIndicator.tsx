import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import { isThreadWorking, type ThreadActivityPhase } from "../features/chat/threadActivity.ts";
import { createActivityClock, type ActivityClock } from "./activityClock.ts";
import { useUi } from "./context.tsx";
import { Text } from "./primitives.tsx";
import type { ThemeToken } from "./theme.ts";

const ClockContext = createContext<ActivityClock | null>(null);
const AnimationVisibleContext = createContext(true);

/** Everything under a hidden gate stops animating, including components that don't know it's hidden. */
export function AnimationGate({
  visible,
  children,
}: {
  readonly visible: boolean;
  readonly children?: ReactNode;
}) {
  return (
    <AnimationVisibleContext.Provider value={visible}>{children}</AnimationVisibleContext.Provider>
  );
}
const fallbackClock = createActivityClock();
const frames = ["|", "/", "-", "\\"];
const phases: Record<
  ThreadActivityPhase,
  { readonly label: string; readonly badge: string; readonly tone: ThemeToken }
> = {
  idle: { label: "Ready", badge: "   ", tone: "muted" },
  starting: { label: "Starting", badge: "...", tone: "accent" },
  running: { label: "Working", badge: "...", tone: "accent" },
  waiting_for_approval: { label: "Approval needed", badge: "[!]", tone: "warning" },
  waiting_for_input: { label: "Needs input", badge: "[?]", tone: "warning" },
  completed: { label: "Done", badge: "[+]", tone: "muted" },
  failed: { label: "Failed", badge: "[x]", tone: "danger" },
  stale: { label: "Status unavailable", badge: "[~]", tone: "muted" },
};

export function ActivityClockProvider({
  children,
  clock,
}: {
  readonly children?: ReactNode;
  readonly clock?: ActivityClock;
}) {
  const inherited = useContext(ClockContext);
  const [own] = useState(createActivityClock);
  return (
    <ClockContext.Provider value={clock ?? inherited ?? own}>{children}</ClockContext.Provider>
  );
}

const noSubscription = () => () => undefined;

/** Hidden or animation-free screens read the clock once and never subscribe, so nothing ticks. */
export function useActivityClock(live = true) {
  const clock = useContext(ClockContext) ?? fallbackClock;
  const { capabilities } = useUi();
  const visible = useContext(AnimationVisibleContext);
  const subscribe =
    live && visible && capabilities.animation !== false ? clock.subscribe : noSubscription;
  const [frozen] = useState(() => ({ frame: 0, now: Date.now() }));
  const snapshot = useSyncExternalStore(subscribe, clock.snapshot, clock.snapshot);
  return subscribe === noSubscription ? { ...frozen, now: Date.now() } : snapshot;
}

export function useLocalDay() {
  const clock = useContext(ClockContext) ?? fallbackClock;
  return useSyncExternalStore(clock.subscribeDay, clock.localDay, clock.localDay);
}

function Working({
  compact,
  phase,
}: {
  readonly compact: boolean;
  readonly phase: ThreadActivityPhase;
}) {
  const { frame } = useActivityClock();
  return (
    <Text
      height={1}
      flexShrink={0}
      {...(compact ? { width: 4 } : {})}
      tone="accent"
      wrapMode="none"
    >
      {compact ? ` ${frames[frame]} ` : `${frames[frame]} ${phases[phase].label}`}
    </Text>
  );
}

export function ThreadActivityIndicator({
  phase,
  compact = false,
  visible = true,
}: {
  readonly phase: ThreadActivityPhase;
  readonly compact?: boolean;
  readonly visible?: boolean;
}) {
  const { capabilities } = useUi();
  const gateVisible = useContext(AnimationVisibleContext);
  if (visible && gateVisible && capabilities.animation !== false && isThreadWorking(phase))
    return <Working compact={compact} phase={phase} />;
  const style = phases[phase];
  return (
    <Text
      height={1}
      flexShrink={0}
      {...(compact ? { width: 4 } : {})}
      tone={style.tone}
      wrapMode="none"
    >
      {compact
        ? ` ${style.badge}`
        : phase === "idle"
          ? style.label
          : `${style.badge} ${style.label}`}
    </Text>
  );
}
