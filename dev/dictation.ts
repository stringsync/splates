import type { DictationAdapter } from "@assistant-ui/react";
import type { OpenLink } from "webappwiz/dictate";
import {
	BufferedSink,
	DictationFailure,
	type Microphone,
} from "webappwiz/dictate";
import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { Duration } from "webappwiz/time";
import { DictationSession } from "./dictation-session";
import { TakeReview } from "./take-review";
import { TakeUnderWay } from "./take-under-way";

/**
 * Where the mic is in a take. `asking` waits on the browser's permission
 * prompt, `opening` on the mic and the server, and `recording` holds only once
 * audio is really arriving. `denied` and `failed` say why the last take did
 * not work; a tap starts another from them as from `idle`.
 */
export type DictationPhase =
	| "idle"
	| "asking"
	| "denied"
	| "opening"
	| "recording"
	| "finishing"
	| "failed";

/** How long the input may stay this quiet before the composer asks whether the mic hears. */
export const SILENCE = Duration.secs(4);

/** What the composer's mic shows. */
export interface DictationState {
	phase: DictationPhase;
	/** Why the last take failed or stopped on its own, until the next one. */
	error: string | undefined;
	/** The cred the last take needed, when that is why it failed. */
	cred: string | undefined;
	/** How loud the input is, from 0 to 1. */
	level: number;
	/** Whether the open mic has heard nothing for {@link SILENCE}. */
	silent: boolean;
	/** The last take's cleanup, open to judge until the next take or a dismiss. */
	review: TakeReview | undefined;
}

const IDLE: DictationState = {
	phase: "idle",
	error: undefined,
	cred: undefined,
	level: 0,
	silent: false,
	review: undefined,
};

/**
 * The composer's dictation: records a take from the mic, streams it to arbor
 * dev to be transcribed as it is spoken, and hands the text to the composer
 * through assistant-ui's {@link DictationAdapter} as it comes.
 */
