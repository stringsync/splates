import { appendFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	type AgentPick,
	type AgentRun,
	commandFor,
	commandsOf,
	continueCommand,
	type Format,
	runAgent,
} from "./agents";
import {
	CONTRACT_FORMAT,
	type ContractBatch,
	type ContractDetail,
	type ContractResult,
	type ContractTarget,
	type EvalCheck,
	type HarnessStatus,
	type Phases,
	RESULTS_FILE,
} from "./contract";
import { fingerprintOf } from "./fingerprint";
import {
	type JudgePick,
	judge,
	judgeFor,
	judgePrompt,
	type Verdict,
} from "./judge";
import { type RepoSnapshot, saveSnapshot, snapshotRepo } from "./keep";
import { revisionOf } from "./revision";
import { type MakeSandbox, type Sandbox, sandbox } from "./sandbox";
import {
	evaluateCheck,
	judgeDetailOf,
	type Limits,
	type Scenario,
	type Step,
	specTitleOf,
} from "./scenario";

/** How a run ended: every check and the judge held, one did not, the harness broke on it, it was skipped after an earlier harness error on its target, or another error stopped it. */
export type Status = "pass" | "fail" | "error" | "harness" | "skipped";

const HARNESS_ERROR_PATTERN =
	/\b(401|403|unauthorized|unauthenticated|forbidden|authentication|invalid[_ ]api[_ ]key|api[_ ]key|not logged in|login required|credential|oauth|token expired|invalid[_ ]token|permission denied|model[_ ]not[_ ]found|unknown model|invalid model|unsupported model|does not exist|no such model|not_found_error|invalid_model|model is not supported|enoent|eacces|command not found|executable file not found|no eval runner|failed to start|spawn)\b|model .+ not found/i;

/**
 * Returns a one-line harness-error reason when the run broke in the harness or
 * agent setup (failed to start, empty transcript, auth or model error), or
 * `null` when the agent ran normally or hit a non-harness runtime error.
 */
export function harnessErrorOf(run: AgentRun, agent: string): string | null {
	const empty = run.transcript.length === 0 && run.reply.trim() === "";
	if (run.error !== null) {
		if (run.error.startsWith("stopped after ")) {
			return null;
		}
		if (HARNESS_ERROR_PATTERN.test(run.error) || empty) {
			return oneLine(run.error);
		}
		return null;
	}
	if (empty) {
		return `${agent} returned an empty transcript`;
	}
	return null;
}

function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

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
			...(scenario.sentence === undefined
				? {}
				: { sentence: scenario.sentence }),
			...(scenario.groups && scenario.groups.length > 0
				? { groups: [...scenario.groups] }
				: {}),
			...(scenario.detail === undefined ? {} : { detail: scenario.detail }),
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
	let box: Sandbox | null = null;
	try {
		let phaseStart = performance.now();
		const lap = () => {
			const now = performance.now();
			const ms = Math.round(now - phaseStart);
			phaseStart = now;
			return ms;
		};
		box = await (opts.sandbox ?? defaultSandbox)(opts.skill, scenario);
		const phases: Phases = { setupMs: lap() };
		result.phases = phases;
		const { argv, format } = runners.command(
			pick,
			scenario.message,
			scenario.limits ?? {},
		);
		const run: AgentRun = await runAgent(argv, format, {
			cwd: box.repo.dir,
			env: box.env,
			minutes: scenario.limits?.minutes,
			followUp:
				scenario.followUp && pick.agent === "opencode"
					? {
							turns: scenario.followUp.turns,
							argv: (runners.continue ?? defaultContinue)(
								pick,
								scenario.limits ?? {},
							).argv,
							done:
								scenario.followUp.done ?? ((each) => each.reply.trim() !== ""),
						}
					: undefined,
		});
		phases.agentMs = lap();
		result.reply = run.reply;
		result.transcript = run.transcript;
		result.usage = {
			usd: run.usd,
			tokens: run.tokens,
			turns: run.turns,
			milliseconds: 0,
		};
		const harnessReason = harnessErrorOf(run, pick.agent);
		if (harnessReason !== null) {
			result.status = "harness";
			result.error = harnessReason;
			return result;
		}
		if (run.error !== null) {
			result.error = run.error;
			return result;
		}
		result.repo = await snapshotRepo(box.repo);
		const outcome = {
			reply: run.reply,
			transcript: run.transcript,
			commands: commandsOf(run.transcript),
			repo: box.repo,
		};
		for (const check of scenario.checks ?? []) {
			try {
				result.checks.push(await evaluateCheck(check, outcome));
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
					requirement: judgeDetailOf(scenario),
					rubric: scenario.judge,
					message: scenario.message,
					transcript: run.transcript,
					reply: run.reply,
				}),
				box.env,
				judgeFor(scenario),
			);
		}
		phases.judgeMs = lap();
		// A run's cost is the agent's and the judge's; an agent that reports none stays unknown.
		if (result.usage.usd !== null && result.judge?.usd != null) {
			result.usage.usd += result.judge.usd;
		}
		result.status =
			result.checks.every((check) => check.pass) && (result.judge?.pass ?? true)
				? "pass"
				: "fail";
		return result;
	} catch (error) {
		const message = oneLine(
			error instanceof Error ? error.message : String(error),
		);
		result.error = message;
		if (
			result.transcript.length === 0 &&
			result.reply.trim() === "" &&
			HARNESS_ERROR_PATTERN.test(message)
		) {
			result.status = "harness";
		}
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

const defaultSandbox: MakeSandbox = (skill, scenario) =>
	sandbox(skill, scenario.seed, scenario.change);

/** How `runOne` runs a scenario. */
export interface RunOptions {
	/** The skill directory the agent is given. */
	skill: string;
	/** What the result says of that skill. */
	used: SkillUsed;
	repetition: number;
	/** What runs the agent and the judge; the real ones by default. */
	runners?: Runners;
	/** Makes each run's sandbox; a throwaway repo with the skill installed by default. */
	sandbox?: MakeSandbox;
}

/** One check of a run, and how it went. */
export type CheckResult = EvalCheck;

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
		sentence?: string;
		groups?: string[];
		detail?: string;
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
	/** How long each phase took, for the phases the run reached. */
	phases?: Phases;
	/** The repo as the agent left it, before the checks ran; kept beside the run. */
	repo?: RepoSnapshot | null;
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
	/** The command that resumes the session for a follow-up turn; `continueCommand` by default. */
	continue?(
		pick: AgentPick,
		limits: Limits,
	): { argv: string[]; format: Format };
	judge(
		prompt: string,
		env: Record<string, string>,
		pick: JudgePick,
	): Promise<Verdict>;
}

