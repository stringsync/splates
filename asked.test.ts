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

		expect(found.map((each) => each.type)).toEqual([
			"report",
			"demo",
			"questions",
		]);
		expect(found[0]).toEqual({
			type: "report",
			report: {
				ending: "escalated",
				task: "<task>",
				base: null,
				reason: "needs two calls on the todo board",
				body: "One sentence on what changed.",
				source:
					"## ⚠️ Escalated <task>: needs two calls on the todo board\n\nOne sentence on what changed.",
			},
		});
		expect(found[1]).toEqual({
			type: "demo",
			demo: {
				title: "dragging a card on a phone",
				intro:
					"Open http://localhost:4310 at 390px wide (a demo repo, nothing of yours).",
				steps: [
					{
						number: "1",
						action: "Press and hold a card, then drag it to another lane.",
						expect: "It lands where you drop it.",
					},
				],
			},
		});
		const questions = found[2]?.type === "questions" ? found[2].questions : [];
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
				body: "",
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
					body: "One sentence on what changed.",
					demo: {
						title: "moving todos between lanes",
						intro:
							"Open http://localhost:4310 (a demo repo, nothing of yours).",
						steps: [
							{
								number: "1",
								action: "Drag a todo to another lane.",
								expect: "It lands where you drop it.",
							},
							{
								number: "2",
								action: "Reload.",
								expect:
									"It stays there.\n![the board after a drag](/abs/path/board.png)",
							},
						],
					},
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
				body: "One sentence on what changed.\n\n- Restart `arbor dev` to see it.",
				source:
					"## ✅ Merged <task> onto <base>\n\nOne sentence on what changed.\n\n- Restart `arbor dev` to see it.",
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
				source:
					"## 🛑 Removed <task>: superseded by a fix on main\n\nOne sentence on what the task set out to do.",
			},
		});
	});

	it("reads the skill's own demo, alone in a message, as a demo", async () => {
		const example = (await skillExamples()).find((each) =>
			each.startsWith("### 🎬 Demo"),
		);
		if (example === undefined) {
			throw new Error("the skill has no demo example");
		}

		const found = stretches(example);

		expect(found.map((each) => each.type)).toEqual(["demo"]);
		const steps = found[0]?.type === "demo" ? found[0].demo.steps : [];
		expect(steps.map((step) => [step.action, step.expect])).toEqual([
			["Press and hold a card.", "It lifts after half a second."],
			[
				"Drag it to another lane.",
				"It lands where you drop it.\n![dropped in Doing](/abs/path/drop.png)",
			],
		]);
	});

	it("ends a demo with its steps, leaving what follows as text", () => {
		expect(
			stretches(
				[
					"### 🎬 Demo",
					"",
					"1. Open the board.",
					"",
					"   It loads.",
					"2. Reload.",
					"",
					"That is all.",
				].join("\n"),
			),
		).toEqual([
			{
				type: "demo",
				demo: {
					title: null,
					intro: "",
					steps: [
						{ number: "1", action: "Open the board.", expect: "It loads." },
						{ number: "2", action: "Reload.", expect: "" },
					],
				},
			},
			{ type: "text", text: "That is all." },
		]);
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
					source: "## ⚠ Escalated header",
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
				"1. Pick how a stale todo shows:",
				"   - (a) A muted card",
				"   - (b) A badge",
				"2. Does it need a tooltip?",
			].join("\n"),
		);

		const questions = found[0]?.type === "questions" ? found[0].questions : [];
		expect(questions.map(({ text, pick }) => ({ text, pick }))).toEqual([
			{ text: "Pick how a stale todo shows:", pick: "one" },
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
