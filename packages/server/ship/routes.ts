import { z } from "zod";
import type { Listing, ShipCommands } from "./commands";
import { ShipComposer } from "./compose";
import { ComposeError } from "./compose-error";
import { PICK } from "./wire";

const PICKS = z.object({ picks: z.array(PICK) });

/**
 * What the Ships page calls to plan a ship: `GET /api/ship/targets` lists
 * what the registered commands serve, `GET /api/ship/unshipped` counts what
 * each has waiting, `GET /api/ship/current` reads each one's current version, `GET /api/ship/versions` the versions each may ship, and `POST /api/ship/plan` composes a pick of them.
 */
export class ShipPlanRoutes {
	readonly #commands: ShipCommands;
	readonly #composer: ShipComposer;
	#last: Listing | null = null;
	#reading: Promise<Listing> | null = null;

	constructor(commands: ShipCommands) {
		this.#commands = commands;
		this.#composer = new ShipComposer(commands);
	}

	/**
	 * `GET /api/ship/targets`: every target each command serves, and the
	 * commands that failed. Send `?fresh=1` to wait for a fresh read; without
	 * it, the answer may be the last listing, marked `stale`.
	 */
	readonly shipTargets = async (request: Request): Promise<Response> => {
		const fresh = new URL(request.url).searchParams.get("fresh") === "1";
		const reading = this.#read();
		if (this.#last !== null && !fresh) {
			reading.catch(() => {});
			return Response.json({ ...this.#last, stale: true });
		}
		return Response.json(await reading);
	};

	#read(): Promise<Listing> {
		this.#reading ??= this.#commands
			.list()
			.then((listing) => {
				this.#last = listing;
				return listing;
			})
			.finally(() => {
				this.#reading = null;
			});
		return this.#reading;
	}

	/** Each target's unshipped commit count, by name, for those that count. */
	readonly shipUnshipped = async (): Promise<Response> =>
		Response.json(await this.#commands.unshipped());

	/** Each target's current version, by name, for those that can say. */
	readonly shipCurrent = async (): Promise<Response> =>
		Response.json(await this.#commands.current());

	/** Each target's shippable versions, newest first, for those that can say. */
	readonly shipVersions = async (): Promise<Response> =>
		Response.json(await this.#commands.shippable());

	/** One plan for `{ picks: [{ name, bump?, version? }] }`. */
	readonly shipPlan = async (request: Request): Promise<Response> => {
		const body = PICKS.safeParse(await request.json().catch(() => null));
		if (!body.success) {
			return Response.json(
				{ error: "send { picks: [{ name, bump?, version? }] }" },
				{ status: 400 },
			);
		}
		try {
			return Response.json(await this.#composer.compose(body.data.picks));
		} catch (error) {
			if (error instanceof ComposeError) {
				return Response.json({ error: error.message }, { status: 400 });
			}
			throw error;
		}
	};
}