const defaultContinue = (pick: AgentPick, limits: Limits) =>
	continueCommand(pick, undefined, limits);

export const REAL: Runners = { command: commandFor, judge };

/** One cell of a batch: a scenario on an agent with a skill, at a repetition. */
export interface Cell {
	/** File-specific factory; takes precedence over the batch default. */
	sandbox?: MakeSandbox;
	scenario: Scenario;
	agent: AgentPick;
	skill: { dir: string; used: SkillUsed };
	repetition: number;
}

/**
 * Runs `cells`, `parallel` (8 by default) at a time, into a new `batch-*` directory under
 * `directory`, in the `splates-evals/1` format (`CONTRACT.md`):
 * `batch.json` first, then as each run lands its `run-<n>.json` detail and a
 * line in `results.jsonl`. Returns the batch's directory.
 */
export async function runBatch(
	cells: readonly Cell[],
	opts: BatchOptions,
): Promise<string> {
	await mkdir(opts.directory, { recursive: true });
	const dir = await mkdtemp(join(opts.directory, "batch-"));
	const revision =
		cells[0] === undefined ? undefined : await revisionOf(cells[0].skill.dir);
	const batch: ContractBatch = {
		format: CONTRACT_FORMAT,
		startedAt: new Date().toISOString(),
		title: opts.skill,
		...(opts.producer === undefined ? {} : { producer: opts.producer }),
		...(revision === undefined ? {} : { revision }),
		cells: cells.map((cell, index) => ({
			id: cellId(index),
			case: cell.scenario.id,
			group:
				cell.scenario.groups && cell.scenario.groups.length > 0
					? cell.scenario.groups.join(" > ")
					: cell.scenario.aspect,
			...(cell.scenario.groups && cell.scenario.groups.length > 0
				? { groups: [...cell.scenario.groups] }
				: {}),
			...(cell.scenario.sentence === undefined
				? {}
				: { sentence: cell.scenario.sentence }),
			about: specTitleOf(cell.scenario),
			target: contractTarget(cell.agent, cell.skill.used),
			repetition: cell.repetition,
			...(revision === undefined
				? {}
				: {
						fingerprint: fingerprintOf(cell.scenario, revision.skillHash),
					}),
		})),
	};
	await writeFile(join(dir, "batch.json"), JSON.stringify(batch, null, "\t"));
	const concurrency = Math.max(1, opts.parallel ?? 8);
	const seenTargets = new Set<string>();
	const probes: [number, Cell][] = [];
	const rest: [number, Cell][] = [];
	for (const entry of cells.entries()) {
		const key = targetKey(entry[1].agent);
		if (!seenTargets.has(key)) {
			seenTargets.add(key);
			probes.push(entry);
		} else {
			rest.push(entry);
		}
	}
	const dropped = new Map<string, string>();
	const runQueue = async (
		queue: [number, Cell][],
	): Promise<{ cell: Cell; result: Result }[]> => {
		const results: { cell: Cell; result: Result }[] = [];
		const work = async () => {
			for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
				const [index, cell] = next;
				const result = await runOne(cell.scenario, cell.agent, {
					skill: cell.skill.dir,
					used: cell.skill.used,
					repetition: cell.repetition,
					runners: opts.runners,
					sandbox: cell.sandbox ?? opts.sandbox,
				});
				await saveResult(dir, cellId(index), result);
				opts.landed?.(result);
				results.push({ cell, result });
			}
		};
		await Promise.all(
			Array.from({ length: Math.min(concurrency, queue.length) }, work),
		);
		return results;
	};
	for (const { cell, result } of await runQueue([...probes])) {
		if (result.status === "harness") {
			dropped.set(
				targetKey(cell.agent),
				oneLine(result.error ?? "harness error"),
			);
		}
	}
	const healthy: [number, Cell][] = [];
	for (const entry of rest) {
		const [index, cell] = entry;
		const dropReason = dropped.get(targetKey(cell.agent));
		if (dropReason !== undefined) {
			const skipped = skippedResult(cell, dropReason);
			await saveResult(dir, cellId(index), skipped);
			opts.landed?.(skipped);
		} else {
			healthy.push(entry);
		}
	}
	await runQueue(healthy);
	return dir;
}

