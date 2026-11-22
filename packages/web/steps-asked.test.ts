import { describe, expect, it } from "bun:test";
import type { ThreadMessage } from "@assistant-ui/react";
import type { Steps } from "@splates/server/plans/browser";
import {
	askedFrom,
	changedSteps,
	exchangesOf,
	readAsked,
	versionsOf,
} from "./steps-asked";

describe("the pop-out's questions and the steps' versions", () => {
	it("names the step the person is on, its first line, ahead of their words", () => {
		expect(askedFrom(STEPS, 1, "No Roll button here.")).toBe(
			'(From the steps pop-out, on step 2 of 3 of "Rotate the secret": Press **Roll**.)\n\nNo Roll button here.',
		);
	});

	it("reads back as the card, the step and the words", () => {
		expect(readAsked(askedFrom(STEPS, 1, "Where?\nI looked."))).toEqual({
			title: "Rotate the secret",
			step: 2,
			words: "Where?\nI looked.",
		});
		expect(readAsked("Just a message.")).toBeNull();
	});

	it("reads back the server's copy, its line ends \\r\\n", () => {
		const sent = askedFrom(STEPS, 1, "Where?\nI looked.").replaceAll(
			"\n",
			"\r\n",
		);

		expect(readAsked(sent)).toEqual({
			title: "Rotate the secret",
			step: 2,
			words: "Where?\nI looked.",
		});
	});

	it("counts the agent's work as no card", () => {
		const messages = [
			user("u1", askedFrom(STEPS, 1, "No Roll button.")),
			agent("a1", { type: "data", name: "work", data: {} }),
			agent("a2", { type: "text", text: "It's in the ⋯ menu." }),
		];

		expect(exchangesOf(messages, "Rotate the secret", false)[0]?.carded).toBe(
			false,
		);
	});

	it("names the last step once every step is done", () => {
		expect(readAsked(askedFrom(STEPS, 3, "Now what?"))?.step).toBe(3);
	});

	it("pairs each question with the agent's answers until the next message of the person's", () => {
		const messages = [
			agent("a0", { type: "data", name: "steps", data: { steps: STEPS } }),
			user("u1", askedFrom(STEPS, 1, "No Roll button.")),
			agent("a1", { type: "text", text: "It's in the ⋯ menu." }),
			agent("a2", { type: "data", name: "questions", data: {} }),
			user("u2", "Something else."),
			agent("a3", { type: "text", text: "Not about the steps." }),
		];

		expect(exchangesOf(messages, "Rotate the secret", false)).toEqual([
			{
				id: "u1",
				step: 2,
				words: "No Roll button.",
				answers: ["It's in the ⋯ menu."],
				carded: true,
				waiting: false,
			},
		]);
	});

	it("waits on the last question while the agent is still at work on it", () => {
		const messages = [user("u1", askedFrom(STEPS, 0, "Which account?"))];

		expect(
			exchangesOf(messages, "Rotate the secret", true).map(
				(each) => each.waiting,
			),
		).toEqual([true]);
	});

	it("leaves out questions asked from another card", () => {
		const other = { ...STEPS, title: "Other" };

		expect(
			exchangesOf(
				[user("u1", askedFrom(other, 0, "Hm?"))],
				"Rotate the secret",
				false,
			),
		).toEqual([]);
	});

	it("lists every Steps card of the title, oldest first", () => {
		const fixed = {
			...STEPS,
			steps: ["Open the dashboard.", "Open ⋯, choose Roll."],
		};
		const messages = [
			agent("a0", { type: "data", name: "steps", data: { steps: STEPS } }),
			agent("a1", {
				type: "data",
				name: "steps",
				data: { steps: { ...STEPS, title: "Other" } },
			}),
			agent(
				"a2",
				{ type: "text", text: "Fixed." },
				{ type: "data", name: "steps", data: { steps: fixed } },
			),
		];

		expect(versionsOf(messages, "Rotate the secret")).toEqual([STEPS, fixed]);
	});

	it("names the steps a version changed, with the words each had", () => {
		const fixed = {
			...STEPS,
			steps: [
				"Open the dashboard.",
				"Open ⋯, choose Roll.",
				"Store it.",
				"Test it.",
			],
		};

		expect([...changedSteps(STEPS, fixed)]).toEqual([
			[1, "Press **Roll**.\nIt shows once."],
			[3, null],
		]);
		expect([...changedSteps(null, fixed)]).toEqual([]);
	});
});

const STEPS: Steps = {
	title: "Rotate the secret",
	intro: "",
	steps: [
		"Open the dashboard.",
		"Press **Roll**.\nIt shows once.",
		"Store it.",
	],
	outro: "",
};

function user(id: string, text: string): ThreadMessage {
	return { id, role: "user", content: [{ type: "text", text }] } as never;
}

function agent(id: string, ...content: unknown[]): ThreadMessage {
	return { id, role: "assistant", content } as never;
}
