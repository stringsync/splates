import type { Resource } from "core/disposable";
import { Duration, SystemTimer } from "core/time";
import { useSyncExternalStore } from "react";
import { type Signals, signals } from "./api/signals";

/** How often the nav and the Signals page ask what signals stand. */
const EVERY = Duration.secs(10);

const NONE: Signals = { signals: [], subscribers: 0 };

/** Every signal on the server, asked every few seconds while anything listens. */
export function useSignals(): Signals & { read: () => Promise<void> } {
	const now = useSyncExternalStore(
		SHARED.subscribe,
		SHARED.current,
		() => NONE,
	);
	return { ...now, read: SHARED.read };
}

/** How many live subscribers signals have, for a nav to count. */
export function useSignalSubscribers(): number {
	return useSyncExternalStore(SHARED.subscribe, SHARED.subscribers, () => 0);
}

/** Forgets the signals read so far, for a test to start from none. */
export function forgetSignals(): void {
	SHARED.forget();
}

class SharedSignals {
	// A poll, not a stream, for the reason the ships poll is one.
	private now = NONE;
	private said = "";
	private readonly listeners = new Set<() => void>();
	private tick: Resource | null = null;
	private generation = 0;

	readonly forget = (): void => {
		this.generation++;
		this.now = NONE;
		this.said = "";
	};

	readonly subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		if (this.tick === null) {
			void this.read();
			this.tick = new SystemTimer().setInterval(() => void this.read(), EVERY);
		}
		return () => {
			this.listeners.delete(listener);
			if (this.listeners.size === 0) {
				this.tick?.dispose();
				this.tick = null;
			}
		};
	};

	readonly current = (): Signals => this.now;

	readonly subscribers = (): number => this.now.subscribers;

	readonly read = async (): Promise<void> => {
		if (globalThis.document?.visibilityState === "hidden") {
			return;
		}
		const generation = this.generation;
		const fresh = await signals().catch(() => null);
		if (generation !== this.generation) {
			return;
		}
		const said = JSON.stringify(fresh);
		if (fresh === null || said === this.said) {
			return;
		}
		this.now = fresh;
		this.said = said;
		for (const listener of this.listeners) {
			listener();
		}
	};
}

const SHARED = new SharedSignals();
