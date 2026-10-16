import { body } from "./dev-http";
import { fail } from "./exit";
import type { Setup } from "./setup";

/**
 * How the page reads this machine's setup and skips its steps. Not any
 * project's: every page on the server shares one machine. Each handler is a
 * property, so `dev` hands them straight to its routes.
 */
export class SetupRoutes {
	readonly #setup: Setup;

	constructor(setup: Setup) {
		this.#setup = setup;
	}

	/** Every step checked, by area, and the one to do next. */
	readonly read = async (): Promise<Response> =>
		Response.json(await this.#setup.read());

	/** Skips the step `/api/setup/:step/skipped` names, or asks for it again. */
	readonly skip = async (request: Request): Promise<Response> => {
		const step = decodeURIComponent(
			new URL(request.url).pathname.split("/")[3] ?? "",
		);
		const { skipped } = await body(request);
		if (typeof skipped !== "boolean") {
			fail("usage", "say whether the step is skipped: { skipped: boolean }", {
				step,
			});
		}
		await (skipped ? this.#setup.skip(step) : this.#setup.unskip(step));
		return Response.json(await this.#setup.read());
	};
}
