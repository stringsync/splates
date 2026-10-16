import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "webappwiz/log";
import type { Ps } from "webappwiz/system";
import type { Duration } from "webappwiz/time";
import { COMMON } from "./checks";
import { Fixture } from "./fixture";
import { type Grade, grade, rubricHash } from "./grader";
import { type History, type Results, type RunKey, total } from "./results";
import { COMMON_RUBRIC, type Scenario } from "./scenario";
import { SCENARIOS } from "./scenarios";
import { changedSections } from "./sections";
import { readRun, type Usage } from "./transcript";
import type { Variant } from "./variants";

/**
 * The runs one command asks for: each variant of the skill on each scenario
 * picked, so many times each. It says what is already kept and what the rest
 * will cost before anything is spent, then runs and grades what is missing.
 */
export class Batch {
	readonly keys: RunKey[];

	constructor(
		readonly variants: Variant[],
		readonly scenarios: Scenario[],
		private readonly results: Results,
		private readonly opts: BatchOptions,
	) {
		this.keys = variants.flatMap((variant) =>
			scenarios.flatMap((scenario) =>
				Array.from({ length: opts.reps }, (_, index) => ({
					skill: variant.hash,
					scenario,
					model: opts.model,
					rep: index + 1,
				})),
			),
		);
	}

	/**
	 * The scenarios a change from the first variant to the others touches:
	 * each whose sections changed. All of them for one variant alone.
	 */
	static pick(variants: Variant[]): {
		scenarios: Scenario[];
		changed: string[];
		uncovered: string[];
	} {
		const [first, ...rest] = variants;
		if (first === undefined || rest.length === 0) {
			return { scenarios: [...SCENARIOS], changed: [], uncovered: [] };
		}
		const changed = [
			...new Set(
				rest.flatMap((each) => changedSections(first.files, each.files)),
			),
		];
		const covered = new Set(SCENARIOS.flatMap((scenario) => scenario.sections));
		return {
			scenarios: SCENARIOS.filter((scenario) =>
				scenario.sections.some((each) => changed.includes(each)),
			),
			changed,
			uncovered: changed.filter((each) => !covered.has(each)),
		};
	}

	/** What is left to pay for, and what it should cost from past runs. */
	async estimate(): Promise<Estimate> {
		const missing: RunKey[] = [];
		let grades = 0;
		for (const key of this.keys) {
			const run = await this.results.run(key);
			if (run === null) {
				missing.push(key);
			}
			if (
				run === null ||
				(run.meta.timedOut !== true &&
					!graded(run.grade, key.scenario, this.opts.grader))
			) {
				grades++;
			}
		}
		const history = await this.results.history();
		const runs = missing.map((key) =>
			perRun(history, key.scenario.id, key.model),
		);
		const pastGrades = history.grades.filter(
			(each) => each.model === this.opts.grader,
		);
		return {
			kept: this.keys.length - missing.length,
			runs: missing.length,
			grades,
			runUsd: runs.reduce((sum, each) => sum + each.costUsd, 0),
			gradeUsd:
				grades * (mean(pastGrades.map((each) => each.costUsd)) ?? GRADE_USD),
			tokens:
				runs.reduce((sum, each) => sum + each.tokens, 0) +
				grades * (mean(pastGrades.map((each) => each.tokens)) ?? 0),
			pastRuns: history.runs.filter((each) => each.model === this.opts.model)
				.length,
		};
	}

