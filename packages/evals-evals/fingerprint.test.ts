import { describe, expect, it } from "bun:test";
import { fingerprintOf } from "./fingerprint";
import type { Scenario } from "./scenario";

const base = (id: string, judge: string): Scenario => ({
	id,
	aspect: "a",
	requirement: "r",
	message: "m",
	checks: [{ id: "c", about: "c", test: () => true }],
	judge,
});

describe("fingerprintOf", () => {
	it("changes only the edited scenario's fingerprint", () => {
		const scenario = base("a/one", "rubric");
		const other = base("a/two", "rubric");
		const before = [fingerprintOf(scenario, "s"), fingerprintOf(other, "s")];
		const after = [
			fingerprintOf({ ...scenario, judge: "stricter" }, "s"),
			fingerprintOf(other, "s"),
		];
		expect(after[0]).not.toBe(before[0]);
		expect(after[1]).toBe(before[1]);
	});

	it("changes with the judge that grades it, the scenario's own over the run's", () => {
		const scenario = base("a/one", "rubric");
		const plain = fingerprintOf(scenario, "s");
		expect(fingerprintOf(scenario, "s", { model: "sonnet" })).toBe(plain);
		expect(fingerprintOf(scenario, "s", { model: "opus" })).not.toBe(plain);
		const own = { ...scenario, judgeWith: "claude:opus" };
		expect(fingerprintOf(own, "s", { model: "haiku" })).toBe(
			fingerprintOf(scenario, "s", { model: "opus" }),
		);
	});

	it("changes when follow-up turns are turned on", () => {
		const scenario = base("a/one", "rubric");
		expect(
			fingerprintOf({ ...scenario, followUp: { turns: 2 } }, "s"),
		).not.toBe(fingerprintOf(scenario, "s"));
	});

	it("changes when a check's code changes", () => {
		const scenario = base("a/one", "rubric");
		const edited = {
			...scenario,
			checks: [{ id: "c", about: "c", test: () => false }],
		};
		expect(fingerprintOf(edited, "s")).not.toBe(fingerprintOf(scenario, "s"));
	});

	it("changes with the installed skill", () => {
		const scenario = base("a/one", "rubric");
		expect(fingerprintOf(scenario, "s1")).not.toBe(
			fingerprintOf(scenario, "s2"),
		);
	});
});
