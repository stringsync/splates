import { appendFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	CONTRACT_FORMAT,
	type ContractBatch,
	type ContractDetail,
	type ContractResult,
	type ContractTarget,
	RESULTS_FILE,
} from "@stringsync/splates-server/evals";
import {
	type AgentPick,
	type AgentRun,
	commandFor,
	commandsOf,
	type Format,
	runAgent,
} from "./agents";
import { judge, judgePrompt, type Verdict } from "./judge";
import { sandbox } from "./sandbox";
import type { Limits, Scenario, Step } from "./scenario";

/** How a run ended: every check and the judge held, one did not, or the run broke before it could be graded. */
export type Status = "pass" | "fail" | "error";

/** Runs `scenario` once on `pick` with the skill at `skill`, and grades it. */
export async function runOne(
	scenario: Scenario,
	pick: AgentPick,
	opts: RunOptions,
): Promise<Result> {
	const runners = opts.runners ?? REAL;
	const startedAt = new Date().toISOString();
	const start = performance.now();
	const result: Result = {
		scenario: {
			id: scenario.id,
			aspect: scenario.aspect,
			requirement: scenario.requirement,
			message: scenario.message,
			rubric: scenario.judge ?? null,
		},
		agent: pick,
		skill: opts.used,
		repetition: opts.repetition,
		startedAt,
		status: "error",
		error: null,
		checks: [],
		judge: null,
		reply: "",
		transcript: [],
		usage: { usd: null, tokens: null, turns: null, milliseconds: 0 },
	};
	let box: Awaited<ReturnType<typeof sandbox>> | null = null;
	try {
		box = await sandbox(
			opts.skill,
			scenario.seed,
			scenario.change,
			scenario.initialized,
		);
		const { argv, format } = runners.command(
			pick,
			scenario.message,
			scenario.limits ?? {},
		);
		const run: AgentRun = await runAgent(argv, format, {
			cwd: box.repo.dir,
			env: box.env,
			minutes: scenario.limits?.minutes,
		});
		result.reply = run.reply;
		result.transcript = run.transcript;
		result.usage = {
			usd: run.usd,
			tokens: run.tokens,
			turns: run.turns,
			milliseconds: 0,
		};
		if (run.error !== null) {
			result.error = run.error;
			return result;
		}
		const outcome = {
			reply: run.reply,
			transcript: run.transcript,
			commands: commandsOf(run.transcript),
			repo: box.repo,
		};
		for (const check of scenario.checks ?? []) {
			try {
				result.checks.push({
					id: check.id,
					about: check.about,
					pass: await check.test(outcome),
				});
			} catch (error) {
				result.checks.push({
					id: check.id,
					about: check.about,
					pass: false,
					error: String(error),
				});
			}
		}
		if (scenario.judge !== undefined) {
			result.judge = await runners.judge(
				judgePrompt({
					requirement: scenario.requirement,
					rubric: scenario.judge,
					message: scenario.message,
					transcript: run.transcript,
					reply: run.reply,
				}),
				box.env,
			);
		}
		result.status =
			result.checks.every((check) => check.pass) && (result.judge?.pass ?? true)
				? "pass"
				: "fail";
		return result;
	} catch (error) {
		result.error = String(error);
		return result;
	} finally {
		result.usage = {
			usd: result.usage.usd,
			tokens: result.usage.tokens,
			turns: result.usage.turns,
			milliseconds: Math.round(performance.now() - start),
		};
		await box?.remove();
	}
}

/** How `runOne` runs a scenario. */
export interface RunOptions {
	/** The skill directory the agent is given. */
	skill: string;
	/** What the result says of that skill. */
	used: SkillUsed;
	repetition: number;
	/** What runs the agent and the judge; the real ones by default. */
	runners?: Runners;
}

/** One check of a run, and how it went. */
export interface CheckResult {
	id: string;
	about: string;
	pass: boolean;
	/** Why it could not be told, when the check itself threw. */
	error?: string;
}

/** The skill a run used: the checkout's, or the one at `revision`. */
export interface SkillUsed {
	label: string;
	revision: string | null;
}

/** How a run went, saved as its cell's result line and detail file. */
export interface Result {
	scenario: {
		id: string;
		aspect: string;
		requirement: string;
		message: string;
		rubric: string | null;
	};
	agent: AgentPick;
	skill: SkillUsed;
	repetition: number;
	startedAt: string;
	status: Status;
	/** What broke, for `error`. */
	error: string | null;
	checks: CheckResult[];
	judge: Verdict | null;
	reply: string;
	transcript: Step[];
	usage: {
		usd: number | null;
		tokens: number | null;
		turns: number | null;
		milliseconds: number;
	};
}

