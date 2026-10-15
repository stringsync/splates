import type { Decider } from "webappwiz/decide";
import {
	type Cleaned,
	type Cleanup,
	CleanupSequence,
	CorrectionDropper,
	type DictationDecision,
	type EditKind,
	FillerDropper,
	ListFormatter,
} from "webappwiz/dictate";
import type { Project } from "./dev-project";
import { RecordingDecider } from "./dev-recording-decider";
import { SystemTagger } from "./dev-tag-systems";

/**
 * What tidies a take's final text in `arbor dev`: dropping what its speaker
 * took back, then its filler, so tagging the systems it names and laying
 * out the lists it speaks see only what stays, all deciding with `decider`.
 * The text as heard while that is null, since the Creds page now asks for
 * its creds; one cleanup failing is logged and skipped, and one in `off`
 * never runs. What each asked of the decider goes back with the take.
 */
export class DevCleanup implements Cleanup {
	private readonly decider: Promise<Decider | null>;

	constructor(
		private readonly project: Project,
		decider: Promise<Decider | null>,
		private readonly off: ReadonlySet<EditKind> = new Set(),
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
		const decisions: DictationDecision[] = [];
		const recorded = (kind: EditKind) =>
			new RecordingDecider(decider, kind, decisions);
		const cleanups: [EditKind, string, Cleanup][] = [
			[
				"correction",
				"dropping its corrections",
				new CorrectionDropper(recorded("correction")),
			],
			["filler", "dropping its filler", new FillerDropper(recorded("filler"))],
			[
				"tag",
				"tagging its systems",
				new SystemTagger(this.project, recorded("tag")),
			],
			["item", "formatting its lists", new ListFormatter(recorded("item"))],
		];
		const cleaned = await new CleanupSequence(
			...cleanups
				.filter(([kind]) => !this.off.has(kind))
				.map(([, doing, cleanup]) => this.logged(doing, cleanup)),
		).clean(text);
		return { ...cleaned, decisions };
	}

	/** `cleanup`, logging why it failed at `doing` before the sequence skips it. */
	private logged(doing: string, cleanup: Cleanup): Cleanup {
		return {
			kind: cleanup.kind,
			clean: (text) =>
				cleanup.clean(text).catch((error: unknown) => {
					this.project.log.error(`${doing} in a dictation failed: ${error}`);
					throw error;
				}),
		};
	}
}
