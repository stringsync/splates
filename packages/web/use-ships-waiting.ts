import type { Waiting } from "@splates/server/ship";
import type { Resource } from "core/disposable";
import { Duration, SystemTimer } from "core/time";
import { useSyncExternalStore } from "react";
import { shipRuns, shipWaiting } from "./api/ship";

/** How often the nav asks what ship prompts are open. */
const EVERY = Duration.secs(5);

const NONE: Waiting[] = [];

/** Every prompt a ship run has open, for a nav to count; none until the server says. */
export function useShipsWaiting(): Waiting[] {
	// Every caller shares one poll.
	return useSyncExternalStore(SHARED.subscribe, SHARED.current, () => NONE);
}

/** Whether a ship run is under way, for a nav to spin; false until the server says. */
export function useShipsRunning(): boolean {
	return useSyncExternalStore(SHARED.subscribe, SHARED.isRunning, () => false);
}

/** The ship prompts open, asked every few seconds while anything listens. */
class ShipsWaiting {
	// A poll, not a stream: the page's streams already take most of the few
	// connections a browser keeps to one server, and a request queued behind
	// them never goes out.
	private waiting = NONE;
	private said = "[]";
	private running = false;
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

	readonly current = (): Waiting[] => this.waiting;

	readonly isRunning = (): boolean => this.running;

	private async read(): Promise<void> {
		if (globalThis.document?.visibilityState === "hidden") {
			return;
		}
		const [fresh, runs] = await Promise.all([
			shipWaiting().catch(() => null),
			shipRuns({ running: true }).catch(() => null),
		]);
		const said = JSON.stringify(fresh);
		const running = runs === null ? this.running : runs.length > 0;
		const waitingChanged = fresh !== null && said !== this.said;
		if (!waitingChanged && running === this.running) {
			return;
		}
		if (fresh !== null) {
			this.waiting = fresh;
			this.said = said;
		}
		this.running = running;
		for (const listener of this.listeners) {
			listener();
		}
	}
}

const SHARED = new ShipsWaiting();
