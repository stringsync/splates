import { Jev } from "@splates/server/auto-pick";
import { splatesHome } from "@splates/server/models";
import type { Repository } from "@splates/server/records";
import {
	findRelated,
	gather,
	relatedLines,
	wordsOf,
} from "@splates/server/related";
import type { SplatesDeps } from "@splates/server/server";
import { Spend } from "@splates/server/spend";
import { FsStorage } from "@splates/server/storage";

/** How long an add waits on Jev before naming related tasks by words alone. */
const JUDGE_TIMEOUT_MS = 15_000;

/**
 * Prints, under a new task's add, the tasks most related to it in any state,
 * so its agent reads them before building. Never fails the add: a lookup
 * that breaks says so in a line.
 */
export async function printRelated(
	ctx: SplatesDeps & Repository,
	task: string,
	{
		goal,
		taking,
		shown,
	}: { goal: string | undefined; taking: number[]; shown: number },
): Promise<void> {
	try {
		const all = await ctx.tasks.all();
		const taken = all.filter((each) => taking.includes(each.id));
		const words = taken.map((each) => wordsOf(each.text));
		const query = {
			title:
				taken.map((each) => each.subject).join("; ") ||
				task.replaceAll("-", " "),
			goal: [goal ?? "", ...words.map((each) => each.goal)]
				.filter(Boolean)
				.join("\n\n"),
			details: words.map((each) => each.details).join("\n\n"),
			files: [],
		};
		const pool = await gather(ctx, {
			trunk: ctx.config.trunk,
			self: task,
			taking,
		});
		const off = ctx.ps.env(RELATED_JUDGE_ENV) === "off";
		const found = await findRelated(
			query,
			pool,
			off ? null : await judgeOf(ctx, task),
			{
				signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
				shown,
				...(off ? { unjudged: `${RELATED_JUDGE_ENV} is off` } : {}),
			},
		);
		ctx.log.info(relatedLines(found).join("\n"));
	} catch (error) {
		ctx.log.info(
			`  related: not looked up (${error instanceof Error ? error.message : String(error)})`,
		);
	}
}

/** Set to `off` to keep `splates add` from asking Jev, naming related tasks by shared words alone. */
export const RELATED_JUDGE_ENV = "SPLATES_RELATED_JUDGE";

/** Jev, its calls recorded on the Billing page as `jev-latest related`; null without its key. */
async function judgeOf(
	ctx: SplatesDeps & Repository,
	task: string,
): Promise<Jev | null> {
	const token = await ctx.creds.credentials.get("TYPESAFE_API_KEY");
	if (!token) {
		return null;
	}
	const project =
		(await ctx.projects.list()).find((each) => each.root === ctx.git.root)
			?.slug ?? null;
	return new Jev(token, {
		...(ctx.fetch === undefined ? {} : { fetch: ctx.fetch }),
		spend: new Spend(new FsStorage(splatesHome(ctx.ps), ctx.fs)),
		attribution: {
			project,
			task,
			conversation: ctx.ps.env("SPLATES_CONVERSATION") ?? null,
			purpose: "related",
		},
	});
}
