import {
	DictationFailure,
	DictationRelay,
	type Transcriber,
} from "webappwiz/dictate";
import type { Connection } from "./dev-sockets";
import { OPENAI_KEY } from "./dev-transcriber";

/**
 * One dictation's socket, relaying the page's audio to a transcription and
 * its text back. A socket that closes takes its transcription with it: the
 * text heard so far is already in the composer.
 */
export class DictationConnection implements Connection {
	private relay: DictationRelay | undefined;

	constructor(
		/** Null when the project has no key, which the Creds page now asks for. */
		private readonly transcriber: Promise<Transcriber | null>,
	) {}

	open(socket: Bun.ServerWebSocket<Connection>): void {
		this.relay = new DictationRelay(
			{
				send: (message) => socket.send(message),
				hangUp: () => socket.close(),
			},
			this.transcriber.then((transcriber) => {
				if (transcriber === null) {
					throw new DictationFailure(
						`dictation needs ${OPENAI_KEY}: add it on the Creds page`,
						OPENAI_KEY,
					);
				}
				return transcriber;
			}),
		);
	}

	message(
		_socket: Bun.ServerWebSocket<Connection>,
		message: string | Buffer<ArrayBuffer>,
	): void {
		this.relay?.receive(
			typeof message === "string" ? message : new Uint8Array(message),
		);
	}

	closed(): void {
		this.relay?.dispose();
	}
}
