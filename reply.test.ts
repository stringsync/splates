import { describe, expect, it } from "bun:test";
import { answerIn, besides, replyOf } from "./reply";

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
