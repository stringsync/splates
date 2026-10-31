import { Dispatcher } from "core/events";
import { DictationFailure } from "./dictation-failure";
import type { DictationLink, DictationLinkEvents } from "./dictation-link";

/**
 * A server in a test: hears the bytes a take sends as text, says it all so
 * far after each, and gives it as the final text, unless told to fail.
 */
export class FakeDictationLink implements DictationLink {
	private readonly dispatcher = new Dispatcher<DictationLinkEvents>();
	readonly events = this.dispatcher.events;
	private readonly decoder = new TextDecoder();
	text = "";
	/** Set to make finishing fail with it, as a missing key or a dropped socket does. */
	failure: DictationFailure | undefined;
	open = true;

	send(pcm: Uint8Array<ArrayBuffer>): void {
		this.text += this.decoder.decode(pcm, { stream: true });
		this.dispatcher.dispatch("heard", this.text);
	}

	async finish(): Promise<string> {
		if (this.failure !== undefined) {
			throw this.failure;
		}
		return this.text;
	}

	/** Breaks the take off, as the server does when it lacks `cred`. */
	fail(message: string, cred?: string): void {
		this.failure = new DictationFailure(message, cred);
		this.dispatcher.dispatch("failed");
	}

	/** Drops the link, as a phone asleep does. */
	drop(): void {
		this.failure ??= new DictationFailure(
			"the connection to the server dropped",
			undefined,
		);
		this.dispatcher.dispatch("closed");
	}

	dispose(): void {
		this.open = false;
		this.dispatcher.dispose();
	}
}
