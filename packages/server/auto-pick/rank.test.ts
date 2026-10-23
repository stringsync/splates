import { describe, expect, it } from "bun:test";

import type { RosterAgent } from "../models";
import { higher } from "./rank";

const ROSTERED = {
	id: "fake",
	name: "Fake",
	argv: ["fake-acp"],
	models: [
		{ id: "big", name: "Big", strengths: "hard problems", cost: "high" },
		{ id: "small", name: "Small", strengths: "quick edits", cost: "low" },
	],
};

describe("higher", () => {
	const agents = [RANKED];
	const from = {
		rule: 0,
		kind: null,
		depth: null,
		agent: "fake",
		model: "small",
		effort: "medium",
	};

	it("takes a stronger model on the same agent, whatever its effort", () => {
		expect(higher(agents, from, { agent: "fake", model: "big" })).toBe(true);
		expect(
			higher(agents, from, { agent: "fake", model: "big", effort: "low" }),
		).toBe(true);
	});

	it("takes a higher effort on the same model", () => {
		expect(
			higher(agents, from, { agent: "fake", model: "small", effort: "high" }),
		).toBe(true);
		expect(
			higher(agents, from, { agent: "fake", model: "small", effort: "low" }),
		).toBe(false);
	});

	it("never moves down, to another agent, or to a model it cannot rank", () => {
		const big = { ...from, model: "big" };
		expect(higher(agents, big, { agent: "fake", model: "small" })).toBe(false);
		expect(higher(agents, from, { agent: "other", model: "big" })).toBe(false);
		expect(higher(agents, from, { agent: "fake", model: "huge" })).toBe(false);
	});
});

/** The fake agent, its models ranked: Big above Small. */
const RANKED: RosterAgent = {
	...ROSTERED,
	models: [
		{
			id: "big",
			name: "Big",
			strengths: "",
			cost: "high",
			tier: 4,
			speed: "medium",
			costRank: 2,
		},
		{
			id: "small",
			name: "Small",
			strengths: "",
			cost: "low",
			tier: 1,
			speed: "fast",
			costRank: 1,
		},
	],
};
