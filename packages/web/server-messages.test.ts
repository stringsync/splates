import { describe, expect, it } from "bun:test";
import {
	conversationHandOffReference,
	eventReference,
	handOffReference,
	scheduleReference,
	taskReference,
} from "@splates/server/plans";
import { handOffLines, serverToldLines } from "./server-messages";

const board: Parameters<typeof serverToldLines>[1] = {
	lanes: [],
	todos: [
		{ id: 7, subject: "Fix upload" } as never,
		{ id: 8, subject: "Sort events" } as never,
	],
};

function words(text: string) {
	return serverToldLines(text, board, null)[0]?.words;
}

describe("server-authored message lines", () => {
	it("names an automation's event or schedule, keeping its full prompt on hover", () => {
		const event = `${eventReference("task.created", [7], null)}\n\nCheck the new task.`;
		expect(words(event)).toEqual([
			"Automation",
			{ kind: "automation", name: "task.created #7" },
		]);
		expect(serverToldLines(event, board, null)[0]?.title).toBe(event);

		expect(words(`${scheduleReference("3")}\n\nReview the week.`)).toEqual([
			"Scheduled run",
			{ kind: "automation", name: "automation 3", scheduled: true },
		]);
	});

	it("names the todos a sort an older server asked about", () => {
		expect(words("[SPLATES SORT #7 #8]")).toEqual([
			"Sort",
			{
				kind: "todos",
				todos: [
					{ id: 7, subject: "Fix upload" },
					{ id: 8, subject: "Sort events" },
				],
			},
		]);
	});

	it("names a dispatched, restarted or handed-off task", () => {
		expect(words(`${taskReference("fix-it")}\n\nTake it from here.`)).toEqual([
			"Started",
			{ kind: "task", task: "fix-it" },
		]);
		const handoff = handOffReference(
			"fix-it",
			"/tmp/with spaces/conversations/c-2/transcript.md",
		);
		expect(words(handoff)).toEqual([
			"Restarted",
			{ kind: "task", task: "fix-it" },
		]);
		expect(handOffLines(handoff, null)?.[0]?.words).toEqual([
			"Handed off from",
			{ kind: "conversation", id: "c-2" },
		]);
		expect(handOffLines(handoff, null)?.[0]?.title).toBe(handoff);

		const chatHandoff = conversationHandOffReference(
			"/home/me/.splates/conversations/c-1/transcript.md",
		);
		expect(handOffLines(chatHandoff, null)?.[0]?.words).toEqual([
			"Handed off from",
			{ kind: "conversation", id: "c-1" },
		]);
		expect(handOffLines(chatHandoff, null)?.[0]?.title).toBe(chatHandoff);

		// A path that names no folder keeps the line as it was.
		const bare = conversationHandOffReference("/tmp/transcript.md");
		expect(handOffLines(bare, null)?.[0]?.words).toEqual(["Handoff"]);
		expect(
			handOffLines(handOffReference("fix-it", "transcript.md"), null)?.[0]
				?.words,
		).toEqual(["Handoff", { kind: "task", task: "fix-it" }]);
	});

	it("words a completed wait as a finished wait with its outcome", () => {
		expect(
			words(
				"[SPLATES WAIT COMPLETE]\n\nThe machine has stayed idle for 60000ms (sampled every 5 seconds).",
			),
		).toEqual([
			"Wait finished: The machine has stayed idle for 60000ms (sampled every 5 seconds)",
		]);
		expect(words("[SPLATES WAIT COMPLETE]")).toEqual(["Wait finished"]);
	});

	it("gives an unrecognized server prompt a line rather than a user bubble", () => {
		const text = "A server prompt the page does not know yet.";
		expect(words(text)).toEqual([
			"Told agent “A server prompt the page does not know yet”",
		]);
		expect(words(`${"word ".repeat(30)}\nsecond line`)?.[0]).toMatch(
			/^Told agent “word .*…”$/u,
		);
		expect(serverToldLines(text, board, null)[0]?.title).toBe(text);
	});
});
