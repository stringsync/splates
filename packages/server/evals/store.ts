import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
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
 * The eval results under `directory`, as batches: each `splates dev eval`
 * invocation's directory (`batch-*`, or `experiment-*` for a paired one), and
 * the `run-*` saved loose at the top before batches, one batch per day.
 */
export class EvalStore {
	constructor(
		private readonly directory: string,
		private readonly readRun: ReadRun,
	) {}

	/** Every batch, newest first. */
	async batches(): Promise<EvalBatch[]> {
		const read = await this.readAll();
		return read
			.map((each) => {
				const { grid: _, ...batch } = gridOf(each, this.directory);
				return batch;
			})
			.sort((first, second) => second.startedAt.localeCompare(first.startedAt));
	}

	/** The batch `id` names with its every cell; null when there is none. */
	async grid(id: string): Promise<EvalGrid | null> {
		const found = (await this.readAll()).find((each) => each.batch.id === id);
		return found === undefined ? null : gridOf(found, this.directory);
	}

	/** The run whose `result.json` is `id`, relative to the directory, opened whole. */
	async run(id: string): Promise<EvalDetail> {
		const path = join(this.directory, id);
		const saved = await this.readRun(path);
		const { probe, run, result } = saved;
		const { identity, evidence } = run;
		return {
			...summaryOf(id, saved),
			probe: probe.id,
			aspect: probe.aspect,
			requirement: probe.requirement.id,
			requirementText: probe.requirement.text,
			target: targetOf(identity.adapterVersion, identity.model),
			repetition: identity.repetition,
			input: probe.input.text,
			termination: evidence.termination,
			detail: result.detail ?? evidence.detail ?? null,
			checks: result.verdicts.map((verdict) => ({
				...verdict,
				assertion: probe.assertions.find(
					(assertion) => assertion.id === verdict.id,
				) ?? { kind: "runner" },
			})),
			events: evidence.events,
			state: evidence.state,
			reply: evidence.reply ?? null,
			complete: evidence.complete,
			logs: join(dirname(path), "logs"),
			reproduction: run.reproduction,
		};
	}

	private async readAll(): Promise<Read[]> {
		const entries = await readdir(this.directory, {
			withFileTypes: true,
		}).catch(() => []);
		const batches: Read[] = [];
		const loose = new Map<string, Read>();
		for (const entry of entries) {
			if (!entry.isDirectory()) {
				continue;
			}
			const path = join(this.directory, entry.name);
			if (
				entry.name.startsWith("batch-") ||
				entry.name.startsWith("experiment-")
			) {
				batches.push(await this.readBatch(path, entry.name));
			} else if (entry.name.startsWith("run-")) {
				const result = join(path, "result.json");
				const at = (await stat(path)).mtime;
				const day = at.toISOString().slice(0, 10);
				const batch = loose.get(day) ?? {
					batch: {
						id: `loose-${day}`,
						kind: "loose",
						skill: null,
						startedAt: at.toISOString(),
					},
					planned: [],
					runs: [],
				};
				if (at.toISOString() < batch.batch.startedAt) {
					batch.batch.startedAt = at.toISOString();
				}
				batch.runs.push(await this.readOne(result));
				loose.set(day, batch);
			}
		}
		return [...batches, ...loose.values()];
	}

	private async readBatch(path: string, id: string): Promise<Read> {
		const manifest = await manifestOf(path);
		const runs: Read["runs"] = [];
		for (const entry of await readdir(path, { withFileTypes: true })) {
			if (entry.isDirectory() && entry.name.startsWith("run-")) {
				runs.push(await this.readOne(join(path, entry.name, "result.json")));
			}
		}
		return {
			batch: {
				id,
				kind: manifest.kind,
				skill: manifest.skill,
				startedAt: manifest.startedAt ?? (await stat(path)).mtime.toISOString(),
			},
			planned: manifest.planned,
			runs,
		};
	}

