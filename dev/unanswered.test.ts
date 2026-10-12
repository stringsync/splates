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

const numbers = (found: ReturnType<typeof unanswered>) => ({
	unanswered: found.unanswered.map((asked) => asked.number),
	uncarded: found.uncarded.map((asked) => asked.number),
});

describe("unanswered", () => {
	it("leaves every open question uncarded while the agent works, as none is on a card", () => {
		expect(
			numbers(
				unanswered(
					open,
					[message("user", "cap retries"), message("agent", "On it.")],
					true,
				),
			),
		).toEqual({ unanswered: ["2", "3"], uncarded: ["2", "3"] });
	});

	it("leaves out those the card the thread ends on asks, by their lines", () => {
		expect(
			numbers(
				unanswered(
					open,
					[
						message("user", "cap retries"),
						message("agent", "1. Should it  wrap?\n   - (a) Always"),
					],
					false,
				),
			),
		).toEqual({ unanswered: ["2", "3"], uncarded: ["2"] });
	});

	it("leaves uncarded only the questions a reply to a card left unanswered", () => {
		expect(
			numbers(
				unanswered(
					open,
					[
						message("agent", "1. How many retries?\n2. Should it wrap?"),
						message("user", "1. three"),
						message("agent", "Capping them."),
					],
					false,
				),
			),
		).toEqual({ unanswered: ["3"], uncarded: ["3"] });
	});

	it("reads a reply from their dialog by the numbers in Blocked", () => {
		expect(
			numbers(
				unanswered(
					open,
					[
						message("agent", "On it."),
						message("user", blockedReply("3. b")),
						message("agent", "Still on it."),
					],
					true,
				),
			),
		).toEqual({ unanswered: ["2"], uncarded: ["2"] });
	});

	it("takes numbers outside a reply to a card or their dialog for no answer", () => {
		expect(
			numbers(
				unanswered(
					open,
					[message("agent", "On it."), message("user", "2. three")],
					true,
				),
			),
		).toEqual({ unanswered: ["2", "3"], uncarded: ["2", "3"] });
	});
});
