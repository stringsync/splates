import { describe, expect, it } from "bun:test";
import { details } from "./fixtures";
import { mergeChecklist } from "./merge-checklist";

const at = (secs: number) =>
	new Date(Date.UTC(2026, 9, 26, 10, 0, secs)).toISOString();
const NOW = Date.parse(at(100));

describe("mergeChecklist", () => {
	it("is empty with no merge under way", () => {
		expect(mergeChecklist(details(), NOW)).toEqual([]);
	});

	it("times each step taken, counts up the one under way, and lists those to come", () => {
		const rows = mergeChecklist(
			details({
				base: "main",
				gate: "queued",
				mergePlace: 2,
				mergeSince: at(0),
				mergeSteps: {
					steps: [
						{ step: "rebase", at: at(0) },
						{ step: "wait", at: at(4) },
					],
				},
			}),
			NOW,
		);

		expect(
			rows.map(({ label, standing, ms }) => ({ label, standing, ms })),
		).toEqual([
			{ label: "Rebase onto main", standing: "done", ms: 4000 },
			{
				label: "Wait for its turn, 2nd in line",
				standing: "running",
				ms: 96_000,
			},
			{ label: "Premerge", standing: "next", ms: null },
			{ label: "Land on main", standing: "next", ms: null },
			{ label: "Clean up", standing: "next", ms: null },
		]);
	});

	it("nests the premerge's phases, those under way counting up", () => {
		const [, test] = mergeChecklist(
			details({
				gate: "running",
				mergeSince: at(0),
				mergeSteps: {
					steps: [
						{ step: "rebase", at: at(0) },
						{ step: "test", at: at(2) },
					],
					phases: [
						{ phase: "biome", at: at(3), ms: 5000 },
						{ phase: "tests", at: at(10) },
						{ phase: "web tests", at: at(10), within: "tests", ms: 30_000 },
						{ phase: "server tests", at: at(10), within: "tests" },
					],
				},
			}),
			NOW,
		);

		expect(test?.phases).toEqual([
			{ phase: "biome", standing: "done", ms: 5000, inside: [] },
			{
				phase: "tests",
				standing: "running",
				ms: 90_000,
				inside: [
					{ phase: "web tests", standing: "done", ms: 30_000, inside: [] },
					{
						phase: "server tests",
						standing: "running",
						ms: 90_000,
						inside: [],
					},
				],
			},
		]);
	});

	it("leaves out waiting and testing for a merge with no premerge, and waiting once it has tested", () => {
		const ungated = mergeChecklist(
			details({
				gate: null,
				mergeSince: at(0),
				mergeSteps: { steps: [{ step: "rebase", at: at(0) }] },
			}),
			NOW,
		);
		expect(ungated.map((row) => row.step)).toEqual([
			"rebase",
			"land",
			"finish",
		]);

		const retest = mergeChecklist(
			details({
				gate: "running",
				mergeSince: at(0),
				mergeSteps: {
					steps: [
						{ step: "rebase", at: at(0) },
						{ step: "test", at: at(1) },
						{ step: "land", at: at(50) },
						{ step: "rebase", at: at(51) },
					],
				},
			}),
			NOW,
		);
		expect(retest.map((row) => row.step)).toEqual([
			"rebase",
			"test",
			"land",
			"rebase",
			"test",
			"land",
			"finish",
		]);
	});
});
