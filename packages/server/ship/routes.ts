import { z } from "zod";
import type { ShipCommands } from "./commands";
import { ShipComposer } from "./compose";
import { ComposeError } from "./compose-error";
import { PICK } from "./wire";

const PICKS = z.object({ picks: z.array(PICK) });

/**
 * What the Ships page calls to plan a ship: `GET /api/ship/targets` lists
 * what the registered commands serve, `GET /api/ship/unshipped` counts what
 * each has waiting, and `POST /api/ship/plan` composes a pick of them.
 */
export class ShipPlanRoutes {
	readonly #commands: ShipCommands;
	readonly #composer: ShipComposer;

	constructor(commands: ShipCommands) {
		this.#commands = commands;
		this.#composer = new ShipComposer(commands);
	}

	/** Every target each command serves, and the commands that failed. */
	readonly shipTargets = async (): Promise<Response> =>
		Response.json(await this.#commands.list());

	/** Each target's unshipped commit count, by name, for those that count. */
	readonly shipUnshipped = async (): Promise<Response> =>
		Response.json(await this.#commands.unshipped());

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
