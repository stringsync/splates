import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
	type ContractBatch,
	type ContractResult,
	RESULTS_FILE,
} from "./contract";

/** What a run may cost at most, agent and judge together: the plan's ceiling and its guess for an agent with no history. */
export const RUN_USD = 1.05;

/** How many recorded costs per agent the estimate averages. */
const RECENT = 50;

/** Each agent's mean recorded cost per run over its latest runs in the batches under `directory`; an agent with none recorded is absent. */
export async function recentCosts(
	directory: string,
): Promise<Map<string, number>> {
	const names = await readdir(directory).catch(() => [] as string[]);
	const batches: {
		startedAt: string;
		agents: Map<string, string>;
		dir: string;
	}[] = [];
	for (const name of names.filter((each) => each.startsWith("batch-"))) {
		const dir = join(directory, name);
		try {
			const batch = (await Bun.file(
				join(dir, "batch.json"),
			).json()) as ContractBatch;
			batches.push({
				startedAt: batch.startedAt,
				agents: new Map(
					batch.cells.flatMap((cell) =>
						cell.target.agent === undefined
							? []
							: [[cell.id, cell.target.agent] as [string, string]],
					),
				),
				dir,
			});
		} catch {}
	}
	batches.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
	const costs = new Map<string, number[]>();
	for (const batch of batches) {
		let text: string;
		try {
			text = await Bun.file(join(batch.dir, RESULTS_FILE)).text();
		} catch {
			continue;
		}
		for (const line of text.split("\n")) {
			if (line.trim() === "") {
				continue;
			}
			try {
				const result = JSON.parse(line) as ContractResult;
				const agent = batch.agents.get(result.cell);
				if (agent === undefined || typeof result.costUsd !== "number") {
					continue;
				}
				const list = costs.get(agent) ?? [];
				if (list.length < RECENT) {
					list.push(result.costUsd);
					costs.set(agent, list);
				}
			} catch {}
		}
	}
	return new Map(
		[...costs].map(([agent, list]) => [
			agent,
			list.reduce((sum, each) => sum + each, 0) / list.length,
		]),
	);
}

/** What `agents` runs one at a time come to: each agent's recent mean, never above the cap, and the cap for one with no history. */
export function planUsd(
	agents: readonly string[],
	history: ReadonlyMap<string, number>,
): number {
	const total = agents.reduce(
		(sum, agent) => sum + Math.min(RUN_USD, history.get(agent) ?? RUN_USD),
		0,
	);
	return Number(total.toFixed(2));
}
