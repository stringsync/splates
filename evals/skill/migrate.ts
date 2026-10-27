import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	CONTRACT_FORMAT,
	type ContractBatch,
	RESULTS_FILE,
} from "@stringsync/splates-server/evals";
import type { AgentPick } from "./agents";
import {
	cellId,
	contractTarget,
	type Result,
	type SkillUsed,
	saveResult,
} from "./run";

/** `batch.json` as the harness wrote it before `splates-evals/1`. */
interface SchemaTwoBatch {
	schema: 2;
	skill?: string;
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

/**
 * Rewrites each batch under `directory` the harness saved before
 * `splates-evals/1` (a schema-2 `batch.json` with a `run-<n>/result.json`
 * per landed cell) in that format, in place. Returns the batches it rewrote.
 */
export async function migrate(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true }).catch(
		() => [],
	);
	const done: string[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}
		const dir = join(directory, entry.name);
		const saved = (await readFile(join(dir, "batch.json"), "utf8").then(
			(text) => JSON.parse(text) as { schema?: unknown },
			() => null,
		)) as SchemaTwoBatch | null;
		if (saved?.schema !== 2) {
			continue;
		}
		// A migration cut short left the old batch.json, so start its lines over.
		await rm(join(dir, RESULTS_FILE), { force: true });
		const batch: ContractBatch = {
			format: CONTRACT_FORMAT,
			startedAt: saved.startedAt,
			...(saved.skill === undefined ? {} : { title: saved.skill }),
			cells: saved.cells.map((cell, index) => ({
				id: cellId(index),
				case: cell.scenario,
				group: cell.aspect,
				about: cell.requirement,
				target: contractTarget(cell.agent, cell.skill),
				repetition: cell.repetition,
			})),
		};
		for (const [index] of saved.cells.entries()) {
			const old = join(dir, cellId(index), "result.json");
			const result = await readFile(old, "utf8").then(
				(text) => JSON.parse(text) as Result,
				() => null,
			);
			if (result !== null) {
				await saveResult(dir, cellId(index), result);
			}
		}
		await writeFile(join(dir, "batch.json"), JSON.stringify(batch, null, "\t"));
		await Promise.all(
			saved.cells.map((_, index) =>
				rm(join(dir, cellId(index)), { recursive: true, force: true }),
			),
		);
		done.push(entry.name);
	}
	return done;
}
