import { Dispatcher } from "webappwiz/events";
import type { Logger } from "webappwiz/log";
import type { Allocation, JobEvents, JobHandle } from "./job";

/** How a client sends the `splates server` a request: `fetch`, or a stand-in. */
export type JobSend = (url: string, init: RequestInit) => Promise<Response>;

/** The `splates server` whose scheduler a client submits to, and how it sends to it. */
export interface JobServer {
	url: string;
	send: JobSend;
}

/**
 * A job submitted to the server's scheduler, held open over its event
 * stream: what the stream says, the handle tells; the stream's end before
 * `finish` means the server is lost. Closing the stream is how the server
 * learns a holder is gone.
 */
export class RemoteJob implements JobHandle {
	readonly #dispatcher = new Dispatcher<JobEvents>();
	readonly events = this.#dispatcher.events;
	allocation: Allocation | null = null;
	place: number | null = null;
	#reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
	#finished = false;

	constructor(
		readonly id: string,
		private readonly server: JobServer,
		private readonly log: Logger,
	) {}

	/** Opens its event stream, resolving once the server has answered on it. */
	async open(signal?: AbortSignal): Promise<void> {
		const { url, send } = this.server;
		const response = await send(`${url}/api/jobs/${this.id}/events`, {
			headers: { origin: url },
			...(signal === undefined ? {} : { signal }),
		});
		if (!response.ok || response.body === null) {
			throw new Error(
				`splates server did not open job ${this.id}'s events: ${response.status}`,
			);
		}
		this.#reader = response.body.getReader();
		const answered = Promise.withResolvers<void>();
		void this.#read(this.#reader, answered);
		await answered.promise;
	}

	async renew(): Promise<void> {
		const { url, send } = this.server;
		await send(`${url}/api/jobs/${this.id}/renew`, {
			method: "POST",
			headers: { origin: url },
		}).catch((error: unknown) => {
			this.log.error(
				`job ${this.id} could not be renewed: ${error instanceof Error ? error.message : String(error)}`,
			);
		});
	}

	async finish(): Promise<void> {
		if (this.#finished) {
			return;
		}
		this.#finished = true;
		await this.#reader?.cancel().catch(() => {});
		const { url, send } = this.server;
		await send(`${url}/api/jobs/${this.id}`, {
			method: "DELETE",
			headers: { origin: url },
		}).catch(() => {
			// Gone with the stream's end, which the server took as the finish.
		});
		this.#dispatcher.dispose();
	}

	async #read(
		reader: ReadableStreamDefaultReader<Uint8Array>,
		answered: PromiseWithResolvers<void>,
	): Promise<void> {
		const decoder = new TextDecoder();
		let buffer = "";
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				buffer += decoder.decode(value, { stream: true });
				let end = buffer.indexOf("\n\n");
				while (end !== -1) {
					answered.resolve();
					this.#take(buffer.slice(0, end));
					buffer = buffer.slice(end + 2);
					end = buffer.indexOf("\n\n");
				}
			}
		} catch (error) {
			if (!this.#finished) {
				this.log.error(
					`job ${this.id}'s events ended: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
		answered.resolve();
		if (!this.#finished) {
			this.#dispatcher.dispatch("lost");
		}
	}

	/** One server-sent event, its `event:` and `data:` lines; a comment says nothing. */
	#take(chunk: string): void {
		let event = "";
		let data = "";
		for (const line of chunk.split("\n")) {
			if (line.startsWith("event:")) {
				event = line.slice(6).trim();
			} else if (line.startsWith("data:")) {
				data = line.slice(5).trim();
			}
		}
		switch (event) {
			case "placed":
				this.place = Number(data);
				this.#dispatcher.dispatch("placed", this.place);
				break;
			case "started":
				this.place = null;
				this.allocation = JSON.parse(data || "{}") as Allocation;
				this.#dispatcher.dispatch("started", this.allocation);
				break;
			case "preempted":
			case "expired":
				this.allocation = null;
				this.#dispatcher.dispatch(event);
				break;
			default:
				break;
		}
	}
}
