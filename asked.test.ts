import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { answerIn, besides, stretches, withAnswer } from "./asked";

/** The report examples the arbor skill shows agents, as agents copy them. */
async function skillExamples(): Promise<string[]> {
	const skill = await Bun.file(join(import.meta.dir, "arbor.skill.md")).text();
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

		expect(found.map((each) => each.type)).toEqual(["report", "questions"]);
		expect(found[0]).toEqual({
			type: "report",
			report: {
				ending: "escalated",
				task: "<task>",
				base: null,
				reason: "needs two calls on the todo board",
				body: "One sentence on what changed.",
			},
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
					{
						key: "a",
						text: "A muted card",
						body: "![muted card](/abs/path/muted.png)",
						chosen: false,
					},
					{
						key: "b",
						text: 'A "stale" badge',
						body: "![stale badge](/abs/path/badge.png)",
						chosen: false,
					},
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
						"- A todo dropped between two others lands between them, as you picked.",
						"- A drag on a phone starts on press and hold, so the board still scrolls.",
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
			if (example === review) {
				continue;
			}
			expect(
				stretches(example).filter((each) => each.type === "review"),
			).toEqual([]);
		}
	});

	it("reads the skill's merge and remove reports, and the todos they propose", async () => {
		const examples = await skillExamples();
		const merged = examples.find((each) => each.startsWith("## ✅ Merged"));
		const removed = examples.find((each) => each.startsWith("## 🛑 Removed"));
		if (merged === undefined || removed === undefined) {
			throw new Error("the skill has no merge or remove example");
		}

		// `[#<id>]` is a placeholder, not a number: only a real id makes a card.
		expect(stretches(merged).map((each) => each.type)).toEqual([
			"report",
			"text",
		]);
		expect(stretches(merged)[0]).toEqual({
			type: "report",
			report: {
				ending: "merged",
				task: "<task>",
				base: "<base>",
				reason: null,
				body: "One sentence on what changed.\n\nStale: todo <id> (remove?).",
			},
		});
		expect(stretches(removed)[0]).toEqual({
			type: "report",
			report: {
				ending: "removed",
				task: "<task>",
				base: null,
				reason: "superseded by a fix on main",
				body: "One sentence on what the task set out to do.",
			},
		});
	});

	it("reads a proposed todo anywhere in a message, up to the next heading or questions", () => {
		const found = stretches(
			[
				"Next up:",
				"",
				"### 📝 Upload retries forever on a 413 [#12]",
				"",
				"The client retries every 4xx. It touches the retry loop.",
				"",
				"### 📝 Show the file size limit [#14]",
				"",
				"Says how big a file may be.",
				"",
				"1. Which first?",
			].join("\n"),
		);

		expect(found).toEqual([
			{ type: "text", text: "Next up:" },
			{
				type: "todo",
				todo: {
					id: 12,
					subject: "Upload retries forever on a 413",
					body: "The client retries every 4xx. It touches the retry loop.",
				},
			},
			{
				type: "todo",
				todo: {
					id: 14,
					subject: "Show the file size limit",
					body: "Says how big a file may be.",
				},
			},
			expect.objectContaining({ type: "questions" }),
		]);
	});

	it("reads an escalation without a reason, or with its emoji's variation selector left off", () => {
		expect(stretches("## ⚠ Escalated header")).toEqual([
			{
				type: "report",
				report: {
					ending: "escalated",
					task: "header",
					base: null,
					reason: null,
					body: "",
				},
			},
		]);
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
		[...keys].map((key) => ({
			key,
			text: `choice ${key}`,
			body: "",
			chosen: false,
		}));
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

	it("keeps the order a reply puts choices in", () => {
		const order = { number: "4", choices: choices("abc") };
		const reply = withAnswer("", order, { picks: ["c", "a", "b"], words: "" });

		expect(reply).toBe("4. c, a, b");
		expect(answerIn(reply, order)?.picks).toEqual(["c", "a", "b"]);
	});

	it("reads what a reply says besides its answers", () => {
		expect(
			besides("1. a\n2. b: only on phones\n\nAlso the footer.", [one, two]),
		).toBe("Also the footer.");
		expect(besides("Looks good.\n3. after a check", [one, two, three])).toBe(
			"Looks good.",
		);
		expect(besides("1. a\n2. b", [one, two])).toBe("");
	});
});
