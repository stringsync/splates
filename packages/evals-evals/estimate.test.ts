import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planUsd, recentCosts } from "./estimate";

let directory: string;
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "eval-estimate-"));
});
afterEach(() => rm(directory, { recursive: true, force: true }));

test("averages recorded costs per agent and skips unknown ones", async () => {
	await batch("batch-a", "claude", [0.1, 0.3, null]);
	await batch("batch-b", "codex", [null]);
	const history = await recentCosts(directory);
	expect(history.get("claude")).toBeCloseTo(0.2);
	expect(history.has("codex")).toBe(false);
});

test("plans from history, capping each run and falling back to the cap", () => {
	const history = new Map([
		["claude", 0.08],
		["kimi", 5],
	]);
	expect(planUsd(["claude", "claude", "kimi", "codex"], history)).toBe(
		Number((0.16 + 1.05 + 1.05).toFixed(2)),
	);
});

async function batch(name: string, agent: string, costs: (number | null)[]) {
	const dir = join(directory, name);
	await mkdir(dir);
	await writeFile(
		join(dir, "batch.json"),
		JSON.stringify({
			startedAt: "2026-11-13T18:33:55.113Z",
			cells: costs.map((_, i) => ({ id: `run-${i}`, target: { agent } })),
		}),
	);
	await writeFile(
		join(dir, "results.jsonl"),
		costs
			.map((costUsd, i) =>
				JSON.stringify({
					cell: `run-${i}`,
					status: "pass",
					...(costUsd === null ? {} : { costUsd }),
				}),
			)
			.join("\n"),
	);
}
