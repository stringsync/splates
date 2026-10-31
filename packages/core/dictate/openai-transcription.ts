import { Dispatcher } from "core/events";
import type { Transcription, TranscriptionEvents } from "./transcriber";

/** What the Realtime API says that a transcription listens for. */
type ServerEvent =
	| {
			type: "conversation.item.input_audio_transcription.delta";
			item_id: string;
			delta: string;
	  }
	| {
			type: "conversation.item.input_audio_transcription.completed";
			item_id: string;
			transcript: string;
	  }
	| { type: "input_audio_buffer.committed"; item_id: string }
	| { type: "error"; error: { message: string } };

/** One take's websocket to OpenAI's Realtime API. */
export class OpenAiTranscription implements Transcription {
	private readonly dispatcher = new Dispatcher<TranscriptionEvents>();
	readonly events = this.dispatcher.events;
	/** Each item's text, in the order it was first heard. */
	private readonly items = new Map<string, string>();
	private readonly completed = new Set<string>();
	private committed: string | undefined;
	private sent = false;
	private finishing: PromiseWithResolvers<string> | undefined;
	private failure: Error | undefined;

	private constructor(private readonly socket: WebSocket) {
		socket.addEventListener("message", this.receive);
		socket.addEventListener("close", this.closed);
	}

	/** Connects with `apiKey` and sets the session up with `update`. */
	static async open(
		url: string,
		apiKey: string,
		update: object,
	): Promise<OpenAiTranscription> {
		// The DOM's type for the constructor does not know Bun takes headers.
		const options: Bun.WebSocketOptions = {
			headers: { Authorization: `Bearer ${apiKey}` },
		};
		const socket = new WebSocket(url, options as string[]);
		await new Promise((resolve, reject) => {
			socket.addEventListener("open", resolve, { once: true });
			socket.addEventListener(
				"error",
				() => reject(new Error("could not reach OpenAI's Realtime API")),
				{ once: true },
			);
		});
		const transcription = new OpenAiTranscription(socket);
		transcription.send(update);
		return transcription;
	}

	append(pcm: Uint8Array<ArrayBuffer>): void {
		if (this.failure !== undefined || this.finishing !== undefined) {
			return;
		}
		this.sent = true;
		this.send({
			type: "input_audio_buffer.append",
			audio: Buffer.from(pcm).toString("base64"),
		});
	}

	finish(): Promise<string> {
		if (this.failure !== undefined) {
			return Promise.reject(this.failure);
		}
		if (this.finishing === undefined) {
			this.finishing = Promise.withResolvers();
			// Committing nothing is an error, and there is nothing to wait for.
			if (this.sent) {
				this.send({ type: "input_audio_buffer.commit" });
			} else {
				this.finishing.resolve(this.text());
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
		const event = JSON.parse(String(data)) as ServerEvent;
		switch (event.type) {
			case "conversation.item.input_audio_transcription.delta":
				this.items.set(
					event.item_id,
					(this.items.get(event.item_id) ?? "") + event.delta,
				);
				this.dispatcher.dispatch("heard", this.text());
				break;
			case "conversation.item.input_audio_transcription.completed":
				// The final text, which can differ from the deltas that led to it.
				this.items.set(event.item_id, event.transcript);
				this.completed.add(event.item_id);
				this.dispatcher.dispatch("heard", this.text());
				this.settle();
				break;
			case "input_audio_buffer.committed":
				this.committed = event.item_id;
				this.settle();
				break;
			case "error":
				this.fail(new Error(`OpenAI said: ${event.error.message}`));
				break;
		}
	};

	private readonly closed = ({ code, reason }: CloseEvent): void => {
		this.fail(
			new Error(
				`OpenAI closed the connection (${code}${reason ? `: ${reason}` : ""})`,
			),
		);
	};

	/** Resolves `finish` once every item, the committed one too, is final. */
	private settle(): void {
		if (
			this.finishing === undefined ||
			this.committed === undefined ||
			!this.completed.has(this.committed)
		) {
			return;
		}
		for (const id of this.items.keys()) {
			if (!this.completed.has(id)) {
				return;
			}
		}
		this.finishing.resolve(this.text());
	}

	private fail(error: Error): void {
		if (this.failure !== undefined) {
			return;
		}
		this.failure = error;
		this.dispatcher.dispatch("failed", error);
		this.finishing?.reject(error);
	}

	private text(): string {
		return [...this.items.values()]
			.map((text) => text.trim())
			.filter((text) => text !== "")
			.join(" ");
	}

	private send(event: object): void {
		this.socket.send(JSON.stringify(event));
	}
}