	/** Runs what is missing, then grades what is ungraded, some at a time; what that used. */
	async run(log: Logger, ps: Ps): Promise<Usage[]> {
		const used: Usage[] = [];
		await pool(this.keys, this.opts.parallel, async (key) => {
			const name = `${this.labelOf(key.skill)} ${key.scenario.id} #${key.rep}`;
			try {
				used.push(...(await this.runOne(key, name, log, ps)));
			} catch (error) {
				// One broken run leaves the rest of the batch to finish.
				log.info(
					`failed ${name}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		});
		return used;
	}

	/** Runs and grades one, as far as it is missing; what that used. */
	private async runOne(
		key: RunKey,
		name: string,
		log: Logger,
		ps: Ps,
	): Promise<Usage[]> {
		const used: Usage[] = [];
		let stored = await this.results.run(key);
		if (stored === null) {
			const dir = join(
				tmpdir(),
				"arbor-skill-evals",
				`${key.skill}-${key.scenario.id}-${key.rep}`,
			);
			const variant = this.variants.find(
				(each) => each.hash === key.skill,
			) as Variant;
			const fixture = new Fixture(dir, variant.dir, ps);
			await fixture.create(key.scenario);
			const turns: string[][] = [];
			const at = new Date().toISOString();
			let timedOut = false;
			for (const prompt of key.scenario.turns) {
				const resume =
					turns.length === 0 ? undefined : sessionOf(turns[0] ?? []);
				const turn = await fixture.turn(prompt, {
					model: key.model,
					resume,
					limit: this.opts.limit,
				});
				turns.push(turn.lines);
				if (turn.timedOut) {
					timedOut = true;
					break;
				}
			}
			const usage = readRun(turns, key.scenario.turns).usage;
			used.push(...usage);
			await this.results.saveRun(key, {
				meta: {
					scenario: key.scenario.id,
					model: key.model,
					at,
					usage,
					...(timedOut ? { timedOut: true as const } : {}),
				},
				turns,
				end: await fixture.end(),
			});
			await fixture.disposeAsync();
			stored = await this.results.run(key);
			log.info(
				timedOut
					? `timed out ${name} after ${this.opts.limit.human()}, at least $${total(usage).toFixed(2)}; delete ${this.results.dir(key)} to run it again`
					: `ran ${name}: $${total(usage).toFixed(2)}${stored === null ? ", cut off" : ""}`,
			);
		}
		if (
			stored !== null &&
			stored.meta.timedOut !== true &&
			!graded(stored.grade, key.scenario, this.opts.grader)
		) {
			const graded = await grade(
				readRun(stored.turns, key.scenario.turns),
				stored.end,
				rubricOf(key.scenario),
				{
					model: this.opts.grader,
				},
			);
			used.push(graded.usage);
			await this.results.saveGrade(key, graded);
			log.info(`graded ${name}: $${graded.usage.costUsd.toFixed(2)}`);
		}
		return used;
	}

	/** Every kept run's verdicts, code and model, for the report. */
	async verdicts(): Promise<RunVerdicts[]> {
		const found: RunVerdicts[] = [];
		for (const key of this.keys) {
			const stored = await this.results.run(key);
			if (stored === null) {
				continue;
			}
			const log = readRun(stored.turns, key.scenario.turns);
			const run = { log, end: stored.end };
			const timedOut = stored.meta.timedOut === true;
			const checks: Record<string, boolean | null> = {};
			// One the limit stopped never finished, so nothing it did is judged.
			for (const check of timedOut ? [] : [...COMMON, ...key.scenario.checks]) {
				const verdicts = check.judge(run);
				// A run passes a check when every place it applied passed.
				checks[check.id] =
					verdicts.length === 0 ? null : verdicts.every((each) => each.ok);
			}
			const model: Record<string, boolean | null> = {};
			for (const [id, item] of Object.entries(stored.grade?.items ?? {})) {
				model[id] = item.verdict === "n/a" ? null : item.verdict === "pass";
			}
			found.push({
				variant: this.labelOf(key.skill),
				scenario: key.scenario.id,
				timedOut,
				checks,
				model,
				reads: reads(log.tools),
				usage: [
					...stored.meta.usage,
					...(stored.grade === null ? [] : [stored.grade.usage]),
				],
			});
		}
		return found;
	}

	private labelOf(hash: string): string {
		return this.variants.find((each) => each.hash === hash)?.label ?? hash;
	}
}

export interface BatchOptions {
	/** The agent's model, as `claude --model` takes it. */
	model: string;
	grader: string;
	reps: number;
	/** Runs at once. */
	parallel: number;
	/** How long one turn may run before it is stopped. */
	limit: Duration;
}

export interface Estimate {
	/** Runs already kept, which cost nothing. */
	kept: number;
	runs: number;
	grades: number;
	/** At API prices, whoever pays. */
	runUsd: number;
	gradeUsd: number;
	/** What the runs and grades should use, from past ones; 0 with none. */
	tokens: number;
	/** How many past runs the estimate rests on; none means it is a guess. */
	pastRuns: number;
}

/** One run's verdicts: pass, fail, or null where it did not apply. */
export interface RunVerdicts {
	variant: string;
	scenario: string;
	/** Whether the limit stopped it; its checks and model items are then empty. */
	timedOut: boolean;
	checks: Record<string, boolean | null>;
	model: Record<string, boolean | null>;
	/** The skill's files beyond SKILL.md it read, by path within the skill. */
	reads: string[];
	usage: Usage[];
}

/** What a run costs when none of its scenario has run on that model: about the mean of the first batch, on Opus. */
const RUN_USD = 0.35;

/** What a grade costs when none has been kept. */
const GRADE_USD = 0.07;

/** The fixture's source, which names its version in the results. */
export async function fixtureVersion(): Promise<string> {
	return readFile(join(import.meta.dir, "fixture.ts"), "utf8");
}

function rubricOf(scenario: Scenario): string[] {
	return [...COMMON_RUBRIC, ...scenario.rubric];
}

function graded(
	grade: Grade | null,
	scenario: Scenario,
	model: string,
): boolean {
	return (
		grade !== null &&
		grade.model === model &&
		grade.rubric === rubricHash(rubricOf(scenario))
	);
}

/** The mean cost of past runs of `scenario` on `model`, else of any scenario on it, else a guess. */
function perRun(
	history: History,
	scenario: string,
	model: string,
): { costUsd: number; tokens: number } {
	const onModel = history.runs.filter((each) => each.model === model);
	const same = onModel.filter((each) => each.scenario === scenario);
	const past = same.length > 0 ? same : onModel;
	return {
		costUsd: mean(past.map((each) => each.costUsd)) ?? RUN_USD,
		tokens: mean(past.map((each) => each.tokens)) ?? 0,
	};
}

function mean(values: number[]): number | null {
	return values.length === 0
		? null
		: values.reduce((sum, each) => sum + each, 0) / values.length;
}

function sessionOf(lines: string[]): string | undefined {
	for (const line of lines) {
		const id = /"session_id":"([^"]+)"/.exec(line)?.[1];
		if (id !== undefined) {
			return id;
		}
	}
	return undefined;
}

/** The skill files beyond SKILL.md that tool calls read: a Read, or a shell command that prints one, never a listing. */
function reads(
	tools: { name: string; input: Record<string, unknown> }[],
): string[] {
	const found = new Set<string>();
	for (const tool of tools) {
		const said =
			tool.name === "Read"
				? String(tool.input.file_path ?? "")
				: tool.name === "Bash" &&
						/\b(cat|head|tail|sed|less|bat|awk)\b/.test(
							String(tool.input.command ?? ""),
						)
					? String(tool.input.command ?? "")
					: "";
		for (const match of said.matchAll(
			/(?:skills\/arbor|\/skill)\/([\w/-]+\.md)/g,
		)) {
			if (match[1] !== "SKILL.md") {
				found.add(match[1] as string);
			}
		}
	}
	return [...found].sort();
}

async function pool<T>(
	items: T[],
	size: number,
	each: (item: T) => Promise<void>,
): Promise<void> {
	const queue = [...items];
	const worker = async () => {
		for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
			await each(item);
		}
	};
	await Promise.all(Array.from({ length: Math.max(1, size) }, worker));
}
