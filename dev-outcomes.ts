import type { Fs, Ps } from "webappwiz/system";
import { Adherence } from "./adherence";
import type { Handler } from "./dev-project";
import { fail } from "./exit";
import { landed } from "./landed";
import { Outcomes } from "./outcomes";
import { arborHome } from "./roster";
import { isPeriodId, PERIODS, summarize } from "./stats";

/**
 * What the page reads of how tasks ended, from the records every project on
 * this machine shares, so one not open here still counts: the Stats page's
 * sums, and how one merged task went.
 */
export class DevOutcomes {
	private readonly outcomes: Outcomes;
	/** What `arbor dev` judged of each conversation as its turns ended. */
	readonly adherence: Adherence;

	constructor({ fs, ps }: { fs: Fs; ps: Ps }) {
		this.outcomes = new Outcomes(`${arborHome(ps)}/outcomes.jsonl`, fs);
		this.adherence = new Adherence(
			`${arborHome(ps)}/adherence.jsonl`,
			fs,
			this.outcomes,
		);
	}

	/** `?period=` names the period, as `PERIODS` does, or `all` for all time; 7 days for none. */
	readonly stats: Handler = async (request) => {
		const period = new URL(request.url).searchParams.get("period") ?? "7d";
		if (!isPeriodId(period)) {
			fail(
				"usage",
				`period is one of ${[...Object.keys(PERIODS), "all"].join(", ")}: not ${period}`,
				{ period },
			);
		}
		return Response.json(
			summarize(await this.outcomes.list(), {
				period,
				judged: await this.adherence.list(),
			}),
		);
	};

	/** How `/api/tasks/:task/outcome`'s task went once it merged in `project`; null when it never did. */
	landed(project: string): Handler {
		return async (request) =>
			Response.json(
				landed(
					await this.outcomes.list(),
					project,
					decodeURIComponent(new URL(request.url).pathname.split("/")[3] ?? ""),
				),
			);
	}
}
