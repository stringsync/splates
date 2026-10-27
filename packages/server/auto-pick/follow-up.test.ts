import { describe, expect, it } from "bun:test";
import { type Message, said } from "../conversations";
import { askedBack, wordsToJudge } from "./follow-up";

const WIDENING =
	"Let's take this a different direction: propose a few variants.";

describe("follow-up", () => {
	const person = (text: string): Message => said(text, null);
	const told = (text: string): Message => ({ ...said(text, null), told: "x" });

	it("reads nothing of the first message, which Auto pick judged as it started", () => {
		const first = person(WIDENING);
		expect(wordsToJudge([first])).toBeNull();
	});

	it("reads every later message, however short, with all said before it", () => {
		const messages = ["Rename foo", "go"].map(person);
		expect(wordsToJudge(messages)).toEqual({
			subject: "Rename foo",
			detail: "go",
		});
		const more = [...messages, person("now bar")];
		expect(wordsToJudge(more)).toEqual({
			subject: "Rename foo",
			detail: "go\n\nnow bar",
		});
	});

	it("counts only what the person said, never splates's own words", () => {
		const messages = [
			person("Rename foo"),
			told("[SPLATES TASK foo] started for you"),
			person("[SPLATES MERGE]"),
			told("another"),
		];
		expect(wordsToJudge(messages)).toBeNull();
	});

	const agent = (text: string): Message => ({
		...said(text, null),
		role: "agent",
	});

	it("is true of the person's answer to a first reply ending on a question", () => {
		const answer = person("b");
		const messages = [
			person("Fix it"),
			agent("Two ways. Which one?\n"),
			answer,
		];
		expect(askedBack(messages, [answer])).toBe(true);
	});

	it("counts a first message splates said, as a queued task's", () => {
		const answer = person("b");
		const messages = [told("[SPLATES TASK #1]"), agent("Which one?"), answer];
		expect(askedBack(messages, [answer])).toBe(true);
	});

	it("is false of a first reply ending otherwise, or one with a card's choices last", () => {
		const answer = person("b");
		const after = (reply: string) =>
			askedBack([person("Fix it"), agent(reply), answer], [answer]);
		expect([
			after("Done."),
			after("1. Which one?\n   - (a) This (chosen)"),
		]).toEqual([false, false]);
	});

	it("is false of anything but the person's own second message, said now", () => {
		const first = [person("Fix it"), agent("Which one?")];
		const answer = person("b");
		const later = person("c");
		expect(askedBack([...first, answer, later], [later])).toBe(false);
		const tell = told("[SPLATES MERGE]");
		expect(askedBack([...first, tell], [tell])).toBe(false);
	});
});
