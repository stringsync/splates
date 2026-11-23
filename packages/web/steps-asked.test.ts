import { describe, expect, it } from "bun:test";
import type { ThreadMessage, ThreadMessageLike } from "@assistant-ui/react";
import type { Steps } from "@splates/server/plans/browser";
import {
	askedFrom,
	askedOnly,
	changedSteps,
	doneFrom,
	exchangesOf,
	finishedOf,
	readAsked,
	readDone,
	versionsIn,
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

	it("names the last step once every step is done", () => {
		expect(readAsked(askedFrom(STEPS, 3, "Now what?"))?.step).toBe(3);
	});

	it("pairs each question with the agent's messages, by index, until the next message of the person's", () => {
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
				messages: [1, 2, 3],
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

	it("says the person finished and how many steps they checked off, and reads back", () => {
		const sent = doneFrom(STEPS, 1);

		expect(sent).toBe(
			'(Done with the steps "Rotate the secret": 1 of 3 checked off)',
		);
		expect(readDone(sent)).toEqual({
			title: "Rotate the secret",
			checked: 1,
			count: 3,
		});
		expect(readDone("Done with it.")).toBeNull();
	});

	it("marks the newest version finished by a Done after it, and a newer version starts over", () => {
		const done = user("u1", doneFrom(STEPS, 3));
		const first = [
			agent("a0", { type: "data", name: "steps", data: { steps: STEPS } }),
			done,
		];

		expect(finishedOf(first, STEPS.title)?.checked).toBe(3);
		expect(finishedOf(first, "Another card")).toBeNull();
		expect(
			finishedOf(
				[
					...first,
					agent("a1", { type: "data", name: "steps", data: { steps: STEPS } }),
				],
				STEPS.title,
			),
		).toBeNull();
	});

	it("keeps only the questions asked from the card's pop-out and what the agent said after each", () => {
		const fed: ThreadMessageLike[] = [
			{
				id: "a0",
				role: "assistant",
				content: [{ type: "data-steps", data: { steps: STEPS } }],
			},
			{ id: "u1", role: "user", content: askedFrom(STEPS, 1, "Where?") },
			{
				id: "a1",
				role: "assistant",
				content: [{ type: "text", text: "Here." }],
			},
			{ id: "u2", role: "user", content: "Something else" },
			{
				id: "a2",
				role: "assistant",
				content: [{ type: "text", text: "Sure." }],
			},
			{
				id: "u3",
				role: "user",
				content: askedFrom({ ...STEPS, title: "Other" }, 0, "Hm?"),
			},
		];

		expect(askedOnly(fed, STEPS.title).map((each) => each.id)).toEqual([
			"u1",
			"a1",
		]);
		expect(versionsIn(fed, STEPS.title)).toEqual([STEPS]);
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
