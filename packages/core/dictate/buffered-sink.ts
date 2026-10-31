import type { AudioSink } from "./microphone";

/** Holds the audio a mic sends before the socket it goes to is open. */
export class BufferedSink implements AudioSink {
	private held: Uint8Array<ArrayBuffer>[] = [];
	private target: AudioSink | undefined;

	send(pcm: Uint8Array<ArrayBuffer>): void {
		if (this.target === undefined) {
			this.held.push(pcm);
		} else {
			this.target.send(pcm);
		}
	}

	/** Sends `target` what was held, then everything after. */
	attach(target: AudioSink): void {
		for (const pcm of this.held) {
			target.send(pcm);
		}
		this.held = [];
		this.target = target;
	}
}