export class Dictation
	implements DictationAdapter, Eventful<{ changed: undefined }>, Resource
{
	private readonly dispatcher = new Dispatcher<{ changed: undefined }>();
	readonly events = this.dispatcher.events;
	private current = IDLE;
	/** The take under way, from the tap until it is done or given up. */
	private take: TakeUnderWay | undefined;

	constructor(
		private readonly microphone: Microphone,
		private readonly open: OpenLink,
	) {}

	get state(): DictationState {
		return this.current;
	}

	/**
	 * Starts a take, as the composer's mic button asks on the tap itself: the
	 * mic starts before any await, as a phone needs.
	 */
	listen(): DictationSession {
		this.take?.session.ended("cancelled", undefined);
		this.take?.dispose();
		const sink = new BufferedSink();
		const recording = this.microphone.start(sink);
		const link = this.open();
		const take = new TakeUnderWay(
			new DictationSession({
				stop: () => (this.take === take ? this.stop() : Promise.resolve()),
				cancel: () => {
					if (this.take === take) {
						this.cancel();
					}
				},
			}),
		);
		this.take = take;
		this.set({ ...IDLE, phase: "opening" });
		void this.microphone.permission().then((permission) => {
			if (permission === "prompt" && this.take === take && !take.recording) {
				this.set({ phase: "asking" });
			}
		});
		void recording.then((each) => {
			if (this.take !== take) {
				each.dispose();
				return;
			}
			take.recording = each;
			if (this.current.phase === "asking") {
				this.set({ phase: "opening" });
			}
			each.events.on("tick", (level) => this.tick(take, level));
			each.events.on("interrupted", (why) => {
				if (this.take === take) {
					void this.stop(`Stopped: ${why}.`);
				}
			});
		}, ignore);
		void link.then((each) => {
			if (this.take !== take) {
				each.dispose();
				return;
			}
			take.link = each;
			sink.attach(each);
			each.events.on("heard", (text) => {
				take.text = text;
				take.session.heard(text);
			});
			// The take ends either way: on a break the server says why, on a
			// drop the text heard so far stays in the draft.
			for (const event of ["failed", "closed"] as const) {
				each.events.on(event, () => {
					if (this.take === take) {
						take.broken = true;
						void this.stop();
					}
				});
			}
			this.tick(take, null);
		}, ignore);
		void Promise.all([recording, link]).catch((error: unknown) => {
			void recording.then((each) => each.dispose(), ignore);
			void link.then((each) => each.dispose(), ignore);
			if (this.take === take) {
				this.take = undefined;
				take.session.ended("error", undefined);
				this.set({ ...IDLE, ...startFailure(error) });
			}
		});
		return take.session;
	}

	/** Puts `review`, a flip of the last take's, in place of it. */
	revise(review: TakeReview | undefined): void {
		if (this.take === undefined) {
			this.set({ review });
		}
	}

	/** Puts away what the last take said went wrong. */
	dismiss(): void {
		if (this.take === undefined) {
			this.set(IDLE);
		}
	}

	dispose(): void {
		this.take?.dispose();
		this.take = undefined;
		this.dispatcher.dispose();
	}

	/** Counts a tick of the take under way, which becomes `recording` on its first audio. */
	private tick(take: TakeUnderWay, level: number | null): void {
		if (this.take !== take) {
			return;
		}
		take.heard(level);
		const { phase } = this.current;
		if (
			(phase === "opening" || phase === "asking") &&
			take.arriving &&
			take.link !== undefined &&
			take.recording !== undefined
		) {
			this.set({ phase: "recording" });
			take.recording.cue("start");
			take.session.running();
		}
		this.set({
			level: level ?? 0,
			silent: take.quiet.isGreaterThanOrEqual(SILENCE),
		});
	}

	/**
	 * Ends the take under way, handing the composer its final text, and says
	 * why when it stopped itself. What was heard stays in the draft whatever
	 * goes wrong.
	 */
	private async stop(notice?: string): Promise<void> {
		const { take } = this;
		this.take = undefined;
		if (take === undefined) {
			return;
		}
		if (this.current.phase === "recording") {
			take.recording?.cue("stop");
		}
		take.recording?.dispose();
		const { link } = take;
		if (link === undefined || (!take.arriving && !take.broken)) {
			// Stopped before any audio came: there is nothing to finish.
			take.dispose();
			take.session.ended("cancelled", undefined);
			this.set({ ...IDLE, error: notice });
			return;
		}
		this.set({ phase: "finishing", level: 0, silent: false, error: notice });
		try {
			const taken = await link.finish();
			take.session.ended("stopped", taken.text);
			this.set({ ...IDLE, error: notice, review: TakeReview.of(taken) });
		} catch (error) {
			const failure = failureOf(error);
			take.session.ended("error", take.text);
			this.set({
				...IDLE,
				phase: "failed",
				error: capitalized(failure.message),
				cred: failure.cred,
			});
		} finally {
			link.dispose();
		}
	}

	/** Lets go of the take under way, keeping what it heard in the draft. */
	private cancel(): void {
		const { take } = this;
		this.take = undefined;
		if (this.current.phase === "recording") {
			take?.recording?.cue("stop");
		}
		take?.dispose();
		take?.session.ended("cancelled", undefined);
		this.set(IDLE);
	}

	private set(change: Partial<DictationState>): void {
		this.current = { ...this.current, ...change };
		this.dispatcher.dispatch("changed");
	}
}

/** The phase and words a start that failed leaves, telling a blocked mic from the rest. */
function startFailure(
	error: unknown,
): Pick<DictationState, "phase" | "error" | "cred"> {
	const name = error instanceof Error ? error.name : "";
	if (name === "NotAllowedError" || name === "SecurityError") {
		return {
			phase: "denied",
			error: "The mic is blocked for this page.",
			cred: undefined,
		};
	}
	if (name === "NotFoundError" || name === "OverconstrainedError") {
		return {
			phase: "failed",
			error: "No microphone was found.",
			cred: undefined,
		};
	}
	if (name === "NotReadableError" || name === "AbortError") {
		return {
			phase: "failed",
			error: "The mic would not open: another app may be using it.",
			cred: undefined,
		};
	}
	const failure = failureOf(error);
	return {
		phase: "failed",
		error: capitalized(failure.message),
		cred: failure.cred,
	};
}

function failureOf(error: unknown): DictationFailure {
	if (error instanceof DictationFailure) {
		return error;
	}
	return new DictationFailure(
		error instanceof Error ? error.message : String(error),
		undefined,
	);
}

function capitalized(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

function ignore(): void {}
