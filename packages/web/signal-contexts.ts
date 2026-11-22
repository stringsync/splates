import type { SignalProbe, SignalWait } from "@splates/server/signals";
import { createContext } from "react";

/** The conversation's id and signal waits, so `SignalUI` can draw each in the thread. */
export const SignalWaits = createContext<{
	conversation: string | null;
	waits: readonly SignalWait[];
}>({ conversation: null, waits: [] });

/** The signal probes a conversation started, so `ProbeUI` can draw each in the thread. */
export const ProbeCards = createContext<readonly SignalProbe[]>([]);

/**
 * Which signal waits have their line in sight in the thread, so the bar above
 * the composer leaves them to it. Null outside a thread that holds a bar.
 */
export const SignalSight = createContext<{
	inView: ReadonlySet<string>;
	sight(id: string, seen: boolean): void;
} | null>(null);

/** How much of a wait's line must show for it to stand in for the bar. */
export const IN_VIEW = 0.5;
