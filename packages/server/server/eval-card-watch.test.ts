import { describe, expect, it } from "bun:test";
import { evalCardRefusal } from "./eval-card-watch";

const refs = { scenarios: ["a/one", "a/two"], agents: ["claude:sonnet"] };

describe("evalCardRefusal", () => {
	it("accepts a card naming only listed scenarios and saved agents", () => {
		expect(
			evalCardRefusal(
				{ scenarios: ["a/one"], agents: ["claude:sonnet"] },
				refs,
			),
		).toBeNull();
	});

	it("names a scenario the project does not list", () => {
		const words = evalCardRefusal({ scenarios: ["a/one", "a/gone"] }, refs);
		expect(words).toContain("a/gone");
		expect(words).not.toContain("a/one,");
		expect(words).toContain("corrected card");
	});

	it("names an agent that is not saved", () => {
		expect(
			evalCardRefusal({ scenarios: ["a/one"], agents: ["codex:x"] }, refs),
		).toContain("codex:x");
	});

	it("checks no scenario when the project lists none", () => {
		expect(
			evalCardRefusal(
				{ scenarios: ["anything"] },
				{ scenarios: null, agents: [] },
			),
		).toBeNull();
	});
});
