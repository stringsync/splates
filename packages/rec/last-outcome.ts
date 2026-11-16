import type { RecStatus } from "./mark";
import type { Manifest } from "./session";

/** Remembers how the last recording ended, for `rec status` to report. */
export class LastOutcome {
	private outcome: RecStatus["lastOutcome"];

	/** Runs a save and records how it ended, passing its result or error on. */
	async track(
		save: () => Promise<Manifest>,
		fallbackName: () => string,
	): Promise<Manifest> {
		try {
			const manifest = await save();
			this.outcome = {
				status: "saved",
				name: manifest.name ?? fallbackName(),
			};
			return manifest;
		} catch (error) {
			this.outcome = {
				status: "failed",
				reason: error instanceof Error ? error.message : String(error),
			};
			throw error;
		}
	}

	/** The status fields to spread into the status response; empty before a recording has ended. */
	fields(): Pick<RecStatus, "lastOutcome"> {
		return this.outcome ? { lastOutcome: this.outcome } : {};
	}
}
