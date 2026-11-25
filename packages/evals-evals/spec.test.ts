import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContractBatch, ContractDetail } from "./contract";
import { fingerprintOf } from "./fingerprint";
import { runBatch } from "./run";
import { judgeDetailOf, type Scenario } from "./scenario";
import * as spec from "./spec";

describe("spec helpers", () => {
	it("builds scenarios from nested describe and it calls", () => {
		const scenarios = spec.describe("splates skill", [
			spec.describe("asking", [
				spec.it("asks in one standalone questions card", {
					key: "splates/questions-card",
					message: "Help me pick CSV or JSON",
					expect: [
						spec.check("uses numbered questions", () => true),
						spec.check("marks one choice as chosen", () => true, {
							live: true,
						}),
					],
					detail: "Ask product questions in a single card.",
					judge: "Did the agent ask cleanly?",
					judgeWith: "claude:sonnet",
					limits: { turns: 5 },
				}),
			]),
			spec.it("starts a task before reading code", {
				message: "Fix the bug",
				expect: [spec.check("runs splates add first", () => true)],
			}),
		]);

		expect(scenarios).toHaveLength(2);
		expect(scenarios[0]).toMatchObject({
			id: "splates/questions-card",
			aspect: "splates skill/asking",
			groups: ["splates skill", "asking"],
			sentence: "asks in one standalone questions card",
			detail: "Ask product questions in a single card.",
			requirement: "Ask product questions in a single card.",
			message: "Help me pick CSV or JSON",
			judge: "Did the agent ask cleanly?",
			judgeWith: "claude:sonnet",
			limits: { turns: 5 },
		});
		expect(scenarios[0]?.checks?.map((each) => [each.id, each.live])).toEqual([
			["uses-numbered-questions", undefined],
			["marks-one-choice-as-chosen", true],
		]);
		expect(scenarios[1]).toMatchObject({
			id: "splates-skill/starts-a-task-before-reading-code",
			aspect: "splates skill",
			groups: ["splates skill"],
			sentence: "starts a task before reading code",
			requirement: "starts a task before reading code",
		});
	});

	it("disambiguates checks whose sentences share a slug", () => {
		const [scenario] = spec.describe("suite", [
			spec.it("checks two similar things", {
				message: "do it",
				expect: [
					spec.check("same check", () => true),
					spec.check("same check", () => true),
				],
			}),
		]);
		expect(scenario?.checks?.map((each) => each.id)).toEqual([
			"same-check",
			"same-check-2",
		]);
	});

	it("resolves judge detail from detail, then sentence plus checks, then requirement", () => {
		const withDetail = spec.it("asks cleanly", {
			message: "m",
			detail: "Detailed rubric context.",
			expect: [spec.check("uses a card", () => true)],
		});
		const withoutDetail = spec.it("asks cleanly", {
			message: "m",
			expect: [
				spec.check("uses a card", () => true),
				spec.check("picks a default", () => true),
			],
		});
		const noChecks = spec.it("asks cleanly", { message: "m" });
		const legacy: Scenario = {
			id: "a/b",
			aspect: "a",
			requirement: "Legacy requirement text.",
			message: "m",
		};

		expect(judgeDetailOf(withDetail)).toBe("Detailed rubric context.");
		expect(judgeDetailOf(withoutDetail)).toBe(
			"asks cleanly\nChecks:\n- uses a card\n- picks a default",
		);
		expect(judgeDetailOf(noChecks)).toBe("asks cleanly");
		expect(judgeDetailOf(legacy)).toBe("Legacy requirement text.");
	});

	it("keeps fingerprints stable when a spec sentence or group is reworded", () => {
		const [before] = spec.describe("splates skill", [
			spec.describe("asking", [
				spec.it("asks in one questions card", {
					key: "splates/questions-card",
					message: "Pick CSV or JSON",
					detail: "Ask product questions in one card.",
					expect: [spec.check("uses a questions card", () => true)],
					judge: "Did it ask cleanly?",
					judgeWith: "claude:sonnet",
				}),
			]),
		]);
		const [after] = spec.describe("splates", [
			spec.describe("questions", [
				spec.it("puts product choices in a single questions card", {
					key: "splates/questions-card",
					message: "Pick CSV or JSON",
					detail: "Ask product questions in one card.",
					expect: [spec.check("uses a questions card", () => true)],
					judge: "Did it ask cleanly?",
					judgeWith: "claude:sonnet",
				}),
			]),
		]);

		expect(before).toBeDefined();
		expect(after).toBeDefined();
		expect(fingerprintOf(after as Scenario, "skill-hash")).toBe(
			fingerprintOf(before as Scenario, "skill-hash"),
		);
	});

	it("keeps fingerprints stable for check-only specs when reworded", () => {
		const [before] = spec.describe("suite", [
			spec.it("runs add before reading", {
				key: "splates/add-first",
				message: "Fix bug",
				expect: [spec.check("calls splates add", () => true)],
			}),
		]);
		const [after] = spec.describe("suite", [
			spec.it("starts a task before inspecting files", {
				key: "splates/add-first",
				message: "Fix bug",
				expect: [spec.check("calls splates add", () => true)],
			}),
		]);

		expect(fingerprintOf(after as Scenario, "skill-hash")).toBe(
			fingerprintOf(before as Scenario, "skill-hash"),
		);
	});

	it("changes fingerprint when judge detail changes", () => {
		const [before] = spec.describe("suite", [
			spec.it("asks cleanly", {
				key: "splates/ask",
				message: "m",
				detail: "Old detail",
				judge: "rubric",
				judgeWith: "claude:sonnet",
			}),
		]);
		const [after] = spec.describe("suite", [
			spec.it("asks cleanly", {
				key: "splates/ask",
				message: "m",
				detail: "New detail",
				judge: "rubric",
				judgeWith: "claude:sonnet",
			}),
		]);

		expect(fingerprintOf(after as Scenario, "skill-hash")).not.toBe(
			fingerprintOf(before as Scenario, "skill-hash"),
		);
	});

	it("carries spec sentence, group path, and judge fallback through runBatch", async () => {
		const outDir = await mkdtemp(join(tmpdir(), "evals-spec-batch-"));
		const skillDir = join(import.meta.dir, "fixtures", "demo-skill");
		const prompts: string[] = [];
		const [scenario] = spec.describe("demo skill", [
			spec.describe("asking", [
				spec.it("asks before editing", {
					key: "demo/ask-first",
					message: "Edit foo",
					expect: [spec.check("stays read-only", () => true)],
					judge: "Did it ask first?",
					judgeWith: "claude:sonnet",
				}),
			]),
		]);
		try {
			const batchDir = await runBatch(
				[
					{
						scenario: scenario as Scenario,
						agent: { agent: "claude", model: "sonnet" },
						skill: {
							dir: skillDir,
							used: { label: "current", revision: null },
						},
						repetition: 0,
					},
				],
				{
					directory: outDir,
					skill: "demo",
					runners: {
						command: () => ({
							argv: [
								process.execPath,
								"-e",
								'console.log(JSON.stringify({type:"assistant",message:{content:[{type:"text",text:"Asked first."}]}})); console.log(JSON.stringify({type:"result",subtype:"success",is_error:false,result:"Asked first.",total_cost_usd:0.01,num_turns:1}));',
							],
							format: "claude",
						}),
						judge: async (prompt) => {
							prompts.push(prompt);
							return { pass: true, reason: "Asked cleanly.", usd: 0.005 };
						},
					},
				},
			);
			const manifest = JSON.parse(
				await readFile(join(batchDir, "batch.json"), "utf8"),
			) as ContractBatch;
			const detail = JSON.parse(
				await readFile(join(batchDir, "run-000.json"), "utf8"),
			) as ContractDetail;

			expect(manifest.cells[0]).toMatchObject({
				case: "demo/ask-first",
				group: "demo skill > asking",
				groups: ["demo skill", "asking"],
				sentence: "asks before editing",
				about: "asks before editing",
			});
			expect(prompts[0]).toContain(
				"Requirement of the skill: asks before editing\nChecks:\n- stays read-only",
			);
			expect(detail.detail).toBeUndefined();
		} finally {
			await rm(outDir, { recursive: true, force: true });
		}
	});
});

describe("spec priority", () => {
	it("inherits through describe, with the innermost setting winning", () => {
		const scenarios = spec.describe(
			"suite",
			[
				spec.it("takes the suite's", { message: "a" }),
				spec.it("sets its own", { message: "b", priority: "low" }),
				spec.describe(
					"inner",
					[spec.it("takes the inner group's", { message: "c" })],
					{ priority: "normal" },
				),
			],
			{ priority: "high" },
		);
		expect(scenarios.map((each) => each.priority)).toEqual([
			"high",
			"low",
			"normal",
		]);
	});

	it("leaves priority unset when nothing sets it, and out of the fingerprint", () => {
		const [plain] = spec.describe("suite", [spec.it("runs", { message: "a" })]);
		const [marked] = spec.describe("suite", [
			spec.it("runs", { message: "a", priority: "high" }),
		]);
		expect(plain?.priority).toBeUndefined();
		if (plain === undefined || marked === undefined) {
			throw new Error("missing scenario");
		}
		expect(fingerprintOf(marked, "skill")).toBe(fingerprintOf(plain, "skill"));
	});
});
