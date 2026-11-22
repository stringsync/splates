import { describe, expect, it } from "bun:test";
import { stretches } from "./asked";

describe("stretches, numbered lists as questions", () => {
	it("puts the approval question last, keeping each number", () => {
		const found = stretches(
			[
				"1. Do you approve a new flag?",
				"   - (a) Yes",
				"   - (b) No",
				"2. Which name should it take?",
				"   - (a) quiet",
				"   - (b) silent",
			].join("\n"),
		);
		const card = found[0];
		expect(
			card?.type === "questions" && card.questions.map((each) => each.number),
		).toEqual(["2", "1"]);
	});

	it("takes an approval question's Plan line out of its body as its plan", () => {
		const [card] = stretches(
			[
				"1. Do you approve the plan-page sheet?",
				"   Built in splates web only.",
				"   Plan: plan.html",
				"   - (a) Yes, approve it (chosen)",
				"   - (b) No",
			].join("\n"),
		);
		const asked = card?.type === "questions" ? card.questions[0] : undefined;
		expect(asked?.plan).toBe("plan.html");
		expect(asked?.body).toBe("Built in splates web only.");
		expect(asked?.choices.map((each) => each.key)).toEqual(["a", "b"]);
	});

	it("offers to request a full plan on an approval question with none", () => {
		const [card] = stretches(
			[
				"1. Do you approve a new flag?",
				"   - (a) Yes, approve it (chosen)",
				"   - (b) No",
			].join("\n"),
		);
		const asked = card?.type === "questions" ? card.questions[0] : undefined;
		expect(asked?.plan).toBeNull();
		expect(asked?.choices.map((each) => [each.key, each.text])).toEqual([
			["a", "Yes, approve it"],
			["b", "No"],
			["c", "Request a full plan"],
		]);
	});

	it("leaves a numbered list that is not all questions, and one in a code block, as text", () => {
		const text = [
			"Steps:",
			"",
			"1. Build it?",
			"2. Ship it",
			"",
			"```",
			"1. Is this code?",
			"```",
		].join("\n");

		expect(stretches(text)).toEqual([{ type: "text", text }]);
	});

	it("reads a question with an aside after its question mark", () => {
		const found = stretches(
			[
				"1. Should the Then choice move?",
				"2. Which actions belong on the Done slide? (all that apply)",
				"   - [a] Resume all",
				"   - [b] Close",
			].join("\n"),
		);

		const questions = found[0]?.type === "questions" ? found[0].questions : [];
		expect(questions.map(({ text, pick }) => ({ text, pick }))).toEqual([
			{ text: "Should the Then choice move?", pick: null },
			{
				text: "Which actions belong on the Done slide? (all that apply)",
				pick: "any",
			},
		]);
	});

	it("reads a question whose line goes on past its question mark, the rest as its body", () => {
		const found = stretches(
			[
				"1. How should I reproduce the jank? You turned down the demo agent.",
				"   - (a) A scripted fake agent",
				"   - (b) You tell me what jumps",
				"2. Should output wrap? (pick one) Terminals scroll sideways.",
				"   Tables line up when it scrolls.",
				"3. Which pages need it? Both have a header?",
			].join("\n"),
		);

		const questions = found[0]?.type === "questions" ? found[0].questions : [];
		expect(
			questions.map(({ text, body, choices }) => ({
				text,
				body,
				choices: choices.length,
			})),
		).toEqual([
			{
				text: "How should I reproduce the jank?",
				body: "You turned down the demo agent.",
				choices: 2,
			},
			{
				text: "Should output wrap? (pick one)",
				body: "Terminals scroll sideways.\nTables line up when it scrolls.",
				choices: 0,
			},
			{
				text: "Which pages need it? Both have a header?",
				body: "",
				choices: 0,
			},
		]);
	});

	it("reads an item that offers choices as a question without a question mark", () => {
		const found = stretches(
			[
				"1. Pick how a stale task shows:",
				"   - (a) A muted card",
				"   - (b) A badge",
				"2. Does it need a tooltip?",
			].join("\n"),
		);

		const questions = found[0]?.type === "questions" ? found[0].questions : [];
		expect(questions.map(({ text, pick }) => ({ text, pick }))).toEqual([
			{ text: "Pick how a stale task shows:", pick: "one" },
			{ text: "Does it need a tooltip?", pick: null },
		]);
	});

	it("leaves a numbered list whose items neither ask nor offer choices as text", () => {
		const text = [
			"1. Built it. Does that matter? Not really.",
			"2. Shipped it",
			"   - a note",
		].join("\n");

		expect(stretches(text)).toEqual([{ type: "text", text }]);
	});

	it("reads choices that pick any, a blank line inside a body, and text after the list", () => {
		const found = stretches(
			[
				"1. Which pages need it?",
				"   Both have a header.",
				"",
				"   Phones matter most.",
				"   - [a] Tasks",
				"   - [b] Tasks",
				"",
				"Thanks.",
			].join("\n"),
		);

		expect(found.map((each) => each.type)).toEqual(["questions", "text"]);
		const [asked] = found[0]?.type === "questions" ? found[0].questions : [];
		expect(asked?.body).toBe("Both have a header.\n\nPhones matter most.");
		expect(asked?.pick).toBe("any");
		expect(asked?.choices.map((choice) => choice.key)).toEqual(["a", "b"]);
		expect(found[1]).toEqual({ type: "text", text: "Thanks." });
	});
});
