import type { Fs, Ps } from "core/system";
import { SystemWallClock } from "core/time";
import { AutoPickStore } from "../auto-pick/scoring";
import { Exit, fail } from "../exit";
import { Roster, splatesHome } from "../models";
import type { Event } from "../records";
import type { Handler } from "../server/shared";
import { type Document, FsStorage } from "../storage";
import { Adherence } from "./adherence";
import {
	IMPROVEMENTS_SPAN,
	improvementsKey,
	improvementsTaskText,
	overpoweredLineups,
} from "./improvements";
import { landed } from "./landed";
import { Outcomes } from "./outcomes";
import { overridesByCell, overridesByLineup } from "./overrides";
import { rulesTaskText } from "./rules-task";
import {
	SCORECARD_MIN_TASKS,
	type ScorecardRow,
	scorecard,
	scorecardWindow,
} from "./scorecard";
import { isPeriodId, PERIODS, type PeriodId, summarize } from "./stats";

interface ScorecardEvents {
	ofProject(project: string): Promise<Event[]>;
}

const NO_SCORECARD_EVENTS: ScorecardEvents = { ofProject: async () => [] };

/**
 * What the page reads of how tasks ended: the Stats page's sums, and how one
 * merged or removed task went. Any project on this machine counts.
 */
export class DevOutcomes {
	private readonly outcomes: Outcomes;
	private readonly dismissed: Document<number>;
	private readonly improvementsDismissed: Document<string>;
	private readonly roster: Roster;
	private readonly autoPick: AutoPickStore;
	private readonly clock = new SystemWallClock();
	/** What `splates server` judged of each conversation as its turns ended. */
	readonly adherence: Adherence;

	constructor(
		{ fs, ps }: { fs: Fs; ps: Ps },
		private readonly events: ScorecardEvents = NO_SCORECARD_EVENTS,
	) {
		const storage = new FsStorage(splatesHome(ps), fs);
		this.outcomes = new Outcomes(storage);
		this.roster = Roster.in(storage);
		this.autoPick = new AutoPickStore(storage.path("auto-pick.json"), { fs });
		this.dismissed = storage.document("auto-pick-overrides-dismissed.json");
		this.improvementsDismissed = storage.document(
			"auto-pick-improvements-dismissed.json",
		);
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

	/** How Auto pick’s recorded tasks ended over the requested window. */
	readonly scorecard: Handler = async (request) => {
		const period = new URL(request.url).searchParams.get("period") ?? "7d";
		if (!isPeriodId(period)) {
			fail("usage", "Unknown scorecard period", { period });
		}
		const { rows, history, agents } = await this.scored(period);
		return Response.json({
			minimumTasks: SCORECARD_MIN_TASKS,
			rows,
			overrides: overridesByLineup(history, agents),
		});
	};

	/**
	 * How many lineups the holdout shows are stronger than some of their
	 * cells need over the last 30 days, and the key that dismisses them; a
	 * count of 0 once that key is dismissed.
	 */
	readonly improvements: Handler = async () => {
		const { key, lineups } = await this.improved();
		const dismissed = await this.improvementsDismissed.read();
		return Response.json({
			count: key === dismissed ? 0 : lineups.length,
			key,
		});
	};

	/** Hides the improvements the page saw until what is flagged changes. */
	readonly dismissImprovements: Handler = async (request) => {
		const key = (await request.json())?.key;
		if (typeof key !== "string") {
			fail("usage", "Invalid improvements key");
		}
		await this.improvementsDismissed.write(key);
		return Response.json({});
	};

	/**
	 * The words of the board task that has an agent act on the possible
	 * improvements, and the key that dismisses them once it is sent; null
	 * when there are none.
	 */
	async improvementsTask(): Promise<{ text: string; key: string } | null> {
		const { key, lineups, rules } = await this.improved();
		const text = improvementsTaskText(lineups, rules);
		return text === null ? null : { text, key };
	}

	/** Hides the improvements under `key`, as once they are sent to an agent. */
	async improvementsSent(key: string): Promise<void> {
		await this.improvementsDismissed.write(key);
	}

	private async improved() {
		const { rows, rules } = await this.scored({ span: IMPROVEMENTS_SPAN });
		const lineups = overpoweredLineups(rows);
		return { lineups, rules, key: improvementsKey(lineups) };
	}

	private async scorecardRows(
		period: PeriodId | { span: number },
	): Promise<ScorecardRow[]> {
		return (await this.scored(period)).rows;
	}

	private async scored(period: PeriodId | { span: number }) {
		const { history, picks } = scorecardWindow(
			await this.outcomes.list(),
			period,
			this.clock.now(),
		);
		const projects = new Set(
			picks
				.filter((outcome) => outcome.conversation !== null)
				.map((outcome) => outcome.project),
		);
		const [agents, rules, events] = await Promise.all([
			this.roster.agents(),
			this.autoPick.rules().catch((error: unknown) => {
				if (error instanceof Exit) {
					return null;
				}
				throw error;
			}),
			Promise.all(
				[...projects].map(
					async (project) =>
						[project, await this.events.ofProject(project)] as const,
				),
			),
		]);
		return {
			rules,
			history,
			agents,
			rows: scorecard(picks, {
				agents,
				eventsByProject: new Map(events),
				rules,
			}),
		};
	}

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
	 * The words of the board task that has an agent propose Auto pick rule
	 * changes from every recorded task's scorecard, or null when no cell is
	 * flagged.
	 */
	async rulesTask(): Promise<string | null> {
		return rulesTaskText({
			rows: await this.scorecardRows("all"),
			overrides: overridesByCell(await this.outcomes.log.replay()),
			minimumTasks: SCORECARD_MIN_TASKS,
		});
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
