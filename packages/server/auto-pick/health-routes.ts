import type { Fs } from "core/system";
import { body } from "../server/shared";
import { FsStorage } from "../storage";
import { type Avoided, Health, statusPage } from "./health";

/** The models Auto pick is passing over, for the Auto pick page. */
export class HealthRoutes {
	readonly #health: Health;

	constructor({ fs, home }: { fs: Fs; home: string }) {
		this.#health = new Health(
			new FsStorage(home, fs).document("health.json"),
			statusPage(),
		);
	}

	/** The models passed over now, most errors first. */
	readonly read = async (): Promise<Response> =>
		Response.json((await this.#health.avoided(new Date())) satisfies Avoided[]);

	/** Tries the model the body's `agent` and `model` name at once ("Use anyway"). */
	readonly clear = async (request: Request): Promise<Response> => {
		const { agent, model } = await body(request);
		await this.#health.clear(
			String(agent),
			typeof model === "string" ? model : null,
			new Date(),
		);
		return Response.json(await this.#health.avoided(new Date()));
	};
}
