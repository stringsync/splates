import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { answerIn, stretches, withAnswer } from "./asked";

/** The report examples the arbor skill shows agents, as agents copy them. */
async function skillExamples(): Promise<string[]> {
	const skill = await Bun.file(
		join(import.meta.dir, "../cli/templates/arbor.skill.md"),
	).text();
	return [...skill.matchAll(/```markdown\n([\s\S]*?)\n```/g)].map(
		(match) => match[1] as string,
	);
}

describe("stretches", () => {
	it("reads the questions of the skill's own escalation example", async () => {
		const example = (await skillExamples()).find((each) =>
			each.startsWith("## ⚠️ Escalated"),
		);
		if (example === undefined) {
			throw new Error("the skill has no escalation example");
		}

		const found = stretches(example);

		expect(found.map((each) => each.type)).toEqual(["text", "questions"]);
		expect(found[0]).toEqual({
			type: "text",
			text: "## ⚠️ Escalated <task>: needs two calls on the todo board\n\nOne sentence on what changed.",
		});
		const questions = found[1]?.type === "questions" ? found[1].questions : [];
		expect(
			questions.map(({ number, text, body, choices, pick }) => ({
				number,
				text,
				body,
				choices,
				pick,
			})),
		).toEqual([
			{
				number: "1",
				text: "Does dragging a card feel right on a phone?",
				body: "Press and hold a card, then drag it.\n![dragging a card](/abs/path/drag.png)",
				choices: [],
				pick: null,
			},
			{
				number: "2",
				text: "How should a stale todo be shown?",
				body: "",
				choices: [
					{ key: "a", text: "A muted card" },
					{ key: "b", text: 'A "stale" badge' },
				],
				pick: "one",
			},
		]);
	});

	it("reads the skill's own review report as a review, and nothing else as one", async () => {
		const examples = await skillExamples();
		const review = examples.find((each) => each.startsWith("## 🔍"));
		if (review === undefined) {
			throw new Error("the skill has no review example");
		}

		expect(stretches(review)).toEqual([
			{
				type: "review",
				review: {
					task: "<task>",
					base: "<base>",
					body: [
						"One sentence on what changed.",
						"",
						"Open http://localhost:4310 (a demo repo, nothing of yours):",
						"",
						"1. Drag a todo to another lane: it lands where you drop it.",
						"2. Reload: it stays there.",
						"",
						"![the board after a drag](/abs/path/board.png)",
					].join("\n"),
				},
			},
		]);
		for (const example of examples) {
			if (example.startsWith("## ⚠️ Escalated") || example === review) {
				continue;
			}
			expect(stretches(example).filter((each) => each.type !== "text")).toEqual(
				[],
			);
		}
	});

	it("leaves a review title without the line every review ends with as text", () => {
		const text = "## 🔍 Ready to merge header onto main\n\nStill going.";
		expect(stretches(text)).toEqual([{ type: "text", text }]);
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

	it("reads choices that pick any, a blank line inside a body, and text after the list", () => {
		const found = stretches(
			[
				"1. Which pages need it?",
				"   Both have a header.",
				"",
				"   Phones matter most.",
				"   - [a] Todos",
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

describe("withAnswer", () => {
	const choices = (keys: string) =>
		[...keys].map((key) => ({ key, text: `choice ${key}` }));
	const one = { number: "1", choices: choices("ab") };
	const two = { number: "2", choices: choices("abc") };
	const three = { number: "3", choices: [] };

	it("writes a line per question, in number order, picks then words", () => {
		let reply = withAnswer("", two, { picks: ["b"], words: "" });
		expect(reply).toBe("2. b");

		reply = withAnswer(reply, one, { picks: ["a"], words: "" });
		expect(reply).toBe("1. a\n2. b");

		reply = withAnswer(reply, two, {
			picks: ["a", "c"],
			words: "only on phones",
		});
		expect(reply).toBe("1. a\n2. a, c: only on phones");
		expect(answerIn(reply, two)).toEqual({
			picks: ["a", "c"],
			words: "only on phones",
		});

		reply = withAnswer(reply, three, { picks: [], words: "after a check" });
		expect(reply).toBe("1. a\n2. a, c: only on phones\n3. after a check");
		expect(withAnswer("Looks good.", one, { picks: ["b"], words: "" })).toBe(
			"Looks good.\n1. b",
		);
	});

	it("drops a question's line once its answer is empty, leaving the rest", () => {
		expect(
			withAnswer("1. a\n2. b\nThanks", two, { picks: [], words: "" }),
		).toBe("1. a\nThanks");
		expect(withAnswer("Thanks", two, { picks: [], words: "" })).toBe("Thanks");
	});

	it("keeps a trailing space in words, and reads only offered letters as picks", () => {
		expect(answerIn("2. b: because ", two)).toEqual({
			picks: ["b"],
			words: "because ",
		});
		expect(answerIn("2. b because", two)).toEqual({
			picks: ["b"],
			words: "because",
		});
		expect(answerIn("3. a quick fix", three)).toEqual({
			picks: [],
			words: "a quick fix",
		});
		expect(answerIn("1. bonus", one)).toEqual({ picks: [], words: "bonus" });
		expect(answerIn("1. b", three)).toBeNull();
		expect(answerIn("nothing here", one)).toBeNull();
	});

	it("reads back every note as typed, even one that starts like a pick", () => {
		// Each step of typing a note into a box, as the box reads it back.
		for (const words of ["a", "a ", "a lot", "b, a", " a", ":)", "ok"]) {
			const reply = withAnswer("", two, { picks: [], words });
			expect(answerIn(reply, two)).toEqual({ picks: [], words });
		}
		expect(withAnswer("", two, { picks: [], words: "a lot" })).toBe(
			"2. : a lot",
		);
		expect(withAnswer("", two, { picks: [], words: "ok" })).toBe("2. ok");
		expect(withAnswer("", two, { picks: ["a"], words: "a lot" })).toBe(
			"2. a: a lot",
		);
	});
});
