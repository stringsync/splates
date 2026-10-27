import type { Cascades } from "./cascade";

/**
 * The machine's ship cascade over HTTP: the one under way or the last to
 * end, starting one from a project, and dropping a project from it. Only
 * the person starts a ship: `splates ship` refuses an agent before it asks,
 * and the page's Approve is the person's own.
 */
export class CascadeRoutes {
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

	/** The plan to ship the project, what Approve on the page starts. */
	readonly plan = async (request: Request): Promise<Response> =>
		Response.json(await this.#cascades.plan(await this.#slugOf(request)));

	/**
	 * Starts the cascade of the project's ship, 201 with it; 200 with the one
	 * under way when there is one, which it does not start a second beside.
	 */
	readonly startCascade = async (request: Request): Promise<Response> => {
		const { cascade, started } = await this.#cascades.start(
			await this.#slugOf(request),
		);
		return Response.json(cascade, { status: started ? 201 : 200 });
	};

	/** Drops the project `?project=` names from the cascade under way. */
	readonly dropFromCascade = async (request: Request): Promise<Response> =>
		Response.json(await this.#cascades.drop(await this.#slugOf(request)));
}
