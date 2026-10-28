import type { Resource } from "webappwiz/disposable";
import { Duration, type Timer } from "webappwiz/time";

/** How long streamed deltas wait to be drawn together. */
const DRAW = Duration.ms(100);

/** What draws what waited. */
export interface Drawn {
	draw(): void;
}

/**
 * Holds back the drawing of streamed deltas so they draw together: `soon`
 * asks for a draw, which comes once `DRAW` passes however many ask before it.
 */
export class Draws implements Resource {
	private waiting: Resource | null = null;

	constructor(
		private readonly timer: Timer,
		private readonly drawn: Drawn,
	) {}

	/** Draws once `DRAW` passes, together with any draw already waiting. */
	soon(): void {
		this.waiting ??= this.timer.setTimeout(() => {
			this.waiting = null;
			this.drawn.draw();
		}, DRAW);
	}

	/** Drops the draw waiting, as when something else draws everything. */
	cancel(): void {
		this.waiting?.dispose();
		this.waiting = null;
	}

	dispose(): void {
		this.cancel();
	}
}
