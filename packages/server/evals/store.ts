import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { contractCells, contractDetail, isContractBatch } from "./contract";
import type {
	EvalBatch,
	EvalCell,
	EvalDetail,
	EvalGrid,
	EvalRun,
	EvalStatus,
	EvalTarget,
} from "./types";

/**
 * The eval batches under `directory`: each directory's `batch.json`, in the
 * public `splates-evals/1` format any framework writes (`contract.ts`), or as
 * `splates dev eval run` writes it, with the `run-<n>/result.json` of each
 * cell that has landed, cell `n` in plan order.
 */
export class EvalStore {
	constructor(private readonly directory: string) {}

	/** Every batch, newest first. */
	async batches(): Promise<EvalBatch[]> {
		const grids = await Promise.all(
			(await this.ids()).map((id) => this.grid(id)),
		);
		return grids
			.filter((grid) => grid !== null)
			.map(({ grid: _, ...batch }) => batch)
			.sort((first, second) => second.startedAt.localeCompare(first.startedAt));
	}

	/** The batch `id` names with its every cell; null when there is none. */
	async grid(id: string): Promise<EvalGrid | null> {
		const dir = join(this.directory, id);
		const saved = await readJson<unknown>(join(dir, "batch.json")).catch(
			() => null,
		);
		if (isContractBatch(saved)) {
			const { targets, grid } = await contractCells(dir, id, saved);
			return gridOf(id, saved.title ?? null, saved.startedAt, targets, grid);
		}
		const batch = saved as SavedBatch | null;
		if (batch?.schema !== 2) {
			return null;
		}
		const targets: EvalTarget[] = [];
		const grid: EvalCell[] = await Promise.all(
			batch.cells.map(async (cell, index) => {
				const target = targetOf(cell.agent, cell.skill);
				if (!targets.some((each) => each.key === target.key)) {
					targets.push(target);
				}
				const run = `${id}/${runName(index)}/result.json`;
				const result = await readJson<SavedResult>(
					join(this.directory, run),
				).catch((error: unknown) => ({ unreadable: String(error) }));
				return {
					scenario: cell.scenario,
					aspect: cell.aspect,
					requirement: cell.requirement,
					target: target.key,
					repetition: cell.repetition,
					run:
						result === null
							? null
							: "unreadable" in result
								? {
										id: run,
										status: "unreadable",
										tokens: null,
										costUsd: null,
										milliseconds: 0,
										error: result.unreadable,
									}
								: summaryOf(run, result),
				};
			}),
		);
		return gridOf(id, batch.skill ?? null, batch.startedAt, targets, grid);
	}

	/**
	 * The run `id` names, opened whole: `<batch>#<cell>` for a batch in the
	 * public format, or a `result.json`, relative to the directory.
	 */
	async run(id: string): Promise<EvalDetail> {
		const hash = id.lastIndexOf("#");
		if (hash !== -1) {
			const batch = id.slice(0, hash);
			const dir = join(this.directory, batch);
			const saved = await readJson<unknown>(join(dir, "batch.json"));
			const detail = isContractBatch(saved)
				? await contractDetail(dir, batch, saved, id.slice(hash + 1))
				: null;
			if (detail === null) {
				throw new Error(`no eval run ${id}`);
			}
			return detail;
		}
		const result = await readJson<SavedResult>(join(this.directory, id));
		if (result === null) {
			throw new Error(`no eval run ${id}`);
		}
		return {
			...summaryOf(id, result),
			scenario: result.scenario.id,
			aspect: result.scenario.aspect,
			requirement: result.scenario.requirement,
			target: targetOf(result.agent, result.skill),
			repetition: result.repetition,
			input: result.scenario.message,
			rubric: result.scenario.rubric,
			checks: result.checks,
			judge:
				result.judge === null
					? null
					: { pass: result.judge.pass, reason: result.judge.reason },
			reply: result.reply,
			transcript: result.transcript,
		};
	}

	private async ids(): Promise<string[]> {
		const entries = await readdir(this.directory, {
			withFileTypes: true,
		}).catch(() => []);
		return entries
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
	}
}

function gridOf(
	id: string,
	skill: string | null,
	startedAt: string,
	targets: EvalTarget[],
	grid: EvalCell[],
): EvalGrid {
	const tally: Partial<Record<EvalStatus, number>> = {};
	for (const cell of grid) {
		const status = cell.run?.status ?? "pending";
		tally[status] = (tally[status] ?? 0) + 1;
	}
	const runs = grid.flatMap((cell) => (cell.run === null ? [] : [cell.run]));
	return {
		id,
		skill,
		startedAt,
		targets,
		tally,
		cells: grid.length,
		tokens: total(runs.map((each) => each.tokens)),
		costUsd: total(runs.map((each) => each.costUsd)),
		grid,
	};
}

/** The directory cell `index` of a batch lands in. */
export function runName(index: number): string {
	return `run-${String(index).padStart(3, "0")}`;
}

/** An agent as a batch saves it. */
interface SavedAgent {
	agent: string;
	model?: string;
	effort?: string;
}

/** The skill a run used, as a batch saves it. */
interface SavedSkill {
	label: string;
	revision: string | null;
}

/** `batch.json`, as far as the page reads it. */
interface SavedBatch {
	schema: number;
	skill?: string;
	startedAt: string;
	cells: {
		scenario: string;
		aspect: string;
		requirement: string;
		agent: SavedAgent;
		skill: SavedSkill;
		repetition: number;
	}[];
}

/** `result.json`, as far as the page reads it. */
interface SavedResult {
	scenario: {
		id: string;
		aspect: string;
		requirement: string;
		message: string;
		rubric: string | null;
	};
	agent: SavedAgent;
	skill: SavedSkill;
	repetition: number;
	status: "pass" | "fail" | "error";
	error: string | null;
	checks: EvalDetail["checks"];
	judge: { pass: boolean; reason: string } | null;
	reply: string;
	transcript: EvalDetail["transcript"];
	usage: {
		usd: number | null;
		tokens: number | null;
		milliseconds: number;
	};
}

function summaryOf(id: string, result: SavedResult): EvalRun {
	return {
		id,
		status: result.status,
		tokens: result.usage.tokens,
		costUsd: result.usage.usd,
		milliseconds: result.usage.milliseconds,
		...(result.error === null ? {} : { error: result.error }),
	};
}

function targetOf(agent: SavedAgent, skill: SavedSkill): EvalTarget {
	const revision = skill.revision;
	return {
		key: `${agent.agent}/${agent.model ?? ""}${agent.effort === undefined ? "" : `@${agent.effort}`}${revision === null ? "" : ` @${revision}`}`,
		agent: agent.agent,
		model: agent.model ?? null,
		effort: agent.effort ?? null,
		skill: revision,
	};
}

/** `path` as JSON; null when there is no such file. */
async function readJson<T>(path: string): Promise<T | null> {
	const text = await readFile(path, "utf8").catch((error: unknown) => {
		if ((error as { code?: string }).code === "ENOENT") {
			return null;
		}
		throw error;
	});
	return text === null ? null : (JSON.parse(text) as T);
}

function total(values: (number | null)[]): number | null {
	const known = values.filter((each) => each !== null);
	return known.length === 0 ? null : known.reduce((sum, each) => sum + each, 0);
}
