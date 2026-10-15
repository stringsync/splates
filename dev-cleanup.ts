import type { Decider } from "webappwiz/decide";
import {
	type Cleaned,
	type Cleanup,
	CleanupSequence,
	CorrectionDropper,
	FillerDropper,
	ListFormatter,
} from "webappwiz/dictate";
import type { Project } from "./dev-project";
import { SystemTagger } from "./dev-tag-systems";

/**
 * What tidies a take's final text in `arbor dev`: dropping what its speaker
 * took back, then its filler, so tagging the systems it names and laying
 * out the lists it speaks see only what stays, all deciding with `decider`.
 * The text as heard while that is null, since the Creds page now asks for
 * its creds; one cleanup failing is logged and skipped.
 */
export class DevCleanup implements Cleanup {
	private readonly decider: Promise<Decider | null>;

	constructor(
		private readonly project: Project,
		decider: Promise<Decider | null>,
	) {
		// A take that ends before its text is final never asks for it.
		this.decider = decider.catch((error: unknown) => {
			project.log.error(`no decider for a dictation's cleanup: ${error}`);
			return null;
		});
	}

	async clean(text: string): Promise<Cleaned> {
		const decider = await this.decider;
		if (decider === null) {
			return { text, edits: [] };
		}
		return new CleanupSequence(
			this.logged("dropping its corrections", new CorrectionDropper(decider)),
			this.logged("dropping its filler", new FillerDropper(decider)),
			this.logged(
				"tagging its systems",
				new SystemTagger(this.project, decider),
			),
			this.logged("formatting its lists", new ListFormatter(decider)),
		).clean(text);
	}

	/** `cleanup`, logging why it failed at `doing` before the sequence skips it. */
	private logged(doing: string, cleanup: Cleanup): Cleanup {
		return {
			clean: (text) =>
				cleanup.clean(text).catch((error: unknown) => {
					this.project.log.error(`${doing} in a dictation failed: ${error}`);
					throw error;
				}),
		};
	}
}
