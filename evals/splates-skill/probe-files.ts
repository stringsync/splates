import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { hash, readRun, type StoredRun } from "./probe-record";

export async function treeHash(
	directory: string,
	skip: string[] = [],
): Promise<string> {
	const entries = await readdir(directory, { withFileTypes: true });
	const files: unknown[] = [];
	for (const entry of entries.sort((left, right) =>
		left.name.localeCompare(right.name),
	)) {
		if (["node_modules", ".git", "dist", ...skip].includes(entry.name)) {
			continue;
		}
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push([entry.name, await treeHash(path)]);
		} else if (entry.isFile()) {
			files.push([entry.name, hash(await readFile(path, "utf8"))]);
		}
	}
	return hash(files);
}

export async function storedRuns(directory: string): Promise<StoredRun[]> {
	const entries = await readdir(directory, { withFileTypes: true }).catch(
		(error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") {
				return [];
			}
			throw error;
		},
	);
	const runs: StoredRun[] = [];
	for (const entry of entries.sort((left, right) =>
		left.name.localeCompare(right.name),
	)) {
		if (
			entry.isDirectory() &&
			(entry.name.startsWith("experiment-") || entry.name.startsWith("batch-"))
		) {
			runs.push(...(await storedRuns(join(directory, entry.name))));
		}
		if (entry.isDirectory() && entry.name.startsWith("run-")) {
			runs.push(await readRun(join(directory, entry.name, "result.json")));
		}
	}
	return runs;
}
