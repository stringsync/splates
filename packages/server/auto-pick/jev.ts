import type { Spend } from "../spend";
import {
	askSystemOne,
	type EndpointOptions,
	type Judge,
	type JudgeOptions,
	type Judgment,
} from "./system-one";

/** Jev's model, as TypeSafe names it. */
const MODEL = "jev-latest";

/**
 * Dollars per million input tokens Jev bills, output free
 * (https://docs.typesafe.ai/models.md). models.dev does not list TypeSafe,
 * so the price lives here rather than in `prices`.
 */
export const JEV_INPUT_PRICE = 0.042;

/** Whose work a judgment was for, as the ledger names them. */
export interface Attribution {
	project: string | null;
	task: string | null;
	conversation: string | null;
}

export interface JevOptions extends EndpointOptions {
	/** Where each call's cost is recorded, priced from the tokens the reply says; nowhere when not given. */
	spend?: Spend;
	/** What each call's ledger entry says it was for; nothing when not given. */
	attribution?: Attribution;
	/** When a call was made, for its ledger entry. */
	now?: () => Date;
}

/** TypeSafe's decision model. */
export class Jev implements Judge {
	constructor(
		/** A TypeSafe API key. */
		private readonly token: string,
		private readonly opts: JevOptions = {},
	) {}

	async judge(judgment: Judgment, opts: JudgeOptions = {}) {
		const verdict = await askSystemOne(
			"Jev",
			`${this.opts.origin ?? "https://api.typesafe.ai"}/v1/systemone`,
			this.token,
			{ model: MODEL, ...judgment },
			{ ...opts, fetch: this.opts.fetch },
		);
		if (this.opts.spend !== undefined && verdict.usage !== undefined) {
			// A ledger that cannot be written never costs the judgment.
			await this.opts.spend
				.record({
					at: (this.opts.now?.() ?? new Date()).toISOString(),
					provider: "typesafe",
					service: MODEL,
					kind: "billed",
					dollars: (verdict.usage.input * JEV_INPUT_PRICE) / 1_000_000,
					project: this.opts.attribution?.project ?? null,
					task: this.opts.attribution?.task ?? null,
					conversation: this.opts.attribution?.conversation ?? null,
				})
				.catch(() => {});
		}
		return verdict;
	}
}
