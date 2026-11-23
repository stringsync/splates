import type { Resource } from "core/disposable";
import { Duration, SystemTimer } from "core/time";
import { useSyncExternalStore } from "react";
import {
	type AutoPickImprovements,
	autoPickImprovements,
} from "./auto-pick-api";

/** How often the nav asks whether Auto pick has possible improvements. */
const EVERY = Duration.mins(1);

/** Auto pick's possible improvements, for a nav to count or a page to show; null until the server says. */
export function useAutoPickImprovements(): AutoPickImprovements | null {
	// Every caller shares one poll.
	return useSyncExternalStore(SHARED.subscribe, SHARED.current, () => null);
}

/** Asks again now, as after the page sends or dismisses them. */
export function refreshAutoPickImprovements(): Promise<void> {
	return SHARED.read();
}

class Improvements {
	private value: AutoPickImprovements | null = null;
	private readonly listeners = new Set<() => void>();
	private tick: Resource | null = null;

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

	readonly current = (): AutoPickImprovements | null => this.value;

	readonly read = async (): Promise<void> => {
		if (globalThis.document?.visibilityState === "hidden") {
			return;
		}
		const fresh = await autoPickImprovements().catch(() => null);
		if (
			fresh === null ||
			(fresh.count === this.value?.count && fresh.key === this.value.key)
		) {
			return;
		}
		this.value = fresh;
		for (const listener of this.listeners) {
			listener();
		}
	};
}

const SHARED = new Improvements();
