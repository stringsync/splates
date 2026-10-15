import type { DictationLink } from "webappwiz/dictate";
import { type Recording, TICK } from "webappwiz/dictate";
import type { Resource } from "webappwiz/disposable";
import { Duration } from "webappwiz/time";
import type { DictationSession } from "./dictation-session";

/** Below this level a tick counts as silence: a muted mic or a sleeping headset. */
export const QUIET = 0.1;

/** One take's mic and link as each comes, and how much it has heard. */
export class TakeUnderWay implements Resource {
	recording: Recording | undefined;
	link: DictationLink | undefined;
	/** Whether any audio has come from the mic. */
	arriving = false;
	/** Ticks counted as recording, which time the take. */
	ticks = 0;
	/** How long the input has been quiet. */
	quiet = Duration.zero();
	/** Whether the server broke the take off, which finishing says why. */
	broken = false;
	/** The text heard so far, which stays in the draft whatever ends the take. */
	text = "";

	constructor(
		/** The composer's side of the take. */
		readonly session: DictationSession,
	) {}

	heard(level: number | null): void {
		if (level !== null) {
			this.arriving = true;
		}
		this.quiet =
			level !== null && level >= QUIET ? Duration.zero() : this.quiet.add(TICK);
	}

	dispose(): void {
		this.recording?.dispose();
		this.link?.dispose();
	}
}
