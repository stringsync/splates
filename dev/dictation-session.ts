import type { DictationAdapter } from "@assistant-ui/react";
import { Dispatcher } from "webappwiz/events";

interface SessionEvents extends Record<string, unknown> {
	start: undefined;
	speech: DictationAdapter.Result;
	end: DictationAdapter.Result;
}

/** How the session's composer ends the take it stands for. */
export interface SessionEnds {
	stop(): Promise<void>;
	cancel(): void;
}

/**
 * One take as the composer sees it: its text goes in at the draft as it is
 * heard, rough until the take is done, when the final text takes its place.
 * An edit to the draft mid-take makes the words heard so far the person's
 * own, so from then on only the words after them go in.
 */
export class DictationSession implements DictationAdapter.Session {
	private readonly dispatcher = new Dispatcher<SessionEvents>();
	status: DictationAdapter.Status = { type: "starting" };
	/** All the take's text so far, as last heard. */
	private text = "";
	/** How many of the take's first words an edit made the person's own. */
	private kept = 0;
	/** Whether the draft shows rough text heard since the last edit. */
	private showing = false;

	constructor(private readonly ends: SessionEnds) {}

	readonly stop = (): Promise<void> => this.ends.stop();
	readonly cancel = (): void => this.ends.cancel();
	readonly onSpeechStart = (callback: () => void) =>
		this.dispatcher.events.on("start", callback);
	readonly onSpeech = (callback: (result: DictationAdapter.Result) => void) =>
		this.dispatcher.events.on("speech", callback);
	readonly onSpeechEnd = (
		callback: (result: DictationAdapter.Result) => void,
	) => this.dispatcher.events.on("end", callback);

	/** The mic hears: the take is running. */
	running(): void {
		if (this.status.type === "starting") {
			this.status = { type: "running" };
			this.dispatcher.dispatch("start");
		}
	}

	/** All the take's text so far. */
	heard(text: string): void {
		this.text = text;
		const transcript = this.after(text);
		this.showing = transcript !== "";
		this.dispatcher.dispatch("speech", { transcript, isFinal: false });
	}

	/**
	 * The person edited the draft, which now holds the rough text shown so far
	 * as their own: the composer only adds what comes after it.
	 */
	edited(): void {
		if (this.showing) {
			this.kept = words(this.text);
			this.showing = false;
		}
	}

	/** The take is over: `text` is its final text, or undefined when there is none to give. */
	ended(
		reason: "stopped" | "cancelled" | "error",
		text: string | undefined,
	): void {
		if (this.status.type === "ended") {
			return;
		}
		this.status = { type: "ended", reason };
		if (text !== undefined) {
			this.dispatcher.dispatch("speech", {
				transcript: this.after(text),
				isFinal: true,
			});
		}
		this.dispatcher.dispatch("end", {
			transcript: text === undefined ? "" : this.after(text),
		});
		this.dispatcher.dispose();
	}

	/** The take's `text` past the words an edit kept, which the draft already holds. */
	private after(text: string): string {
		if (this.kept === 0) {
			return text;
		}
		return text.replace(new RegExp(`^\\s*(?:\\S+\\s*){0,${this.kept}}`), "");
	}
}

function words(text: string): number {
	return text.split(/\s+/).filter((each) => each !== "").length;
}
