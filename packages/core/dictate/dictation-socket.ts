import { Dispatcher } from "core/events";
import { DictationFailure } from "./dictation-failure";
import type { DictationLink, DictationLinkEvents } from "./dictation-link";
import type { DictationMessage } from "./dictation-message";

/**
 * A take over a WebSocket to a server that relays it with `DictationRelay`:
 * the audio goes up as bytes, and the server's `DictationMessage`s come back.
 */
export class DictationSocket implements DictationLink {
	private readonly dispatcher = new Dispatcher<DictationLinkEvents>();
	readonly events = this.dispatcher.events;
	private finishing: PromiseWithResolvers<string> | undefined;
	/** What the server last said went wrong, which a closing take fails with. */
	private failure: DictationFailure | undefined;
	private ended = false;

	private constructor(private readonly socket: WebSocket) {
		socket.addEventListener("message", this.receive);
		socket.addEventListener("close", this.closed);
	}

	/** Opens a take on the socket at `url`. */
	static async open(url: string | URL): Promise<DictationSocket> {
		const socket = new WebSocket(url);
		await new Promise((resolve, reject) => {
			socket.addEventListener("open", resolve, { once: true });
			socket.addEventListener(
				"error",
				() => reject(new Error("could not reach the server")),
				{ once: true },
			);
		});
		return new DictationSocket(socket);
	}

	send(pcm: Uint8Array<ArrayBuffer>): void {
		if (this.socket.readyState === WebSocket.OPEN) {
			this.socket.send(pcm);
		}
	}

	finish(): Promise<string> {
		if (this.finishing === undefined) {
			this.finishing = Promise.withResolvers();
			if (this.ended) {
				this.finishing.reject(this.closing());
			} else {
				this.socket.send("finish");
			}
		}
		return this.finishing.promise;
	}

	dispose(): void {
		this.socket.removeEventListener("message", this.receive);
		this.socket.removeEventListener("close", this.closed);
		this.socket.close();
		this.dispatcher.dispose();
	}

	private readonly receive = ({ data }: MessageEvent): void => {
		const message = JSON.parse(String(data)) as DictationMessage;
		if (message.type === "heard") {
			this.dispatcher.dispatch("heard", message.text);
		} else if (message.type === "failed") {
			this.failure = new DictationFailure(message.message, message.cred);
			this.dispatcher.dispatch("failed");
		} else {
			this.ended = true;
			this.finishing?.resolve(message.text);
		}
	};

	private readonly closed = (): void => {
		if (this.ended) {
			return;
		}
		this.ended = true;
		this.finishing?.reject(this.closing());
		this.dispatcher.dispatch("closed");
	};

	private closing(): DictationFailure {
		return (
			this.failure ??
			new DictationFailure("the connection to the server dropped", undefined)
		);
	}
}
