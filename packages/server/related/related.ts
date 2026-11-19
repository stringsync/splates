import { color } from "core/log";
import type { Fs } from "core/system";
import type { Judge } from "../auto-pick";
import type { Tasks } from "../board";
import type { Git } from "../git";
import { limited, READ_CONCURRENCY } from "../limited";
import { Plans } from "../plans";
import type { WorktreeService } from "../tasks/worktree-service";
import { type Candidate, type Query, wordsOf } from "./candidates";
import { judgeShortlist, type Verdict } from "./judge";
import { distinctWords, rank, type Scored } from "./score";

/** How many of the best-scored candidates a judge reads. */
export const SHORTLIST = 150;

/** How many related tasks an add names unless told otherwise. */
export const SHOWN = 3;

/** How far back finished tasks are looked at. */
export const LOOKBACK_DAYS = 30;

/** The most commits read for that lookback, so a busy trunk stays quick to read. */
const MAX_COMMITS = 4000;

/** The least likelihood a judge gives for a candidate to be named as related. */
const RELATED = 0.5;

/** The least share of the new task's words a candidate needs to be named unjudged. */
const UNJUDGED_SHARE = 0.4;

/** One task named as related, with what a judge said of it when one did. */
export interface Related {
	candidate: Candidate;
	verdict: Verdict | null;
}

/** What `findRelated` found. */
export interface Found {
	related: Related[];
	/** How many tasks were looked at. */
	pool: number;
	/** Whether a judge ranked them; the reason it did not when not. */
	judged: true | { reason: string };
}

/**
 * Every task a new one may be related to, whatever its state: queued tasks
 * nobody has taken, started tasks with their plans and changed files, and
 * tasks merged onto `trunk` or removed in the last `LOOKBACK_DAYS`.
 * `self` and the queued tasks it takes are left out.
 */
export async function gather(
	deps: { service: WorktreeService; tasks: Tasks; git: Git; fs: Fs },
	{
		trunk,
		self,
		taking = [],
		now = new Date(),
	}: { trunk: string; self: string; taking?: number[]; now?: Date },
): Promise<Candidate[]> {
	const since = now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
	const recent = (at: string) => Date.parse(at) >= since;
	const plans = new Plans(deps.fs);
	const [queued, started, merged, finished] = await Promise.all([
		deps.tasks.all(),
		deps.service.list(),
		deps.git.log(trunk, MAX_COMMITS),
		deps.service.finished.list(),
	]);
	const live = await limited(
		started.filter((each) => each.task !== self),
		READ_CONCURRENCY,
		async (each): Promise<Candidate> => {
			const plan = each.exists ? ((await plans.read(each.path)) ?? "") : "";
			return {
				ref: each.task,
				status: "started",
				title: each.task.replaceAll("-", " "),
				...wordsOf(plan),
				files: each.hasBranch ? ((await each.changedFiles()) ?? []) : [],
			};
		},
	);
	return [
		...queued
			.filter((each) => each.takenBy === null && !taking.includes(each.id))
			.map(
				(each): Candidate => ({
					ref: `#${each.id}`,
					status: "queued",
					title: each.subject,
					...wordsOf(each.text),
					files: [],
				}),
			),
		...live,
		...merged
			.filter((each) => recent(each.at))
			.map(
				(each): Candidate => ({
					ref: each.hash.slice(0, 9),
					status: "merged",
					title: each.subject,
					goal: "",
					details: "",
					files: each.files,
				}),
			),
		...finished
			.filter((each) => each.ended === "removed" && recent(each.endedAt))
			.map(
				(each): Candidate => ({
					ref: each.task,
					status: "removed",
					title: each.subject,
					goal: "",
					details: each.reason === null ? "" : `removed: ${each.reason}`,
					files: [],
				}),
			),
	];
}

/**
 * The tasks of `pool` most related to `query`, at most `opts.shown`, most likely
 * first. Give a judge to rank by meaning; with none, or when it fails, tasks
 * are named by the words they share, and `judged` says why.
 */
export async function findRelated(
	query: Query,
	pool: Candidate[],
	judge: Judge | null,
	opts: FindOptions = {},
): Promise<Found> {
	const shown = opts.shown ?? SHOWN;
	// Words cut the pool to a shortlist; only that goes to the judge.
	const shortlist = rank(query, pool, SHORTLIST);
	if (judge === null) {
		return unjudged(
			query,
			shortlist,
			pool.length,
			opts.unjudged ?? "no TYPESAFE_API_KEY kept",
			shown,
		);
	}
	try {
		const { verdicts } = await judgeShortlist(
			judge,
			query,
			shortlist.map((each) => each.candidate),
			opts,
		);
		const related = shortlist
			.map((each, i) => ({
				candidate: each.candidate,
				verdict: verdicts[i] ?? null,
			}))
			.filter((each) => (each.verdict?.related ?? 0) >= RELATED)
			.sort(
				(one, two) => (two.verdict?.related ?? 0) - (one.verdict?.related ?? 0),
			)
			.slice(0, shown);
		return { related, pool: pool.length, judged: true };
	} catch (error) {
		return unjudged(
			query,
			shortlist,
			pool.length,
			error instanceof Error ? error.message : String(error),
			shown,
		);
	}
}

/** How `findRelated` runs. */
export interface FindOptions {
	/** Gives up on the judge, naming tasks by words instead, when it aborts. */
	signal?: AbortSignal;
	/** The most tasks named, `SHOWN` when not given; never more than `SHORTLIST`. */
	shown?: number;
	/** Why no judge was given, said with what was found; a missing key when not given. */
	unjudged?: string;
}

function unjudged(
	query: Query,
	shortlist: Scored[],
	pool: number,
	reason: string,
	shown: number,
): Found {
	const needed = Math.max(2, Math.ceil(distinctWords(query) * UNJUDGED_SHARE));
	return {
		related: shortlist
			.filter((each) => each.matched >= needed)
			.slice(0, shown)
			.map((each) => ({ candidate: each.candidate, verdict: null })),
		pool,
		judged: { reason },
	};
}

/**
 * `found` as the lines an add prints under its own: each related task with
 * its state and title, what a judge said of it, and how to open it.
 */
export function relatedLines(found: Found): string[] {
	const how =
		found.judged === true
			? "judged by Jev"
			: `by shared words; Jev not asked: ${found.judged.reason}`;
	if (found.related.length === 0) {
		return [color.dim(`  related: none among ${found.pool} tasks (${how})`)];
	}
	return [
		`  related (${found.related.length} of ${found.pool} tasks, ${how}): read each before building`,
		...found.related.map(({ candidate, verdict }) => {
			const flags =
				verdict === null
					? []
					: [
							...(verdict.supersedes >= RELATED
								? ["may supersede this task"]
								: []),
							...(verdict.conflicts >= RELATED ? ["may conflict"] : []),
						];
			const likely =
				verdict === null ? "" : ` ${Math.round(verdict.related * 100)}%`;
			return [
				`    ${candidate.ref} ${candidate.status}${likely}: ${candidate.title}`,
				...(flags.length === 0 ? [] : [color.yellow(` (${flags.join(", ")})`)]),
			].join("");
		}),
		color.dim(
			"  open one with `splates task show <id>` (queued), `splates show <task>` (started, removed) or `git show <commit>` (merged); a task already done is `splates remove --reason superseded`, one to wait on is `splates blocker add`",
		),
	];
}
