import { describe, expect, it } from "bun:test";
import { questions } from "../plan";
import { message } from "./testing";
import { blockedReply, unanswered } from "./unanswered";

const open = questions(`# a task

## Blocked

- [x] 1. Do the live tests pass? → yes
- [ ] 2. How many retries?
- [ ] 3. Should it wrap?
  - (a) Always
  - (b) Only on phones
`).filter((asked) => !asked.done && asked.reply === null);

const numbers = (found: ReturnType<typeof unanswered>) =>
	found.map((asked) => asked.number);

describe("unanswered", () => {
	it("leaves every open question no reply answered", () => {
		expect(
			numbers(
				unanswered(open, [
					message("user", "cap retries"),
					message("agent", "1. Should it  wrap?\n   - (a) Always"),
				]),
			),
		).toEqual(["2", "3"]);
	});

	it("takes a reply to a card for the answer to its questions, by their lines", () => {
		expect(
			numbers(
				unanswered(open, [
					message("agent", "1. How many retries?\n2. Should it wrap?"),
					message("user", "1. three"),
					message("agent", "Capping them."),
				]),
			),
		).toEqual(["3"]);
	});

	it("reads a reply by the numbers in Blocked", () => {
		expect(
			numbers(
				unanswered(open, [
					message("agent", "On it."),
					message("user", blockedReply("3. b")),
					message("agent", "Still on it."),
				]),
			),
		).toEqual(["2"]);
	});

	it("takes numbers outside a reply to a card or to Blocked for no answer", () => {
		expect(
			numbers(
				unanswered(open, [
					message("agent", "On it."),
					message("user", "2. three"),
				]),
			),
		).toEqual(["2", "3"]);
	});
});
