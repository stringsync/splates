import type { Resource } from "webappwiz/disposable";
import type { Fs } from "webappwiz/system";
import { Duration, SystemTimer, type Timer } from "webappwiz/time";
import type { Shipping } from "./run";

/** How often a running ship's output is read again. */
const OUTPUT_EVERY = Duration.ms(250);

/**
 * A project's ship over HTTP: the latest one, and its output as it prints.
 * A ship starts as the first step of a cascade, through {@link CascadeRoutes}.
 */
export class ShipRoutes {
	readonly #shipping: Shipping;
	readonly #fs: Fs;
	readonly #timer: Timer;

	constructor(shipping: Shipping, fs: Fs, timer: Timer = new SystemTimer()) {
		this.#shipping = shipping;
		this.#fs = fs;
		this.#timer = timer;
	}

	/** The latest ship, or null when the project never shipped. */
	readonly ship = async (): Promise<Response> =>
		Response.json(await this.#shipping.current());

	/** What the latest ship printed, then more as it prints, ending with it. */
	readonly shipOutput = async (): Promise<Response> => {
		const [shipping, fs, timer] = [this.#shipping, this.#fs, this.#timer];
		const path = await shipping.outputOf();
		let read = 0;
		let cancelled = false;
		let waiting: Resource | null = null;
		const next = async (
			stream: ReadableStreamDefaultController<Uint8Array>,
		): Promise<void> => {
			if (cancelled) {
				return;
			}
			// Asked before reading, so what it printed last is read once it ends.
			const going = shipping.running;
			const bytes = (await fs.exists(path))
				? await fs.readBytes(path)
				: new Uint8Array(0);
			if (bytes.byteLength > read) {
				stream.enqueue(bytes.slice(read));
				read = bytes.byteLength;
			}
			if (!going) {
				stream.close();
				return;
			}
			waiting = timer.setTimeout(() => {
				void next(stream).catch((error: unknown) => stream.error(error));
			}, OUTPUT_EVERY);
		};
		return new Response(
			new ReadableStream<Uint8Array>({
				start: (stream) => next(stream),
				cancel: () => {
					cancelled = true;
					waiting?.dispose();
				},
			}),
			{ headers: { "content-type": "text/plain; charset=utf-8" } },
		);
	};
}
