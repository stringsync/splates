import type { Judge } from "@stringsync/splates-server/models";
import { QUESTIONS, tierFor } from "@stringsync/splates-server/models";

/** A first prompt, and the tier a person would start it on. */
export interface Case {
	prompt: string;
	tier: number;
}

/**
 * Labelled prompts, a handful per tier, as a user might open a conversation:
 * 1 a quick answer or a spelled-out edit, 2 light work, 3 a design call or a
 * change across files, 4 broad, open-ended design work.
 */
export const CASES: Case[] = [
	{ prompt: "What does `splates heavy` do?", tier: 1 },
	{ prompt: "Which file defines the roster's default agents?", tier: 1 },
	{
		prompt: "Rename the `pressed` function in auto-pick.ts to `mostUsed`.",
		tier: 1,
	},
	{ prompt: "Fix the typo 'recieve' in packages/splates/README.md.", tier: 1 },
	{ prompt: "Bump zod to ^4.5.0 in packages/splates/package.json.", tier: 1 },
	{
		prompt:
			"Add a `--json` flag to `splates agents` that prints the roster as JSON instead of a table.",
		tier: 2,
	},
	{
		prompt:
			"The task list's AGE column shows '1h' for a task added a day ago. Fix it and add a test.",
		tier: 2,
	},
	{
		prompt:
			"Write tests for `modelOption` in models.ts covering exact and provider-qualified ids.",
		tier: 2,
	},
	{
		prompt:
			"Replace every `console.log` in packages/splates/*.ts with the logger from webappwiz/log.",
		tier: 2,
	},
	{
		prompt:
			"Design how conversations should be archived after a month: what is kept, where, and how the page shows it.",
		tier: 3,
	},
	{
		prompt:
			"Merges sometimes leave the worktree locked when the tests time out. Find out why and fix it.",
		tier: 3,
	},
	{
		prompt:
			"Add per-project spend limits: a setting, enforcement when starting a conversation, and a warning on the page.",
		tier: 3,
	},
	{
		prompt:
			"Should the creds store move from the Keychain to a file we encrypt ourselves? Weigh it up and recommend one.",
		tier: 3,
	},
	{
		prompt:
			"Plan and build a worker pool so tasks run on several machines: scheduling, checkout, merge locking, and a page to watch it.",
		tier: 4,
	},
	{
		prompt:
			"Rethink how agents hand work to each other across projects; today's handoff, relay and lanes overlap. Propose a model and migrate to it.",
		tier: 4,
	},
	{
		prompt:
			"Research how other multi-agent coding tools isolate work, then redesign our worktree, merge and review flow around what you find.",
		tier: 4,
	},
];

/** How a judge did on `CASES`, the way `wiz scry eval` reports a rule's cases. */
export interface Score {
	total: number;
	/** Cases whose tier came out exactly as labelled. */
	exact: number;
	/** Cases a tier off or exact: a probe a tier off can still hand on. */
	near: number;
	/** Every case that came out other than labelled. */
	misses: { prompt: string; tier: number; got: number }[];
}

/** Asks `judge` every case's questions, as `pick` does, and scores the tiers. */
export async function score(judge: Judge, cases = CASES): Promise<Score> {
	const questions = Object.fromEntries(
		Object.entries(QUESTIONS).map(([id, { yes: _, ...noul }]) => [id, noul]),
	);
	const got = await Promise.all(
		cases.map(async (each) => {
			const verdict = await judge.judge({
				state: { prompt: each.prompt },
				questions,
			});
			return tierFor(verdict.answers);
		}),
	);
	const misses = cases.flatMap((each, i) => {
		const tier = got[i] ?? 0;
		return tier === each.tier
			? []
			: [{ prompt: each.prompt, tier: each.tier, got: tier }];
	});
	return {
		total: cases.length,
		exact: cases.length - misses.length,
		near:
			cases.length -
			misses.filter((each) => Math.abs(each.got - each.tier) > 1).length,
		misses,
	};
}
