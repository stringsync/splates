import type { Resource } from "webappwiz/disposable";
import type { Fs } from "webappwiz/system";
import { Duration, SystemTimer, type Timer } from "webappwiz/time";
import { fail } from "../exit";
import type { Shipping } from "./run";

/** How often a running ship's output is read again. */
const OUTPUT_EVERY = Duration.ms(250);

/**
 * A project's ship over HTTP: the latest one, starting one, and its output
 * as it prints. Only the person starts a ship: `splates ship` refuses an
 * agent before it asks, as the page's own action will.
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

	/** Starts a ship, answering with it once it runs. */
	readonly startShip = async (): Promise<Response> =>
		Response.json(await this.#shipping.start(), { status: 201 });

	/** Types the one-time password npm asks for into the ship; the code is not kept. */
	readonly answerShipOtp = async (request: Request): Promise<Response> => {
		const { code } = (await request.json().catch(() => ({}))) as {
			code?: unknown;
		};
		if (typeof code !== "string" || !/^\d{4,10}$/.test(code.trim())) {
			fail("usage", "the code is the digits npm's app shows");
		}
		await this.#shipping.answerOtp(code.trim());
		return Response.json({ ok: true });
	};

	/** What the latest ship printed, then more as it prints, ending with it. */
	readonly shipOutput = async (): Promise<Response> => {
		const [shipping, fs, timer] = [this.#shipping, this.#fs, this.#timer];
		const path = shipping.output;
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
