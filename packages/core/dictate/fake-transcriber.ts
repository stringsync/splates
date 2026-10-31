import { FakeTranscription } from "./fake-transcription";
import type { Transcriber, Transcription } from "./transcriber";

/** Hears whatever text a test sent as the audio's own bytes. */
export class FakeTranscriber implements Transcriber {
	/** Set to make a take fail with it when it finishes. */
	failure: Error | undefined;

	async listen(): Promise<Transcription> {
		return new FakeTranscription(this);
	}
}
