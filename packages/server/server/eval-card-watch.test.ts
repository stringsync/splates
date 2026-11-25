import { describe, expect, it } from "bun:test";
import type { Message } from "../conversations";
import { evalCardRefusal, messageKey } from "./eval-card-watch";

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

describe("messageKey", () => {
	const said = (role: "user" | "agent", queued = false): Message => ({
		role,
		parts: [],
		plan: null,
		at: null,
		until: null,
		...(queued ? { queued: true as const } : {}),
	});

	it("is the message's place among those sent, as the page numbers them", () => {
		const card = said("agent");
		const messages = [said("user"), said("user", true), said("agent"), card];

		expect(messageKey(messages, card, { heldForTask: null })).toBe("2");
	});

	it("counts the held prompt the page shows first", () => {
		const card = said("agent");

		expect(messageKey([said("user"), card], card, { heldForTask: 3 })).toBe(
			"2",
		);
	});
});
