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

/** One take, publishing its transcript only when recording finishes. */
export class DictationSession implements DictationAdapter.Session {
	private readonly dispatcher = new Dispatcher<SessionEvents>();
	status: DictationAdapter.Status = { type: "starting" };

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
				transcript: text,
				isFinal: true,
			});
		}
		this.dispatcher.dispatch("end", {
			transcript: text === undefined ? "" : text,
		});
		this.dispatcher.dispose();
	}
}
