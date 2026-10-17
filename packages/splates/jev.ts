import {
	askSystemOne,
	type EndpointOptions,
	type Judge,
	type JudgeOptions,
	type Judgment,
} from "./system-one";

/** Jev's model, as TypeSafe names it. */
const MODEL = "jev-latest";

/** TypeSafe's decision model. */
export class Jev implements Judge {
	constructor(
		/** A TypeSafe API key. */
		private readonly token: string,
		private readonly opts: EndpointOptions = {},
	) {}

	judge(judgment: Judgment, opts: JudgeOptions = {}) {
		return askSystemOne(
			"Jev",
			`${this.opts.origin ?? "https://api.typesafe.ai"}/v1/systemone`,
			this.token,
			{ model: MODEL, ...judgment },
			{ ...opts, fetch: this.opts.fetch },
		);
	}
}
