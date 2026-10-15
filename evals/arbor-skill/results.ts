import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EndRepo } from "./fixture";
import type { Grade } from "./grader";
import type { Scenario } from "./scenario";
import type { Usage } from "./transcript";

/**
 * Every eval run kept, by the skill version it ran, outside any worktree so
 * it outlives the task that made it: a version already run is never paid
 * for again, and past runs are what a new batch's cost is estimated from.
 */
export class Results {
	constructor(
		/** `~/.arbor/skill-evals` unless a test says otherwise. */
		readonly root: string,
		/** Names the fixture's version: a run on another fixture is not the same run. */
		private readonly fixture: string,
	) {}

	/** Where one run's files go. */
	dir(key: RunKey): string {
		const scenario = `${key.scenario.id}@${this.scenarioHash(key.scenario)}`;
		return join(
			this.root,
			"runs",
			key.skill,
			scenario,
			key.model,
			String(key.rep),
		);
	}

	/** A finished run, or null when it never ran or was cut off. */
	async run(key: RunKey): Promise<StoredRun | null> {
		const dir = this.dir(key);
		const meta = await json<RunMeta>(join(dir, "run.json"));
		if (
			meta === null ||
			(meta.timedOut !== true &&
				meta.usage.length !== key.scenario.turns.length)
		) {
			return null;
		}
		// One the limit stopped kept only the turns it reached.
		const turns: string[][] = [];
		for (let index = 0; index < key.scenario.turns.length; index++) {
			const text = await readFile(
				join(dir, `turn${index + 1}.jsonl`),
				"utf8",
			).catch(() => null);
			if (text === null) {
				break;
			}
			turns.push(text.split("\n"));
		}
		const end = await json<EndRepo>(join(dir, "end.json"));
		return end === null
			? null
			: { meta, turns, end, grade: await json<Grade>(join(dir, "grade.json")) };
	}

	async saveRun(key: RunKey, run: Omit<StoredRun, "grade">): Promise<void> {
		const dir = this.dir(key);
		await mkdir(dir, { recursive: true });
		await Promise.all(
			run.turns.map((lines, index) =>
				writeFile(join(dir, `turn${index + 1}.jsonl`), lines.join("\n")),
			),
		);
		await writeFile(join(dir, "end.json"), JSON.stringify(run.end, null, 1));
		// Written last: it is what says the run finished.
		await writeFile(join(dir, "run.json"), JSON.stringify(run.meta, null, 1));
	}

	async saveGrade(key: RunKey, grade: Grade): Promise<void> {
		await writeFile(
			join(this.dir(key), "grade.json"),
			JSON.stringify(grade, null, 1),
		);
	}

	/** What runs and grades have cost before, for estimating the next batch. */
	async history(): Promise<History> {
		const history: History = { runs: [], grades: [] };
		for (const path of await files(join(this.root, "runs"))) {
			if (path.endsWith("/run.json")) {
				const meta = await json<RunMeta>(path);
				if (meta !== null) {
					history.runs.push({
						scenario: meta.scenario,
						model: meta.model,
						costUsd: total(meta.usage),
						tokens: tokens(meta.usage),
					});
				}
			} else if (path.endsWith("/grade.json")) {
				const grade = await json<Grade>(path);
				if (grade !== null) {
					history.grades.push({
						model: grade.model,
						costUsd: grade.usage.costUsd,
						tokens: tokens([grade.usage]),
					});
				}
			}
		}
		return history;
	}

	private scenarioHash(scenario: Scenario): string {
		const ran = JSON.stringify({
			turns: scenario.turns,
			setup: scenario.setup,
			fixture: this.fixture,
		});
		return createHash("sha256").update(ran).digest("hex").slice(0, 8);
	}
}

/** Names one run: a skill version, a scenario, the agent's model and which repeat. */
export interface RunKey {
	skill: string;
	scenario: Scenario;
	model: string;
	rep: number;
}

export interface StoredRun {
	meta: RunMeta;
	/** What `claude -p` printed, line by line, per turn. */
	turns: string[][];
	end: EndRepo;
	grade: Grade | null;
}

export interface RunMeta {
	scenario: string;
	model: string;
	/** When it started, as an ISO timestamp. */
	at: string;
	/** What each turn cost, but for one the limit stopped, which printed no cost. */
	usage: Usage[];
	/**
	 * Whether the limit stopped it. It is kept, so it is not paid for again,
	 * but never graded; delete its directory to run it again.
	 */
	timedOut?: true;
}

export interface History {
	runs: { scenario: string; model: string; costUsd: number; tokens: number }[];
	grades: { model: string; costUsd: number; tokens: number }[];
}

/** What `usage` cost at API prices, whoever pays. */
export function total(usage: Usage[]): number {
	return usage.reduce((sum, each) => sum + each.costUsd, 0);
}

/** Every token `usage` counts, cached ones included. */
export function tokens(usage: Usage[]): number {
	return usage.reduce(
		(sum, each) =>
			sum +
			each.inputTokens +
			each.outputTokens +
			each.cacheReadTokens +
			each.cacheWriteTokens,
		0,
	);
}

async function json<T>(path: string): Promise<T | null> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as T;
	} catch {
		return null;
	}
}

async function files(dir: string): Promise<string[]> {
	try {
		const entries = await readdir(dir, { recursive: true });
		return entries.map((entry) => join(dir, entry));
	} catch {
		return [];
	}
}