/** What runs the agent and the judge; tests stand in for both. */
export interface Runners {
	command(
		pick: AgentPick,
		message: string,
		limits: Limits,
	): { argv: string[]; format: Format };
	judge(prompt: string, env: Record<string, string>): Promise<Verdict>;
}

export const REAL: Runners = { command: commandFor, judge };

/** One cell of a batch: a scenario on an agent with a skill, at a repetition. */
export interface Cell {
	scenario: Scenario;
	agent: AgentPick;
	skill: { dir: string; used: SkillUsed };
	repetition: number;
}

/**
 * Runs `cells`, `parallel` at a time, into a new `batch-*` directory under
 * `directory`, in the `splates-evals/1` format (`designs/evals-contract.md`):
 * `batch.json` first, then as each run lands its `run-<n>.json` detail and a
 * line in `results.jsonl`. Returns the batch's directory.
 */
export async function runBatch(
	cells: readonly Cell[],
	opts: BatchOptions,
): Promise<string> {
	await mkdir(opts.directory, { recursive: true });
	const dir = await mkdtemp(join(opts.directory, "batch-"));
	const batch: ContractBatch = {
		format: CONTRACT_FORMAT,
		startedAt: new Date().toISOString(),
		title: opts.skill,
		cells: cells.map((cell, index) => ({
			id: cellId(index),
			case: cell.scenario.id,
			group: cell.scenario.aspect,
			about: cell.scenario.requirement,
			target: contractTarget(cell.agent, cell.skill.used),
			repetition: cell.repetition,
		})),
	};
	await writeFile(join(dir, "batch.json"), JSON.stringify(batch, null, "\t"));
	const queue = [...cells.entries()];
	const work = async () => {
		for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
			const [index, cell] = next;
			const result = await runOne(cell.scenario, cell.agent, {
				skill: cell.skill.dir,
				used: cell.skill.used,
				repetition: cell.repetition,
				runners: opts.runners,
			});
			await saveResult(dir, cellId(index), result);
			opts.landed?.(result);
		}
	};
	await Promise.all(
		Array.from({ length: Math.max(1, opts.parallel ?? 2) }, work),
	);
	return dir;
}

/** Cell `index` of a batch, in plan order, as its result line names it. */
export function cellId(index: number): string {
	return `run-${String(index).padStart(3, "0")}`;
}

/** What a cell on `pick` with the skill `used` ran on, as `batch.json` names it. */
export function contractTarget(
	pick: AgentPick,
	used: SkillUsed,
): ContractTarget {
	return {
		agent: pick.agent,
		model: pick.model ?? "",
		...(pick.effort === undefined ? {} : { effort: pick.effort }),
		...(used.revision === null ? {} : { variant: used.revision }),
	};
}

/** Saves how cell `cell` of the batch in `dir` went: its detail file, then its result line. */
export async function saveResult(
	dir: string,
	cell: string,
	result: Result,
): Promise<void> {
	const detail: ContractDetail = {
		input: result.scenario.message,
		...(result.scenario.rubric === null
			? {}
			: { rubric: result.scenario.rubric }),
		reply: result.reply,
		checks: result.checks,
		...(result.judge === null
			? {}
			: { judge: { pass: result.judge.pass, reason: result.judge.reason } }),
		transcript: result.transcript,
	};
	await writeFile(
		join(dir, `${cell}.json`),
		JSON.stringify(detail, null, "\t"),
	);
	const reason = result.error ?? result.judge?.reason;
	const line: ContractResult = {
		cell,
		status: result.status,
		...(reason === undefined ? {} : { reason }),
		...(result.usage.tokens === null ? {} : { tokens: result.usage.tokens }),
		...(result.usage.usd === null ? {} : { costUsd: result.usage.usd }),
		milliseconds: result.usage.milliseconds,
		detail: `${cell}.json`,
	};
	await appendFile(join(dir, RESULTS_FILE), `${JSON.stringify(line)}\n`);
}

/** How `runBatch` runs its cells. */
export interface BatchOptions {
	/** Where the new `batch-*` directory goes. */
	directory: string;
	/** The skill the batch is of, as the Evals page names it. */
	skill: string;
	/** Runs at once, 2 by default. */
	parallel?: number;
	runners?: Runners;
	/** Called with each result as it is saved. */
	landed?: (result: Result) => void;
}
