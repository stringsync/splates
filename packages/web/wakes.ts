import { PULSE } from "@stringsync/splates-server/server/browser";
import { Disposer, type Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { type Clock, type Duration, SystemClock } from "webappwiz/time";

export type WakesEvents = { woke: undefined };

/**
 * Says when the page is shown again after long enough hidden that its streams
 * may have died unsaid, as a phone's do once it locks or leaves the browser,
 * so they open again at once rather than after two pulses of silence. A short
 * look at another tab says nothing, as its streams stay open.
 */
export class Wakes implements Eventful<WakesEvents>, Resource {
	private readonly disposer = new Disposer();
	private readonly dispatcher = this.disposer.use(
		new Dispatcher<WakesEvents>(),
	);
	readonly events = this.dispatcher.events;
	private hiddenAt: Duration | null = null;

	constructor(
		private readonly clock: Clock = new SystemClock(),
		private readonly after: Duration = PULSE,
	) {
		if (typeof document === "undefined") {
			return;
		}
		const shown = () => {
			if (document.visibilityState === "hidden") {
				this.hiddenAt = this.clock.now();
			} else if (this.hiddenAt !== null) {
				const away = this.clock.now().subtract(this.hiddenAt);
				this.hiddenAt = null;
				if (away.ms >= this.after.ms) {
					this.woke();
				}
			}
		};
		// Back on the network, what was missed meanwhile was never said.
		const online = () => this.woke();
		document.addEventListener("visibilitychange", shown);
		window.addEventListener("online", online);
		this.disposer.defer(() => {
			document.removeEventListener("visibilitychange", shown);
			window.removeEventListener("online", online);
		});
	}

	dispose(): void {
		this.disposer.dispose();
	}

	/** Tells every stream the page woke, as a test does. */
	woke(): void {
		this.dispatcher.dispatch("woke");
	}
}

/** The page's one, which every `LiveStream` hears by default. */
export const WAKES = new Wakes();