function targetKey(pick: AgentPick): string {
	return `${pick.agent}\0${pick.model ?? ""}\0${pick.effort ?? ""}`;
}

function skippedResult(cell: Cell, reason: string): Result {
	return {
		scenario: {
			id: cell.scenario.id,
			aspect: cell.scenario.aspect,
			requirement: cell.scenario.requirement,
			...(cell.scenario.sentence === undefined
				? {}
				: { sentence: cell.scenario.sentence }),
			...(cell.scenario.groups && cell.scenario.groups.length > 0
				? { groups: [...cell.scenario.groups] }
				: {}),
			...(cell.scenario.detail === undefined
				? {}
				: { detail: cell.scenario.detail }),
			message: cell.scenario.message,
			rubric: cell.scenario.judge ?? null,
		},
		agent: cell.agent,
		skill: cell.skill.used,
		repetition: cell.repetition,
		startedAt: new Date().toISOString(),
		status: "skipped",
		error: `skipped: ${reason}`,
		checks: [],
		judge: null,
		reply: "",
		transcript: [],
		usage: { usd: null, tokens: null, turns: null, milliseconds: 0 },
	};
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
	const kept =
		result.repo == null ? null : await saveSnapshot(dir, cell, result.repo);
	const detail: ContractDetail = {
		input: result.scenario.message,
		...(result.scenario.detail === undefined
			? {}
			: { detail: result.scenario.detail }),
		...(result.scenario.rubric === null
			? {}
			: { rubric: result.scenario.rubric }),
		reply: result.reply,
		checks: result.checks,
		...(result.judge === null
			? {}
			: {
					judge: {
						pass: result.judge.pass,
						reason: result.judge.reason,
						...(result.judge.judge === undefined
							? {}
							: { judge: result.judge.judge }),
					},
				}),
		transcript: result.transcript,
		...(kept === null ? {} : { repo: kept }),
	};
	await writeFile(
		join(dir, `${cell}.json`),
		JSON.stringify(detail, null, "\t"),
	);
	const contractStatus: ContractResult["status"] =
		result.status === "harness" || result.status === "skipped"
			? "error"
			: result.status;
	const harness: HarnessStatus | undefined =
		result.status === "harness"
			? "error"
			: result.status === "skipped"
				? "skipped"
				: undefined;
	const reason = result.error ?? result.judge?.reason;
	const line: ContractResult = {
		cell,
		status: contractStatus,
		...(harness === undefined ? {} : { harness }),
		...(reason === undefined ? {} : { reason }),
		...(result.usage.tokens === null ? {} : { tokens: result.usage.tokens }),
		...(result.usage.usd === null ? {} : { costUsd: result.usage.usd }),
		milliseconds: result.usage.milliseconds,
		...(result.phases === undefined ? {} : { phases: result.phases }),
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
	/** Who wrote the batch, as `batch.json` names it. */
	producer?: string;
	/** Runs at once, 2 by default. */
	parallel?: number;
	runners?: Runners;
	/** Makes each run's sandbox, as for `runOne`. */
	sandbox?: MakeSandbox;
	/** Called with each result as it is saved. */
	landed?: (result: Result) => void;
}
