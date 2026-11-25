import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTRACT_FORMAT } from "@evals/evals/contract";
import { FakeJudge } from "@splates/server/auto-pick/testing";
import { EvalStore } from "@splates/server/evals";
import { runCell, runClassify } from "./run";
import { expectations, it as spec } from "./spec";
import { CLASSIFY_SPECS } from "./specs";

const CRASH = spec("a crash report reads as a bugfix", {
	subject: "Editor crashes on open",
	detail: "It throws and the page goes blank.",
	judged: { kind: { bugfix: true, design: false } },
});

describe("classification specs", () => {
	test("grade only the classes they name", () => {
		expect(expectations(CRASH.judged).map((each) => each.id)).toEqual([
			"kind:bugfix",
			"kind:design",
		]);
		expect(CRASH.id).toBe("auto-pick/a-crash-report-reads-as-a-bugfix");
	});

	test("refuse a spec that expects nothing", () => {
		expect(() =>
			spec("nothing", { subject: "s", detail: "d", judged: {} }),
		).toThrow("expects nothing");
	});

	test("the seeds cover every kind and have unique ids", () => {
		const kinds = CLASSIFY_SPECS.flatMap((each) =>
			Object.entries(each.judged.kind ?? {})
				.filter(([, holds]) => holds)
				.map(([kind]) => kind),
		);
		expect(new Set(kinds)).toEqual(
			new Set(["bugfix", "design", "open", "devops"]),
		);
		expect(new Set(CLASSIFY_SPECS.map((each) => each.id)).size).toBe(
			CLASSIFY_SPECS.length,
		);
	});
});

describe("runCell", () => {
	test("passes when every named class lands on its side of 50%", async () => {
		const { result, detail } = await runCell(
			CRASH,
			new FakeJudge({ "kind:bugfix": 0.9, "kind:design": 0.1 }, 0.0002),
		);
		expect(result).toMatchObject({ status: "pass", score: 1, costUsd: 0.0002 });
		expect(detail.checks?.map((each) => each.about)).toEqual([
			"Kind reads as Bugfix (over 50%): 90%",
			"Kind does not read as Design (under 50%): 10%",
		]);
		expect(detail.input).toContain("Editor crashes on open");
	});

	test("fails naming each class on the wrong side", async () => {
		const { result } = await runCell(
			CRASH,
			new FakeJudge({ "kind:bugfix": 0.9, "kind:design": 0.7 }),
		);
		expect(result).toMatchObject({
			status: "fail",
			score: 0.5,
			reason: "kind:design 70%",
		});
	});

	test("errors with why when there is no judge", async () => {
		const { result } = await runCell(CRASH, null);
		expect(result.status).toBe("error");
		expect(result.reason).toContain("no judge");
	});
});

test("runClassify writes a batch the Evals page reads", async () => {
	const directory = await mkdtemp(join(tmpdir(), "classify-evals-"));
	try {
		const dir = await runClassify([CRASH], {
			directory,
			judge: new FakeJudge({ "kind:bugfix": 0.9, "kind:design": 0.1 }),
			reps: 2,
		});
		const batch = JSON.parse(await readFile(join(dir, "batch.json"), "utf8"));
		expect(batch.format).toBe(CONTRACT_FORMAT);
		expect(batch.cells).toHaveLength(2);
		const store = new EvalStore(directory);
		const name = dir.slice(directory.length + 1);
		const grid = await store.grid(name);
		expect(grid?.grid.map((cell) => cell.run?.status)).toEqual([
			"pass",
			"pass",
		]);
		const run = await store.run(`${name}#run-000`);
		expect(run.checks).toHaveLength(2);
		expect(run.scenario).toBe(CRASH.id);
	} finally {
		await rm(directory, { recursive: true });
	}
});
