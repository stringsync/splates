import {
	askSystemOne,
	type EndpointOptions,
	type Judge,
	type JudgeOptions,
	type Judgment,
} from "./system-one";

/** Clef's smaller model, several times faster than `clef`: a pick waits on it. */
const MODEL = "clef-flash";

/** Cloudflare's decision model on Workers AI. */
export class Clef implements Judge {
	constructor(
		/** The Cloudflare account id Workers AI bills. */
		private readonly account: string,
		/** An API token with Workers AI read access. */
		private readonly token: string,
		private readonly opts: EndpointOptions = {},
	) {}

	judge(judgment: Judgment, opts: JudgeOptions = {}) {
		return askSystemOne(
			"Clef",
			`${this.opts.origin ?? "https://api.cloudflare.com"}/client/v4/accounts/${this.account}/ai/run/@cf/cloudflare/${MODEL}`,
			this.token,
			judgment,
			{ ...opts, fetch: this.opts.fetch },
		);
	}
}