	private async readOne(path: string): Promise<Read["runs"][number]> {
		try {
			return { path, saved: await this.readRun(path) };
		} catch (error) {
			return {
				path,
				saved: null,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}
}

/** What of a saved run the page reads; `evals/` is not part of a release, so its types are not either. */
export interface SavedRun {
	probe: {
		id: string;
		aspect: string;
		requirement: { id: string; text: string };
		input: { text: string };
		assertions: { id: string; kind: string }[];
	};
	run: {
		identity: {
			adapterVersion: string;
			model: string | null;
			repetition: number;
		};
		evidence: {
			events: EvalDetail["events"];
			state: Record<string, unknown>;
			reply?: string;
			complete: string[];
			termination: string;
			detail?: string;
		};
		usage: {
			milliseconds: number;
			tokens: number | null;
			costUsd: number | null;
		};
		reproduction: string[];
	};
	result: {
		status: EvalStatus;
		detail?: string;
		verdicts: {
			id: string;
			status: "pass" | "fail" | "uncovered";
			expected: unknown;
			actual: unknown;
			evidence: string[];
		}[];
	};
}

/** The harness's `readRun`: a saved run, graded again; it throws on one it refuses. */
export type ReadRun = (path: string) => Promise<SavedRun>;

/** A cell as a batch's manifest plans it. */
interface Planned {
	probe: string;
	aspect: string;
	requirement: string;
	adapterVersion: string;
	model: string | null;
	repetition: number;
}

/** A batch's directory read: what it planned, and the runs it holds. */
interface Read {
	batch: Omit<EvalBatch, "targets" | "tally" | "cells" | "tokens" | "costUsd">;
	planned: Planned[];
	runs: { path: string; saved: SavedRun | null; error?: string }[];
}

/** What a batch's directory says it planned: `batch.json`, or a paired run's `experiment.json`. */
async function manifestOf(path: string): Promise<{
	kind: EvalBatch["kind"];
	skill: string | null;
	startedAt: string | null;
	planned: Planned[];
}> {
	const batch = await json(join(path, "batch.json"));
	if (batch !== null) {
		const { skill, startedAt, cells } = batch as {
			skill: string;
			startedAt: string;
			cells: Planned[];
		};
		return { kind: "batch", skill, startedAt, planned: cells };
	}
	const experiment = (await json(join(path, "experiment.json"))) as {
		experiment?: { kind?: string };
		jobs?: {
			probe: { id: string; aspect: string; requirement: { id: string } };
			adapterVersion: string;
			agent: string;
			requestedModel: string | null;
			repetition: number;
		}[];
	} | null;
	return {
		kind:
			experiment?.experiment?.kind === "unchanged-baseline"
				? "unchanged-baseline"
				: "paired",
		skill: null,
		startedAt: null,
		planned: (experiment?.jobs ?? []).map((job) => ({
			probe: job.probe.id,
			aspect: job.probe.aspect,
			requirement: job.probe.requirement.id,
			adapterVersion: `${job.agent}@${job.adapterVersion}`,
			model: job.requestedModel,
			repetition: job.repetition,
		})),
	};
}

async function json(path: string): Promise<unknown> {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch {
		return null;
	}
}

/** A batch's grid: each planned cell with the run that landed for it, then any run it did not plan. */
function gridOf({ batch, planned, runs }: Read, directory: string): EvalGrid {
	const landed = new Map<string, EvalRun>();
	const unplanned: EvalCell[] = [];
	const plannedKeys = new Set(
		planned.map((cell) =>
			cellKey(
				cell.probe,
				targetKey(cell.adapterVersion, cell.model),
				cell.repetition,
			),
		),
	);
	for (const { path, saved, error } of runs) {
		const id = relative(directory, path);
		if (saved === null) {
			unplanned.push({
				probe: id,
				aspect: "unreadable",
				requirement: "",
				target: "unknown",
				repetition: 0,
				run: {
					id,
					status: "unreadable",
					tokens: null,
					costUsd: null,
					milliseconds: 0,
					error,
				},
			});
			continue;
		}
		const { identity } = saved.run;
		const target = targetKey(identity.adapterVersion, identity.model);
		const key = cellKey(saved.probe.id, target, identity.repetition);
		const run = summaryOf(id, saved);
		if (plannedKeys.has(key)) {
			landed.set(key, run);
		} else {
			unplanned.push({
				probe: saved.probe.id,
				aspect: saved.probe.aspect,
				requirement: saved.probe.requirement.id,
				target,
				repetition: identity.repetition,
				run,
			});
		}
	}
	const grid: EvalCell[] = [
		...planned.map((cell) => {
			const target = targetKey(cell.adapterVersion, cell.model);
			return {
				probe: cell.probe,
				aspect: cell.aspect,
				requirement: cell.requirement,
				target,
				repetition: cell.repetition,
				run: landed.get(cellKey(cell.probe, target, cell.repetition)) ?? null,
			};
		}),
		...unplanned,
	];
	const targets = new Map<string, EvalTarget>();
	for (const cell of grid) {
		if (cell.target !== "unknown" && !targets.has(cell.target)) {
			const [adapterVersion = "", model = null] = splitKey(cell.target);
			targets.set(cell.target, targetOf(adapterVersion, model));
		}
	}
	const tally: EvalBatch["tally"] = {};
	for (const cell of grid) {
		const status = cell.run?.status ?? "pending";
		tally[status] = (tally[status] ?? 0) + 1;
	}
	const ran = grid.flatMap((cell) => (cell.run === null ? [] : [cell.run]));
	const sum = (read: (run: EvalRun) => number | null): number | null =>
		ran.some((run) => read(run) === null)
			? null
			: ran.reduce((total, run) => total + (read(run) ?? 0), 0);
	return {
		...batch,
		targets: [...targets.values()],
		tally,
		cells: grid.length,
		tokens: sum((run) => run.tokens),
		costUsd: sum((run) => run.costUsd),
		grid,
	};
}

function summaryOf(id: string, saved: SavedRun): EvalRun {
	const { usage } = saved.run;
	return {
		id,
		status: saved.result.status,
		tokens: usage.tokens,
		costUsd: usage.costUsd,
		milliseconds: usage.milliseconds,
	};
}

function targetKey(adapterVersion: string, model: string | null): string {
	return model === null ? adapterVersion : `${adapterVersion}/${model}`;
}

function splitKey(key: string): [string, string | null] {
	const at = key.indexOf("/");
	return at === -1 ? [key, null] : [key.slice(0, at), key.slice(at + 1)];
}

function targetOf(adapterVersion: string, model: string | null): EvalTarget {
	return {
		key: targetKey(adapterVersion, model),
		agent: adapterVersion.split("@")[0] ?? adapterVersion,
		model,
	};
}

function cellKey(probe: string, target: string, repetition: number): string {
	return `${probe}\n${target}\n${repetition}`;
}
