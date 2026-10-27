import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { contractCells, contractDetail, isContractBatch } from "./contract";
import type {
	EvalBatch,
	EvalCell,
	EvalDetail,
	EvalGrid,
	EvalStatus,
	EvalTarget,
} from "./types";

/**
 * The eval batches under `directory`: each directory's `batch.json`, in the
 * public `splates-evals/1` format any framework writes (`contract.ts`),
 * `splates dev eval run` among them.
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
		if (!isContractBatch(saved)) {
			return null;
		}
		const { targets, grid } = await contractCells(dir, id, saved);
		return gridOf(
			id,
			saved.title ?? null,
			saved.producer ?? null,
			saved.startedAt,
			targets,
			grid,
		);
	}

	/** The run `id` names, `<batch>#<cell>`, opened whole. */
	async run(id: string): Promise<EvalDetail> {
		const hash = id.lastIndexOf("#");
		const batch = id.slice(0, Math.max(0, hash));
		const dir = join(this.directory, batch);
		const saved =
			hash === -1
				? null
				: await readJson<unknown>(join(dir, "batch.json")).catch(() => null);
		const detail = isContractBatch(saved)
			? await contractDetail(dir, batch, saved, id.slice(hash + 1))
			: null;
		if (detail === null) {
			throw new Error(`no eval run ${id}`);
		}
		return detail;
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
	producer: string | null,
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
		producer,
		startedAt,
		targets,
		tally,
		cells: grid.length,
		tokens: total(runs.map((each) => each.tokens)),
		costUsd: total(runs.map((each) => each.costUsd)),
		grid,
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
