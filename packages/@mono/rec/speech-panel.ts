import type { SpeechListener, SpeechUpdate } from "./live-speech";
import type { ToControl } from "./protocol";

/**
 * Shows speech in the control panel as it is heard: the line so far, then a
 * log-style line in the event list once the sentence is final.
 */
export class SpeechPanel implements SpeechListener {
	private readonly heard = new Map<string, string>();

	constructor(
		private readonly panel: { say(message: ToControl): void },
		private readonly log: { error(message: string): void },
		private readonly clock: { now(): number } = Date,
	) {}

	update(update: SpeechUpdate): void {
		if (!update.final) {
			const text = (this.heard.get(update.id) ?? "") + update.text;
			this.heard.set(update.id, text);
			this.panel.say({ type: "speech-live", text });
			return;
		}
		this.heard.delete(update.id);
		this.panel.say({ type: "speech-live", text: "" });
		if (update.text === "") {
			return;
		}
		this.panel.say({
			type: "signal",
			at: update.at,
			kind: "speech",
			title: "You said",
			detail: update.text.slice(0, 300),
		});
	}

	failed(message: string): void {
		this.log.error(`live transcript stopped: ${message}`);
		this.panel.say({ type: "speech-live", text: "" });
		this.panel.say({
			type: "signal",
			at: this.clock.now(),
			kind: "speech",
			title: "Live transcript stopped",
			detail: `${message.slice(0, 250)}. The transcript is still made after Stop.`,
		});
	}
}
