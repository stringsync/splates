import { describe, expect, test } from "bun:test";
import type { EvalGrid } from "@splates/server/evals/browser";
import { lastResults, sectionsOf } from "./eval-scenarios";

function grid(
	id: string,
	startedAt: string,
	cells: [string, "pass" | "fail" | null][],
): EvalGrid {
	return {
		id,
		startedAt,
		grid: cells.map(([scenario, status]) => ({
			scenario,
			run: status === null ? null : { status },
		})),
	} as unknown as EvalGrid;
}

describe("sectionsOf", () => {
	test("groups by skill, then group, keeping first-seen order", () => {
		const sections = sectionsOf([
			{ id: "a/1", group: "g", about: null, skill: "a" },
			{ id: "b/1", group: "g", about: null, skill: "b" },
			{ id: "a/2", group: "g", about: null, skill: "a" },
			{ id: "c", group: "legacy", about: null },
		]);
		expect(sections.map((each) => each.heading)).toEqual(["a", "b", "legacy"]);
		expect(sections[0]?.scenarios.map((each) => each.id)).toEqual([
			"a/1",
			"a/2",
		]);
	});
});

describe("lastResults", () => {
	test("takes each scenario from the newest batch that ran it", () => {
		const results = lastResults([
			grid("old", "2026-01-01", [
				["x", "pass"],
				["y", "pass"],
			]),
			grid("new", "2026-02-01", [
				["x", "fail"],
				["x", "pass"],
			]),
		]);
		expect(results.get("x")).toMatchObject({
			batch: "new",
			cells: 2,
			passed: 1,
			status: "fail",
		});
		expect(results.get("y")?.batch).toBe("old");
	});

	test("a cell yet to land is pending", () => {
		const results = lastResults([grid("b", "2026-01-01", [["x", null]])]);
		expect(results.get("x")?.status).toBe("pending");
	});
});
