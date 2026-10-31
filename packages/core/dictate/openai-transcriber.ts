import { OpenAiTranscription } from "./openai-transcription";
import { SAMPLE_RATE } from "./pcm";
import type { Transcriber, Transcription } from "./transcriber";

/**
 * Streams text as the audio arrives. `gpt-4o-transcribe` would only start on
 * a turn once it ended, so the text would come a pause at a time.
 */
export const MODEL = "gpt-live-transcribe";

export interface OpenAiTranscriberOptions {
	/** What the take is, read before the audio. */
	prompt?: string;
	/** Names the model should spell the way this repo does. */
	keywords?: string[];
	/** OpenAI's by default; a test hands in its own. */
	url?: string;
}

/** Transcribes through OpenAI's Realtime API, a websocket per take. */
export class OpenAiTranscriber implements Transcriber {
	private readonly url: string;

	constructor(
		private readonly apiKey: string,
		private readonly opts: OpenAiTranscriberOptions = {},
	) {
		this.url =
			opts.url ?? "wss://api.openai.com/v1/realtime?intent=transcription";
	}

	async listen(): Promise<Transcription> {
		return OpenAiTranscription.open(this.url, this.apiKey, {
			type: "session.update",
			session: {
				type: "transcription",
				audio: {
					input: {
						format: { type: "audio/pcm", rate: SAMPLE_RATE },
						transcription: {
							model: MODEL,
							prompt: this.opts.prompt,
							keywords: this.opts.keywords,
						},
						// The model ends a turn only when told, at the end of the take.
						turn_detection: null,
					},
				},
			},
		});
	}
}
