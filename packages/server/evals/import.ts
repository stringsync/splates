import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ContractBatch, ContractDetail, ContractResult } from "./contract";
import { RESULTS_FILE } from "./contract";

/** A framework's results turned into a splates-evals/1 batch, before it is written. */
export interface Imported {
	batch: ContractBatch;
	results: ContractResult[];
	/** Each cell's detail file, by cell id, written as `<cell>.json`. */
	details: Map<string, ContractDetail>;
}

/** Writes `imported` into directory `dir`, replacing a batch already there. */
export async function writeImported(
	dir: string,
	imported: Imported,
): Promise<void> {
	await mkdir(dir, { recursive: true });
	for (const [cell, detail] of imported.details) {
		await writeFile(join(dir, `${cell}.json`), JSON.stringify(detail));
	}
	await writeFile(
		join(dir, RESULTS_FILE),
		imported.results.map((result) => `${JSON.stringify(result)}\n`).join(""),
	);
	await writeFile(join(dir, "batch.json"), JSON.stringify(imported.batch));
}
