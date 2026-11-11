import type { Resource } from "core/disposable";
import type { Duration, Timer } from "core/time";

/** A `Timer` that never fires: what it schedules is dropped, and disposing it does nothing. */
export class NoopTimer implements Timer {
	setTimeout(_callback: () => void, _delay: Duration): Resource {
		return { dispose() {} };
	}

	setInterval(_callback: () => void, _interval: Duration): Resource {
		return { dispose() {} };
	}
}
