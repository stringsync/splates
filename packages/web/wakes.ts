import { PULSE } from "@stringsync/splates-server/server/browser";
import { Disposer, type Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import {
	Duration,
	SystemTimer,
	SystemWallClock,
	type Timer,
	type WallClock,
} from "webappwiz/time";

export type WakesEvents = { woke: undefined };

/** How often the page looks for a gap in its own ticks, as a sleep leaves. */
const TICK = Duration.secs(5);

/**
 * Says when the page is shown again after long enough hidden that its streams
 * may have died unsaid, as a phone's do once it locks or leaves the browser,
 * or when the machine wakes from a sleep the tab spent showing, so they open
 * again at once rather than after two pulses of silence. A short look at
 * another tab says nothing, as its streams stay open.
 *
 * It reads a wall clock: `performance.now()` stands still while a Mac sleeps,
 * so only the wall clock sees the time a sleep took.
 */
export class Wakes implements Eventful<WakesEvents>, Resource {
	private readonly disposer = new Disposer();
	private readonly dispatcher = this.disposer.use(
		new Dispatcher<WakesEvents>(),
	);
	readonly events = this.dispatcher.events;
	private hiddenAt: number | null = null;

	constructor(
		private readonly wall: WallClock = new SystemWallClock(),
		timer: Timer = new SystemTimer(),
		private readonly after: Duration = PULSE,
	) {
		if (typeof document === "undefined") {
			return;
		}
		const shown = () => {
			if (document.visibilityState === "hidden") {
				this.hiddenAt = this.wall.now();
			} else if (this.hiddenAt !== null) {
				const away = this.wall.now() - this.hiddenAt;
				this.hiddenAt = null;
				if (away >= this.after.ms) {
					this.woke();
				}
			}
		};
		// Back on the network, what was missed meanwhile was never said.
		const online = () => this.woke();
		// A sleep stops the ticks, so one that comes a pulse late follows one.
		// A hidden page's ticks are throttled late too, so it leaves those to
		// `shown`.
		let ticked = this.wall.now();
		const tick = () => {
			const now = this.wall.now();
			const gap = now - ticked;
			ticked = now;
			if (
				document.visibilityState !== "hidden" &&
				gap >= TICK.ms + this.after.ms
			) {
				this.woke();
			}
		};
		document.addEventListener("visibilitychange", shown);
		window.addEventListener("online", online);
		this.disposer.use(timer.setInterval(tick, TICK));
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
