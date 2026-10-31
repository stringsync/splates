import { Dispatcher } from "core/events";
import type { FakeTranscriber } from "./fake-transcriber";
import type { Transcription, TranscriptionEvents } from "./transcriber";

/** Hears the bytes it is sent as text, failing as its transcriber says to. */
export class FakeTranscription implements Transcription {
	private readonly dispatcher = new Dispatcher<TranscriptionEvents>();
	readonly events = this.dispatcher.events;
	private readonly decoder = new TextDecoder();
	private text = "";

	constructor(private readonly transcriber: FakeTranscriber) {}

	append(pcm: Uint8Array<ArrayBuffer>): void {
		this.text += this.decoder.decode(pcm, { stream: true });
		this.dispatcher.dispatch("heard", `heard: ${this.text}`);
	}

	async finish(): Promise<string> {
		if (this.transcriber.failure !== undefined) {
			throw this.transcriber.failure;
		}
		return `heard: ${this.text}`;
	}

	dispose(): void {
		this.dispatcher.dispose();
	}
}
