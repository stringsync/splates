import type { Resource } from "core/disposable";
import type { Eventful } from "core/events";

/** Hears a take as it is spoken. */
export interface Transcriber {
	/** Opens a transcription for one take. */
	listen(): Promise<Transcription>;
}

export interface TranscriptionEvents extends Record<string, unknown> {
	/** All the take's text so far, rough until the take is finished. */
	heard: string;
	/** Why the transcription broke off; `finish` fails with it too. */
	failed: Error;
}

/**
 * One take being transcribed: audio goes in as it is recorded, and text comes
 * out as it is heard.
 */
export interface Transcription extends Eventful<TranscriptionEvents>, Resource {
	/** Sends the next stretch of audio, PCM16 at `SAMPLE_RATE`. */
	append(pcm: Uint8Array<ArrayBuffer>): void;
	/** Ends the take, resolving with its final text. */
	finish(): Promise<string>;
}
