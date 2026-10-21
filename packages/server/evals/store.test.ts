import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvalStore, type SavedRun } from "./store";

describe("EvalStore", () => {
	let directory: string;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "eval-store-"));
	});

	afterEach(() => rm(directory, { recursive: true, force: true }));

	async function save(path: string, run: SavedRun): Promise<void> {
		await mkdir(join(directory, path), { recursive: true });
		await writeFile(join(directory, path, "result.json"), JSON.stringify(run));
	}

	const store = () =>
		new EvalStore(directory, async (path) => {
			const value = JSON.parse(await readFile(path, "utf8"));
			if (value === "refused") {
				throw new Error("result identity mismatch");
			}
			return value as SavedRun;
		});

	it("draws a batch's planned cells, pending until each lands", async () => {
		await mkdir(join(directory, "batch-a"));
		await writeFile(
			join(directory, "batch-a", "batch.json"),
			JSON.stringify({
				schema: 1,
				skill: "splates",
				startedAt: "2026-10-21T10:00:00.000Z",
				cells: ["sonnet", "opus"].map((model) => ({
					probe: "lifecycle/merge",
					aspect: "lifecycle",
					requirement: "req",
					agent: "claude",
					adapterVersion: "claude@1",
					model,
					repetition: 0,
				})),
			}),
		);
		await save("batch-a/run-1", saved("lifecycle/merge", "sonnet", "fail"));

		const grid = await store().grid("batch-a");

		expect(grid).toMatchObject({
			kind: "batch",
			skill: "splates",
			startedAt: "2026-10-21T10:00:00.000Z",
			targets: [
				{ key: "claude@1/sonnet", agent: "claude", model: "sonnet" },
				{ key: "claude@1/opus", agent: "claude", model: "opus" },
			],
			tally: { fail: 1, pending: 1 },
			cells: 2,
			tokens: 10,
			costUsd: 0.5,
		});
		expect(grid?.grid.map((cell) => cell.run?.status ?? null)).toEqual([
			"fail",
			null,
		]);
	});

	it("lists runs saved loose before batches as one batch a day, newest first", async () => {
		await save("run-old", saved("lifecycle/merge", "sonnet", "pass"));
		await utimes(
			join(directory, "run-old"),
			new Date("2026-10-01"),
			new Date("2026-10-01"),
		);
		await save("run-new", saved("lifecycle/merge", "sonnet", "pass"));
		await utimes(
			join(directory, "run-new"),
			new Date("2026-10-20"),
			new Date("2026-10-20"),
		);

		const batches = await store().batches();

		expect(batches.map((batch) => [batch.id, batch.kind, batch.tally])).toEqual(
			[
				["loose-2026-10-20", "loose", { pass: 1 }],
				["loose-2026-10-01", "loose", { pass: 1 }],
			],
		);
	});

	it("shows a run the harness refuses as unreadable, with why", async () => {
		await mkdir(join(directory, "run-bad"));
		await writeFile(
			join(directory, "run-bad", "result.json"),
			JSON.stringify("refused"),
		);

		const [batch] = await store().batches();
		const grid = await store().grid(batch?.id ?? "");

		expect(grid?.grid[0]?.run).toMatchObject({
			status: "unreadable",
			error: "result identity mismatch",
		});
	});

	it("opens a run with each check beside its assertion, and the evidence they read", async () => {
		await save("run-1", saved("lifecycle/merge", "sonnet", "fail"));

		const run = await store().run("run-1/result.json");

		expect(run.checks.map((check) => [check.id, check.assertion.kind])).toEqual(
			[
				["asked", "reply"],
				["merged", "count"],
				["$runner/complete/state", "runner"],
			],
		);
		expect(run).toMatchObject({
			status: "fail",
			target: { key: "claude@1/sonnet" },
			events: [{ id: "e1", name: "splates" }],
			state: { merged: true },
			reply: "1. Should it?",
			termination: "stop",
			logs: join(directory, "run-1", "logs"),
		});
	});
});

/** A run as `splates dev eval` saves one, as much of it as the store reads. */
function saved(
	probe: string,
	model: string,
	status: SavedRun["result"]["status"],
): SavedRun {
	return {
		probe: {
			id: probe,
			aspect: probe.split("/")[0] ?? "",
			requirement: { id: "req", text: "Does the thing" },
			input: { text: "Do it" },
			assertions: [
				{ id: "asked", kind: "reply" },
				{ id: "merged", kind: "count" },
			],
		},
		run: {
			identity: { adapterVersion: "claude@1", model, repetition: 0 },
			evidence: {
				events: [
					{
						id: "e1",
						actor: "agent",
						kind: "command",
						name: "splates",
						args: ["merge"],
					},
				],
				state: { merged: true },
				reply: "1. Should it?",
				complete: ["events", "reply"],
				termination: "stop",
			},
			usage: { milliseconds: 1000, tokens: 10, costUsd: 0.5 },
			reproduction: ["bin/splates", "dev", "eval", "fast"],
		},
		result: {
			status,
			verdicts: [
				{ id: "asked", status: "pass", expected: 1, actual: 1, evidence: [] },
				{
					id: "merged",
					status: "fail",
					expected: { min: 1 },
					actual: 0,
					evidence: ["e1"],
				},
				{
					id: "$runner/complete/state",
					status: "uncovered",
					expected: "complete state",
					actual: null,
					evidence: [],
				},
			],
		},
	};
}
