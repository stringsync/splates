import { describe, expect, it } from "bun:test";
import { waves } from "./waves";

describe("waves", () => {
	it("puts each node after its dependencies, ignoring ones outside", () => {
		expect(
			waves(
				[
					{ id: "c", dependencies: ["a", "b"] },
					{ id: "a", dependencies: ["outside"] },
					{ id: "b" },
				],
				"step",
			),
		).toEqual([["a", "b"], ["c"]]);
	});

	it("names a cycle", () => {
		expect(() =>
			waves(
				[
					{ id: "x" },
					{ id: "a", dependencies: ["b"] },
					{ id: "b", dependencies: ["a"] },
				],
				"step",
			),
		).toThrow('The steps depend on each other in a cycle: "a" -> "b" -> "a"');
	});
});
