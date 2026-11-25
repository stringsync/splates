import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Scenario } from "../scenario";
import * as spec from "../spec";
import { type Found, problems } from "./discover";
import {
	filterScenarios,
	matchesGroup,
	matchesPattern,
	matchesSpec,
} from "./filter";

describe("spec filters", () => {
	it("filters by single group, nested group path, and legacy aspect", () => {
		const found = sampleFound();
		const [first] = found;

		expect(
			filterScenarios(found, { groups: ["asking"] }).map(
				(each) => each.scenario.id,
			),
		).toEqual(["splates/questions-card", "splates/picks"]);
		expect(
			filterScenarios(found, { groups: ["splates skill > asking"] }).map(
				(each) => each.scenario.id,
			),
		).toEqual(["splates/questions-card", "splates/picks"]);
		expect(
			filterScenarios(found, { groups: ["splates skill/merging"] }).map(
				(each) => each.scenario.id,
			),
		).toEqual(["splates/merge-clean"]);
		expect(
			filterScenarios(found, { groups: ["legacy"] }).map(
				(each) => each.scenario.id,
			),
		).toEqual(["legacy/one"]);
		expect(
			first !== undefined && matchesGroup(first.scenario, "nonexistent"),
		).toBe(false);
	});

	it("filters by -t word and regex patterns against groups and sentences", () => {
		const found = sampleFound();
		const [first] = found;

		expect(
			filterScenarios(found, { patterns: ["questions card"] }).map(
				(each) => each.scenario.id,
			),
		).toEqual(["splates/questions-card"]);
		expect(
			filterScenarios(found, { patterns: ["merge|picks"] }).map(
				(each) => each.scenario.id,
			),
		).toEqual(["splates/picks", "splates/merge-clean"]);
		expect(
			first !== undefined && matchesPattern(first.scenario, "[unclosed"),
		).toBe(false);
	});

	it("filters by exact spec sentence, full title, or hidden key", () => {
		const found = sampleFound();
		const [first] = found;

		expect(
			filterScenarios(found, {
				specs: ["asks in one standalone questions card"],
			}).map((each) => each.scenario.id),
		).toEqual(["splates/questions-card"]);
		expect(
			filterScenarios(found, {
				specs: ["splates skill > asking > records local picks in notes"],
			}).map((each) => each.scenario.id),
		).toEqual(["splates/picks"]);
		expect(
			filterScenarios(found, { specs: ["splates/merge-clean"] }).map(
				(each) => each.scenario.id,
			),
		).toEqual(["splates/merge-clean"]);
		expect(
			first !== undefined && matchesSpec(first.scenario, "asks in one"),
		).toBe(false);
	});

	it("combines multiple filter categories with AND", () => {
		const found = sampleFound();

		expect(
			filterScenarios(found, {
				groups: ["asking"],
				patterns: ["picks"],
			}).map((each) => each.scenario.id),
		).toEqual(["splates/picks"]);
	});

	it("accepts spec scenarios with preserved legacy keys in problems()", () => {
		expect(problems(sampleFound())).toEqual([]);
	});

	it("lists and plans filtered specs as sentences from the CLI", async () => {
		const root = await mkdtemp(join(tmpdir(), "evals-cli-filter-"));
		try {
			const specFile = join(root, "p/skills/demo/evals/suite.ts");
			const specImport = join(import.meta.dir, "..", "spec.ts");
			await mkdir(join(specFile, ".."), { recursive: true });
			await writeFile(join(root, "p/skills/demo/SKILL.md"), "# demo\n");
			await writeFile(
				specFile,
				`import { check, describe, it } from ${JSON.stringify(specImport)};
export const scenarios = describe("demo skill", [
	describe("asking", [
		it("asks in one questions card", {
			key: "demo/ask",
			message: "Pick a format",
			expect: [check("uses a card", () => true)],
		}),
	]),
	describe("merging", [
		it("merges after checks pass", {
			key: "demo/merge",
			message: "Land the change",
			expect: [check("runs merge", () => true)],
		}),
	]),
]);
`,
			);

			const cli = join(import.meta.dir, "index.ts");
			const listOut = runCli(cli, [
				"list",
				"--root",
				root,
				"--group",
				"asking",
			]);
			expect(listOut.code).toBe(0);
			expect(listOut.stdout).toContain("demo skill > asking");
			expect(listOut.stdout).toContain("asks in one questions card");
			expect(listOut.stdout).not.toContain("demo/ask");
			expect(listOut.stdout).not.toContain("merges after checks pass");

			const jsonOut = runCli(cli, [
				"list",
				"--root",
				root,
				"-t",
				"questions card",
				"--json",
			]);
			expect(jsonOut.code).toBe(0);
			const parsed = JSON.parse(jsonOut.stdout.trim()) as Record<
				string,
				unknown
			>;
			expect(parsed).toMatchObject({
				case: "demo/ask",
				group: "demo skill > asking",
				groups: ["demo skill", "asking"],
				sentence: "asks in one questions card",
				about: "asks in one questions card",
			});

			const planOut = runCli(cli, [
				"plan",
				"--root",
				root,
				"--spec",
				"merges after checks pass",
			]);
			expect(planOut.code).toBe(0);
			expect(planOut.stdout).toContain("runs 1");
			expect(planOut.stdout).toContain("- merges after checks pass");
			expect(planOut.stdout).not.toContain("asks in one questions card");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

function sampleFound(): Found[] {
	const specs = spec.describe("splates skill", [
		spec.describe("asking", [
			spec.it("asks in one standalone questions card", {
				key: "splates/questions-card",
				message: "m1",
				expect: [spec.check("uses a card", () => true)],
			}),
			spec.it("records local picks in notes", {
				key: "splates/picks",
				message: "m2",
				expect: [spec.check("writes pick to notes", () => true)],
			}),
		]),
		spec.describe("merging", [
			spec.it("merges when checks pass", {
				key: "splates/merge-clean",
				message: "m3",
				expect: [spec.check("calls merge", () => true)],
			}),
		]),
	]);
	const legacy: Scenario = {
		id: "legacy/one",
		aspect: "legacy",
		requirement: "Legacy requirement",
		message: "m4",
		checks: [{ id: "c", about: "passes", test: () => true }],
	};
	return [...specs, legacy].map((scenario) => ({
		scenario,
		skill: "splates",
		dir: "/tmp/splates",
		file: "splates/skills/splates/evals/suite.ts",
	}));
}

function runCli(cli: string, args: string[]) {
	const proc = Bun.spawnSync(["bun", cli, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		code: proc.exitCode,
		stdout: proc.stdout.toString(),
		stderr: proc.stderr.toString(),
	};
}
