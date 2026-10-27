import { describe, expect, test } from "bun:test";
import { beforeCard, replied } from "./thread-reply";

describe("thread-reply", () => {
	test("cuts the text at a report title", () => {
		expect(beforeCard("Landed.\n\n## ✅ Merged x onto main\n\nBody")).toBe(
			"Landed.",
		);
	});

	test("keeps plain headings and fenced titles whole", () => {
		const text = "## Plan\n\n```\n## ✅ Merged x onto main\n```";
		expect(beforeCard(text)).toBe(text);
	});

	test("cuts the text at a list that already asks", () => {
		expect(beforeCard("Hm.\n\n1. Keep it?\n   - (a) yes")).toBe("Hm.");
		expect(beforeCard("1. first\n2. second")).toBe("1. first\n2. second");
	});

	test("holds a card back while the agent writes", () => {
		const turn = { task: null, began: null, until: null };
		expect(replied("## 🔐 Permission: run command: x", false, turn)).toEqual(
			[],
		);
	});
});
