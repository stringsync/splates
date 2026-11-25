import { describe, expect, it } from "bun:test";
import type { EvalCell } from "@splates/server/evals/browser";
import { linesOf } from "./eval-squares";

const cell = (extra: Partial<EvalCell>): EvalCell => ({
	scenario: "s/a",
	aspect: "",
	requirement: "starts a task",
	target: "t",
	repetition: 0,
	run: null,
	...extra,
});

describe("a scenario line's test", () => {
	it("reads as its subject then its sentence", () => {
		const [line] = linesOf(
			[cell({ subject: "splates skill", sentence: "starts a task" })],
			["t"],
		);
		expect(line?.test).toBe("splates skill starts a task");
	});

	it("is empty for a scenario that is not a spec", () => {
		const [line] = linesOf([cell({})], ["t"]);
		expect(line?.test).toBe("");
	});
});
