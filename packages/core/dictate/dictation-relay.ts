import type { Resource } from "core/disposable";
import { DictationFailure } from "./dictation-failure";
import type { DictationMessage } from "./dictation-message";
import type { Transcriber, Transcription } from "./transcriber";

/** The socket a relay answers on: a server's end of the page's `DictationSocket`. */
export interface DictationPeer {
	send(message: string): void;
	/** Ends the take's socket, once it is done or failed. */
	hangUp(): void;
}

/**
 * One take's socket on the server, relaying the page's audio to a
 * transcription and its text back as {@link DictationMessage}s. Hand
 * `receive` each message the socket gets, and dispose it when the socket
 * closes, which takes the transcription with it.
 */
export class DictationRelay implements Resource {
	/** The take's transcription, or nothing once it failed to start. */
	private readonly transcription: Promise<Transcription | undefined>;

	/**
	 * Starts listening at once. A `transcriber` that rejects with a
	 * {@link DictationFailure} names the cred it needs to the page.
	 */
	constructor(
		private readonly peer: DictationPeer,
		transcriber: Promise<Transcriber>,
	) {
		this.transcription = transcriber
			.then(async (each) => {
				const transcription = await each.listen();
				transcription.events.on("heard", (text) =>
					this.say({ type: "heard", text }),
				);
				transcription.events.on("failed", (error) =>
					this.say({ type: "failed", message: error.message }),
				);
				return transcription;
			})
			.catch((error: unknown) => {
				this.say(failed(error));
				peer.hangUp();
				return undefined;
			});
	}

	/** Takes audio as bytes, PCM16 at `SAMPLE_RATE`, and "finish" as text. */
	receive(message: string | Uint8Array<ArrayBuffer>): void {
		// Every message waits on the same transcription, so they reach it in order.
		void this.transcription.then(async (transcription) => {
			if (transcription === undefined) {
				return;
			}
			if (typeof message !== "string") {
				transcription.append(message);
				return;
			}
			if (message !== "finish") {
				return;
			}
			this.say(
				await transcription
					.finish()
					.then((text): DictationMessage => ({ type: "done", text }), failed),
			);
			this.peer.hangUp();
		});
	}

	dispose(): void {
		void this.transcription.then((transcription) => transcription?.dispose());
	}

	private say(message: DictationMessage): void {
		this.peer.send(JSON.stringify(message));
	}
}

function failed(error: unknown): DictationMessage {
	if (error instanceof DictationFailure && error.cred !== undefined) {
		return { type: "failed", message: error.message, cred: error.cred };
	}
	return {
		type: "failed",
		message: error instanceof Error ? error.message : String(error),
	};
}
