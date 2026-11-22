import type { Fs, Ps } from "core/system";
import { fail } from "../exit";
import { splatesHome } from "../models";
import type { Handler } from "../server/shared";
import { type Document, FsStorage } from "../storage";
import { Adherence } from "./adherence";
import { landed } from "./landed";
import { Outcomes } from "./outcomes";
import { overridesByCell, overridesTaskText } from "./overrides";
import { isPeriodId, PERIODS, summarize } from "./stats";

/**
 * What the page reads of how tasks ended: the Stats page's sums, and how one
 * merged or removed task went. Any project on this machine counts.
 */
export class DevOutcomes {
	private readonly outcomes: Outcomes;
	private readonly dismissed: Document<number>;
	/** What `splates server` judged of each conversation as its turns ended. */
	readonly adherence: Adherence;

	constructor({ fs, ps }: { fs: Fs; ps: Ps }) {
		const storage = new FsStorage(splatesHome(ps), fs);
		this.outcomes = new Outcomes(storage);
		this.dismissed = storage.document("auto-pick-overrides-dismissed.json");
		this.adherence = new Adherence(storage);
	}

	/** `?period=` names the period, as `PERIODS` does, or `all` for all time; 7 days for none. `?project=` narrows it to that main tree. */
	readonly stats: Handler = async (request) => {
		const params = new URL(request.url).searchParams;
		const period = params.get("period") ?? "7d";
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
				project: params.get("project") ?? undefined,
				judged: await this.adherence.list(),
			}),
		);
	};

	/** `?project=` narrows it to that main tree. */
	readonly overrides: Handler = async (request) => {
		const params = new URL(request.url).searchParams;
		const project = params.get("project");
		const outcomes = await this.outcomes.log.replay();
		const history =
			params.get("view") === "notice"
				? outcomes.slice((await this.dismissed.read()) ?? 0)
				: outcomes;
		return Response.json(
			overridesByCell(
				history.filter((each) => project === null || each.project === project),
			),
			{ headers: { "X-Override-Cursor": String(outcomes.length) } },
		);
	};

	/** Acknowledge only the append-only history that the page actually saw. */
	readonly dismissOverrides: Handler = async (request) => {
		const cursor = (await request.json())?.cursor;
		if (
			!Number.isSafeInteger(cursor) ||
			cursor < 0 ||
			cursor > (await this.outcomes.log.replay()).length
		) {
			fail("usage", "Invalid override cursor");
		}
		await this.dismissed.update((previous) => Math.max(previous ?? 0, cursor));
		return Response.json({});
	};

	/**
	 * The words of the board task that has an agent update the Auto pick
	 * rules from the overrides, or null when there are none to read.
	 */
	async overridesTask(): Promise<string | null> {
		return overridesTaskText(overridesByCell(await this.outcomes.log.replay()));
	}

	/** How `/api/tasks/:task/outcome`'s task went once it merged in `project`, or with `?ended=removed` once it was removed; null when it never did. */
	landed(project: string): Handler {
		return async (request) => {
			const url = new URL(request.url);
			return Response.json(
				landed(
					await this.outcomes.list(),
					project,
					decodeURIComponent(url.pathname.split("/")[3] ?? ""),
					url.searchParams.get("ended") === "removed" ? "removed" : "merged",
				),
			);
		};
	}
}
