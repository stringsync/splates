import { expect, test } from "bun:test";
import { FAULT_LAYERS, type Faults, faultsOf } from "./faults";

/** Failed runs per layer, in the order the card shows them. */
function tally(found: Faults | null): number[] {
	return FAULT_LAYERS.map((layer) => found?.counts[layer] ?? -1);
}

test("counts each failed run under the layers it names", () => {
	const found = faultsOf(
		[
			"All code checks passed.",
			"",
			"Faults:",
			"- run-000: judge, skill",
			"- run-001: judge",
			"- `run-002`: **scenario** + judge",
			"",
			"What held up: the Merged rule.",
		].join("\n"),
	);
	expect(tally(found)).toEqual([0, 3, 1, 0]);
	expect(found?.prose).toBe(
		"All code checks passed.\n\nWhat held up: the Merged rule.",
	);
});

test("counts agent noise under the skill and reads a heading", () => {
	expect(
		tally(faultsOf("## Faults\n\n- run-000: agent noise\n- run-001: harness")),
	).toEqual([1, 0, 1, 0]);
});

test("is null without a Faults list", () => {
	expect(faultsOf("Everything passed.")).toBeNull();
});

test("refuses a word that names no layer", () => {
	expect(() => faultsOf("Faults:\n- run-000: weather")).toThrow(
		/"weather" .* names no fault layer/u,
	);
});

test("counts a Diagnosis list's runs under their causes when there is no Faults list", () => {
	const found = faultsOf(
		[
			"Round 2.",
			"",
			"Diagnosis:",
			"- run-001, run-002 asks: skill",
			"  - Why: The skill never says to ask.",
			"- run-002 leaves-env: eval, judge",
			"  - Why: The check reads the wrong file.",
		].join("\n"),
	);
	expect(tally(found)).toEqual([0, 1, 2, 1]);
	expect(found?.prose).toBe("Round 2.");
});
