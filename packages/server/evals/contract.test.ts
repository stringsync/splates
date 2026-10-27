import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTRACT_FORMAT, RESULTS_FILE } from "./contract";
import { EvalStore } from "./store";

describe("a batch in the public format", () => {
	let directory: string;
	let store: EvalStore;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "eval-contract-test-"));
		store = new EvalStore(directory);
		const batch = join(directory, "nightly");
		await mkdir(batch, { recursive: true });
		await writeFile(
			join(batch, "batch.json"),
			JSON.stringify({
				format: CONTRACT_FORMAT,
				startedAt: "2026-10-26T12:00:00.000Z",
				title: "nightly",
				cells: [
					{
						id: "c1",
						case: "refunds/partial",
						group: "refunds",
						about: "Refunds part of an order",
						target: { model: "opus" },
					},
					{
						id: "c2",
						case: "refunds/partial",
						target: { model: "sonnet", agent: "claude", effort: "high" },
					},
					{ id: "c3", case: "refunds/full", target: { model: "opus" } },
				],
			}),
		);
		await writeFile(
			join(batch, RESULTS_FILE),
			[
				JSON.stringify({ cell: "c1", status: "fail" }),
				JSON.stringify({
					cell: "c1",
					status: "pass",
					score: 0.9,
					reason: "close enough",
					tokens: 100,
					costUsd: 0.5,
					url: "https://evals.example/c1",
					detail: "c1.json",
				}),
				JSON.stringify({ cell: "c2", status: "error", reason: "timed out" }),
				'{"cell": "c3", "sta',
			].join("\n"),
		);
		await writeFile(
			join(batch, "c1.json"),
			JSON.stringify({ input: "Refund half.", reply: "Done." }),
		);
	});

	afterEach(() => rm(directory, { recursive: true, force: true }));

	it("reads each cell's last result line, a cell with none pending", async () => {
		const grid = await store.grid("nightly");

		expect(grid?.skill).toBe("nightly");
		expect(grid?.targets.map((target) => target.key)).toEqual([
			"/opus",
			"claude/sonnet@high",
		]);
		expect(grid?.grid.map((cell) => cell.run?.status ?? "pending")).toEqual([
			"pass",
			"error",
			"pending",
		]);
		expect(grid?.grid[0]).toMatchObject({
			scenario: "refunds/partial",
			aspect: "refunds",
			requirement: "Refunds part of an order",
			run: {
				score: 0.9,
				reason: "close enough",
				url: "https://evals.example/c1",
			},
		});
		expect(grid?.grid[1]?.run?.error).toBe("timed out");
		expect(grid).toMatchObject({ tokens: 100, costUsd: 0.5 });
		expect((await store.batches()).map((batch) => batch.id)).toEqual([
			"nightly",
		]);
	});

	it("opens a cell with its detail file", async () => {
		const run = await store.run("nightly#c1");

		expect(run).toMatchObject({
			scenario: "refunds/partial",
			input: "Refund half.",
			reply: "Done.",
			checks: [],
			judge: null,
			target: { model: "opus", agent: "" },
		});
	});

	it("knows no run for a cell yet to finish", async () => {
		await expect(store.run("nightly#c3")).rejects.toThrow("no eval run");
	});
});
