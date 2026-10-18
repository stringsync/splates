import type { Resource } from "webappwiz/disposable";
import type { KeepAwake } from "./awake";

/**
 * Holds `awake` while any of what it counts is held, and lets go once the
 * last is let go: one hold for many agents.
 */
export class AwakeWhileBusy {
	private held = 0;
	private hold: Resource | null = null;

	constructor(private readonly awake: KeepAwake | null) {}

	/** Counts one more thing running, until the answer is disposed. */
	busy(): Resource {
		this.held += 1;
		if (this.held === 1 && this.awake !== null) {
			this.hold = this.awake.hold();
		}
		let done = false;
		return {
			dispose: () => {
				if (done) {
					return;
				}
				done = true;
				this.held -= 1;
				if (this.held === 0) {
					this.hold?.dispose();
					this.hold = null;
				}
			},
		};
	}
}
