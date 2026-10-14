import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { answerIn, besides, replyOf, stretches } from "./asked";

/**
 * The report examples the arbor skill shows agents, as agents copy them,
 * from its SKILL.md and every reference file alike.
 */
async function skillExamples(): Promise<string[]> {
	const dir = join(import.meta.dir, "../../skills/arbor");
	const files = await Array.fromAsync(new Bun.Glob("**/*.md").scan(dir));
	const texts = await Promise.all(
		files.toSorted().map((file) => Bun.file(join(dir, file)).text()),
	);
	return texts.flatMap((skill) =>
		[...skill.matchAll(/```markdown\n([\s\S]*?)\n```/g)].map(
			(match) => match[1] as string,
		),
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

describe("replyOf", () => {
	const choices = (keys: string) =>
		[...keys].map((key) => ({
			key,
			text: `choice ${key}`,
			body: "",
			chosen: false,
		}));
	const one = {
		number: "1",
		text: "Which one?",
		choices: choices("ab"),
		pick: "one" as const,
	};
	const two = {
		number: "2",
		text: "Which apply?",
		choices: choices("abc"),
		pick: "any" as const,
	};
	const three = { number: "3", text: "When?", choices: [], pick: null };
	const order = {
		number: "4",
		text: "In what order?",
		choices: choices("abc"),
		pick: "order" as const,
	};

	it("quotes each answered question, then its picks spelled out, then its words", () => {
		const reply = replyOf(
			[one, two, three],
			[
				{ picks: ["b"], words: "" },
				{ picks: ["a", "c"], words: "only on phones\n\n- footer too" },
				null,
			],
			"Looks good.",
		);

		expect(reply).toBe(
			[
				"Looks good.",
				"",
				"> **Which one?**",
				"",
				"- (b) choice b",
				"",
				"> **Which apply?**",
				"",
				"- (a) choice a",
				"- (c) choice c",
				"",
				"only on phones",
				"",
				"- footer too",
			].join("\n"),
		);
		expect(answerIn(reply, one)).toEqual({ picks: ["b"], words: "" });
		expect(answerIn(reply, two)).toEqual({
			picks: ["a", "c"],
			words: "only on phones\n\n- footer too",
		});
		expect(answerIn(reply, three)).toBeNull();
		expect(besides(reply, [one, two, three])).toBe("Looks good.");
	});

	it("leaves out questions without an answer", () => {
		expect(replyOf([one, three], [{ picks: [], words: " " }, null], "")).toBe(
			"",
		);
		expect(replyOf([three], [{ picks: [], words: "after a check" }], "")).toBe(
			"> **When?**\n\nafter a check",
		);
	});

	it("numbers the picks of an order, and reads them back in it", () => {
		const reply = replyOf([order], [{ picks: ["c", "a", "b"], words: "" }], "");

		expect(reply).toBe(
			"> **In what order?**\n\n1. (c) choice c\n2. (a) choice a\n3. (b) choice b",
		);
		expect(answerIn(reply, order)?.picks).toEqual(["c", "a", "b"]);
	});

	it("reads back words that look like a pick or a quoted question as words", () => {
		const words = "- (a) is what I would pick\n> **Which one?**";
		const reply = replyOf([two, one], [{ picks: [], words }, null], "");

		expect(answerIn(reply, two)).toEqual({ picks: [], words });
		expect(answerIn(reply, one)).toBeNull();
	});

	it("finds a question by its line, whatever its number", () => {
		const reply = replyOf([three], [{ picks: [], words: "soon" }], "");

		expect(answerIn(reply, { ...three, number: "7", text: "when?" })).toEqual({
			picks: [],
			words: "soon",
		});
	});

	it("still reads a reply typed by hand, by number", () => {
		expect(answerIn("2. b: because", two)).toEqual({
			picks: ["b"],
			words: "because",
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
		expect(answerIn("4. c, a, b", order)?.picks).toEqual(["c", "a", "b"]);
		expect(
			besides("1. a\n2. b: only on phones\n\nAlso the footer.", [one, two]),
		).toBe("Also the footer.");
	});
});
