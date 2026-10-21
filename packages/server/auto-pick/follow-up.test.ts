import { describe, expect, it } from "bun:test";
import { type Message, said } from "../conversations";
import { LONG, READ_CHARS, wordsToJudge } from "./follow-up";

describe("wordsToJudge", () => {
	const person = (text: string): Message => said(text, null);
	const told = (text: string): Message => ({ ...said(text, null), told: "x" });

	it("reads nothing of the first message, which Auto pick judged as it started", () => {
		const first = person(WIDENING);
		expect(wordsToJudge([first], [first])).toBeNull();
	});

	it(`reads a later message of ${READ_CHARS} characters or more, alone`, () => {
		const next = person(`Take another direction\n${"x".repeat(READ_CHARS)}`);
		expect(wordsToJudge([person("Rename foo"), next], [next])).toEqual({
			subject: "Take another direction",
			detail: "x".repeat(READ_CHARS),
		});
		const short = person("go");
		expect(wordsToJudge([person("Rename foo"), short], [short])).toBeNull();
	});

	it("counts only what the person said, never splates's own words", () => {
		const next = person("go");
		const messages = [
			person("Rename foo"),
			told("[SPLATES TASK foo] started for you"),
			person("[SPLATES MERGE]"),
			told("another"),
			next,
		];
		expect(wordsToJudge(messages, [next])).toBeNull();
	});

	it(`reads everything said from the person's ${LONG}th message on, however short`, () => {
		const messages = ["Rename foo", "ok", "now bar", "go"].map(person);
		expect(wordsToJudge(messages, messages.slice(-1))).toEqual({
			subject: "Rename foo",
			detail: "ok\n\nnow bar\n\ngo",
		});
	});
});

const WIDENING =
	"Let's take this a different direction: propose a few variants.";
