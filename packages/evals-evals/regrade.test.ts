import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { formatReport, regradeBatch } from "./regrade";
import type { Runners } from "./run";
import { runBatch } from "./run";
import type { Check, Scenario } from "./scenario";

const SKILL = resolve(import.meta.dir, "fixtures/demo-skill");

describe("regradeBatch", () => {
	let directory: string;
	let batch: string;
	let judged: number;
	let runners: Runners;

	const scenario: Scenario = {
		id: "test/focused",
		aspect: "test",
		requirement: "Edit the file.",
		message: "Edit it.",
		async seed(repo) {
			await repo.write("seeded.txt", "seeded\n");
		},
		checks: [
			{
				id: "edited",
				about: "seeded.txt was edited",
				test: async ({ repo }) =>
					(await repo.run(["cat", "seeded.txt"])) === "edited\n",
			},
			{
				id: "no-rm",
				about: "never ran rm",
				test: ({ commands }) => !commands.some((each) => each.startsWith("rm")),
			},
		],
		judge: "Pass.",
	};

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "eval-regrade-test-"));
		judged = 0;
		const command = "echo edited > seeded.txt";
		await writeFile(
			join(directory, "agent.ts"),
			`Bun.spawnSync(["sh", "-c", ${JSON.stringify(command)}]);
const lines = [
	{ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: ${JSON.stringify(command)} } }] } },
	{ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "" }] } },
	{ type: "result", subtype: "success", is_error: false, result: "Done.", total_cost_usd: 0.02, num_turns: 1, usage: { input_tokens: 1, output_tokens: 1 } },
];
for (const line of lines) console.log(JSON.stringify(line));
`,
		);
		runners = {
			command: () => ({
				argv: [process.execPath, join(directory, "agent.ts")],
				format: "claude",
			}),
			judge: async () => ({ pass: true, reason: "ok", usd: 0 }),
		};
		batch = await runBatch(
			[
				{
					scenario,
					agent: { agent: "claude", model: "sonnet" },
					skill: { dir: SKILL, used: { label: "current", revision: null } },
					repetition: 0,
				},
			],
			{ directory, skill: "demo-skill", runners },
		);
	});

	afterEach(() => rm(directory, { recursive: true, force: true }));

	const [_first, _kept] = scenario.checks as [Check, Check];

	const [first, kept] = scenario.checks as [Check, Check];

	const stricter: Scenario = {
		...scenario,
		checks: [
			{
				id: "edited",
				about: "seeded.txt says something else",
				test: async ({ repo }) =>
					(await repo.run(["cat", "seeded.txt"])) === "other\n",
			},
			kept,
		],
	};

	it("reports no flips when the checks are unchanged", async () => {
		const report = await regradeBatch(batch, [{ scenario, dir: SKILL }]);
		expect(report.regraded).toBe(1);
		expect(report.flips).toEqual([]);
	});

	it("lists a run whose verdict flipped under a changed check, and writes nothing into the batch", async () => {
		const before = await readFile(join(batch, "results.jsonl"), "utf8");
		const report = await regradeBatch(batch, [
			{ scenario: stricter, dir: SKILL },
		]);
		expect(report.flips).toEqual([
			{
				run: "run-000",
				scenario: "test/focused",
				agent: "claude:sonnet",
				was: "pass",
				now: "fail",
				checks: ["edited: pass -> fail"],
			},
		]);
		expect(formatReport(report)).toContain("pass -> fail");
		expect(await readFile(join(batch, "results.jsonl"), "utf8")).toBe(before);
		expect(judged).toBe(0);
	});

	it("keeps the stored result of a live check instead of re-running it", async () => {
		const live: Scenario = {
			...scenario,
			checks: [{ id: "edited", about: "live", live: true, test: () => false }],
		};
		const report = await regradeBatch(batch, [{ scenario: live, dir: SKILL }]);
		expect(report.flips).toEqual([]);
		expect(report.unchecked[0]?.checks).toEqual(["edited"]);
	});
	it("re-runs the judge only with judge", async () => {
		const report = await regradeBatch(batch, [{ scenario, dir: SKILL }], {
			judge: true,
			judgeWith: async () => {
				judged += 1;
				return { pass: false, reason: "no", usd: 0 };
			},
		});
		expect(judged).toBe(1);
		expect(report.flips[0]).toMatchObject({
			was: "pass",
			now: "fail",
			judge: "pass -> fail",
		});
	});

	it("writes a new batch with --out", async () => {
		const out = join(directory, "out");
		await regradeBatch(batch, [{ scenario: stricter, dir: SKILL }], { out });
		const line = JSON.parse(await readFile(join(out, "results.jsonl"), "utf8"));
		expect(line.status).toBe("fail");
		const manifest = JSON.parse(
			await readFile(join(out, "batch.json"), "utf8"),
		);
		expect(manifest.title).toContain("regraded");
		const original = JSON.parse(
			await readFile(join(batch, "results.jsonl"), "utf8"),
		);
		expect(original.status).toBe("pass");
	});

	it("skips the checks that need a repo the run did not keep, and names them", async () => {
		const file = join(batch, "run-000.json");
		const detail = JSON.parse(await readFile(file, "utf8"));
		delete detail.repo;
		await writeFile(file, JSON.stringify(detail));
		const noRm: Scenario = {
			...scenario,
			checks: [
				kept,
				{
					...first,
					test: async ({ repo }) => (await repo.run(["true"])) === "",
				},
			],
		};
		const report = await regradeBatch(batch, [{ scenario: noRm, dir: SKILL }]);
		expect(report.unchecked).toEqual([
			{ run: "run-000", scenario: "test/focused", checks: ["edited"] },
		]);
		expect(report.flips).toEqual([]);
	});
});
