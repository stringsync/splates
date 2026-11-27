import type { Resource } from "core/disposable";
import { Duration, SystemTimer } from "core/time";
import { useSyncExternalStore } from "react";
import {
	type AutopickImprovements,
	autopickImprovements,
} from "./autopick-api";

/** How often the nav asks whether Autopick has possible improvements. */
const EVERY = Duration.mins(1);

/** Autopick's possible improvements, for a nav to count or a page to show; null until the server says. */
export function useAutopickImprovements(): AutopickImprovements | null {
	// Every caller shares one poll.
	return useSyncExternalStore(SHARED.subscribe, SHARED.current, () => null);
}

/** Asks again now, as after the page sends or dismisses them. */
export function refreshAutopickImprovements(): Promise<void> {
	return SHARED.read();
}

/** Forgets the improvements read so far, for a test to start from none. */
export function forgetAutopickImprovements(): void {
	SHARED.forget();
}

class Improvements {
	private value: AutopickImprovements | null = null;
	private readonly listeners = new Set<() => void>();
	private tick: Resource | null = null;
	private generation = 0;

	readonly forget = (): void => {
		this.generation++;
		this.value = null;
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

	readonly current = (): AutopickImprovements | null => this.value;

	readonly read = async (): Promise<void> => {
		if (globalThis.document?.visibilityState === "hidden") {
			return;
		}
		const generation = ++this.generation;
		const fresh = await autopickImprovements().catch(() => null);
		if (generation !== this.generation) {
			return;
		}
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
