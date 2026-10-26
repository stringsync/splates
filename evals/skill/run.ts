import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
		schema: 2,
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

/** A run as saved in its `result.json`, all the Evals page reads of it. */
export interface Result {
	schema: 2;
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

/** What a batch planned, saved as `batch.json` before any run starts. */
export interface Batch {
	schema: 2;
	skill: string;
	startedAt: string;
	cells: {
		scenario: string;
		aspect: string;
		requirement: string;
		agent: AgentPick;
		skill: SkillUsed;
		repetition: number;
	}[];
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
 * `directory`: `batch.json` first, then each run's `run-<n>/result.json` as it
 * lands. Returns the batch's directory.
 */
export async function runBatch(
	cells: readonly Cell[],
	opts: BatchOptions,
): Promise<string> {
	await mkdir(opts.directory, { recursive: true });
	const dir = await mkdtemp(join(opts.directory, "batch-"));
	const batch: Batch = {
		schema: 2,
		skill: opts.skill,
		startedAt: new Date().toISOString(),
		cells: cells.map((cell) => ({
			scenario: cell.scenario.id,
			aspect: cell.scenario.aspect,
			requirement: cell.scenario.requirement,
			agent: cell.agent,
			skill: cell.skill.used,
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
			const at = join(dir, `run-${String(index).padStart(3, "0")}`);
			await mkdir(at, { recursive: true });
			await writeFile(
				join(at, "result.json"),
				JSON.stringify(result, null, "\t"),
			);
			opts.landed?.(result);
		}
	};
	await Promise.all(
		Array.from({ length: Math.max(1, opts.parallel ?? 2) }, work),
	);
	return dir;
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
