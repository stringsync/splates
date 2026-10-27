import { fail } from "../exit";
import type { Cascades } from "./cascade";
import type { ShipBump } from "./plan";

/**
 * The machine's ship cascade over HTTP, for `splates ship` and the page:
 * the one under way or the last to end, starting one from a project, and
 * revising, retrying or dropping a project in it.
 */
export class CascadeRoutes {
	// Only the person starts a ship: `splates ship` refuses an agent before
	// it asks, and the page's Approve is the person's own.
	readonly #cascades: Cascades;
	readonly #slugOf: (request: Request) => Promise<string>;

	constructor(
		cascades: Cascades,
		/** The project a request names with `?project=`, or the focused one. */
		slugOf: (request: Request) => Promise<string>,
	) {
		this.#cascades = cascades;
		this.#slugOf = slugOf;
	}

	/** The cascade under way, or the last to end, or null when none ran. */
	readonly cascade = async (): Promise<Response> =>
		Response.json(await this.#cascades.current());

	/** The plan to ship the project at `?bump=`, what Approve on the page starts. */
	readonly plan = async (request: Request): Promise<Response> =>
		Response.json(
			await this.#cascades.plan(await this.#slugOf(request), bumpOf(request)),
		);

	/**
	 * Starts the cascade of the project's ship, 201 with it; 200 with the one
	 * under way when there is one, which it does not start a second beside.
	 */
	readonly startCascade = async (request: Request): Promise<Response> => {
		const { cascade, started } = await this.#cascades.start(
			await this.#slugOf(request),
			bumpOf(request),
		);
		return Response.json(cascade, { status: started ? 201 : 200 });
	};

	/** Changes the pending publish `?project=` names to `?bump=`. */
	readonly reviseCascadeBump = async (request: Request): Promise<Response> => {
		const bump = bumpOf(request);
		if (bump === undefined) {
			fail("usage", "changing a pending publish needs `bump`");
		}
		return Response.json(
			await this.#cascades.revise(await this.#slugOf(request), bump),
		);
	};

	/** Drops the project `?project=` names from the cascade under way. */
	readonly dropFromCascade = async (request: Request): Promise<Response> =>
		Response.json(await this.#cascades.drop(await this.#slugOf(request)));

	/** Runs the project `?project=` names again where it failed or stopped. */
	readonly retryInCascade = async (request: Request): Promise<Response> =>
		Response.json(await this.#cascades.retry(await this.#slugOf(request)));
}

/** The `bump` a request names, or undefined to use patch. */
function bumpOf(request: Request): ShipBump | undefined {
	const bump = new URL(request.url).searchParams.get("bump");
	if (bump === null) {
		return undefined;
	}
	if (bump !== "patch" && bump !== "minor" && bump !== "major") {
		fail("usage", "bump is patch, minor or major");
	}
	return bump;
}
