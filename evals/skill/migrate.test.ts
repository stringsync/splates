import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvalStore } from "@stringsync/splates-server/evals";
import { migrate } from "./migrate";
import { cellId } from "./run";

describe("migrate", () => {
	let directory: string;
	let store: EvalStore;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "eval-migrate-test-"));
		store = new EvalStore(directory);
		const batch = join(directory, "batch-one");
		await mkdir(join(batch, cellId(0)), { recursive: true });
		const cell = {
			scenario: "resources/install",
			aspect: "resource-control",
			requirement: "Ask before installing.",
			repetition: 0,
		};
		await writeFile(
			join(batch, "batch.json"),
			JSON.stringify({
				schema: 2,
				skill: "splates",
				startedAt: "2026-10-25T00:00:00.000Z",
				cells: [
					{
						...cell,
						agent: { agent: "claude", model: "sonnet" },
						skill: { label: "current", revision: null },
					},
					{
						...cell,
						agent: { agent: "claude", model: "sonnet" },
						skill: { label: "fd9f3785", revision: "fd9f3785" },
					},
				],
			}),
		);
		await writeFile(
			join(batch, cellId(0), "result.json"),
			JSON.stringify({
				schema: 2,
				scenario: {
					id: cell.scenario,
					aspect: cell.aspect,
					requirement: cell.requirement,
					message: "Install it.",
					rubric: null,
				},
				agent: { agent: "claude", model: "sonnet" },
				skill: { label: "current", revision: null },
				repetition: 0,
				startedAt: "2026-10-25T00:00:01.000Z",
				status: "fail",
				error: null,
				checks: [{ id: "asked", about: "asked first", pass: false }],
				judge: null,
				reply: "Installed.",
				transcript: [{ kind: "text", text: "Installed." }],
				usage: { usd: 0.25, tokens: 900, turns: 3, milliseconds: 4000 },
			}),
		);
	});

	afterEach(() => rm(directory, { recursive: true, force: true }));

	it("leaves a schema-2 batch unread until it is migrated", async () => {
		expect(await store.grid("batch-one")).toBeNull();
		expect(await migrate(directory)).toEqual(["batch-one"]);
		expect(await migrate(directory)).toEqual([]);
	});

	it("keeps a batch's planned cells, each landed run's outcome and the totals", async () => {
		await migrate(directory);
		const grid = await store.grid("batch-one");

		expect(grid?.targets.map((target) => target.key)).toEqual([
			"claude/sonnet",
			"claude/sonnet @fd9f3785",
		]);
		expect(grid?.grid.map((cell) => cell.run?.status ?? "pending")).toEqual([
			"fail",
			"pending",
		]);
		expect(grid?.tally).toEqual({ fail: 1, pending: 1 });
		expect(grid).toMatchObject({ cells: 2, tokens: 900, costUsd: 0.25 });
		expect((await store.batches()).map((batch) => batch.id)).toEqual([
			"batch-one",
		]);
	});

	it("opens a migrated run with its message, checks, reply and transcript", async () => {
		await migrate(directory);
		const run = await store.run("batch-one#run-000");

		expect(run).toMatchObject({
			scenario: "resources/install",
			input: "Install it.",
			checks: [{ id: "asked", pass: false }],
			reply: "Installed.",
			target: { agent: "claude", model: "sonnet", skill: null },
		});
	});
});
