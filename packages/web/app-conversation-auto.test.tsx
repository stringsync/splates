import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Event } from "@stringsync/splates/events";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	newWith,
	second,
	Testing,
	turn,
	typeIn,
	waitFor,
	within,
} from "./testing";

describe("App's Auto", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("starts on what Auto picks, with no settings to pick, telling the agent Auto picked it", async () => {
		const view = await testing.openConversations([], null);
		await newWith(view, "Auto");
		const home = view.getByRole("region", { name: "new conversation" });
		expect(within(home).getByText("Start a conversation with")).toBeTruthy();
		expect(
			within(home).getByText(
				"Auto picks the agent, model and effort from your first message",
			),
		).toBeTruthy();
		// Answered before Auto has picked, so the thread opens at once.
		testing.reply = conversation({
			id: "c9",
			status: "starting",
			picking: true,
		});

		const box = view.getByRole("textbox", { name: "Message input" });
		await typeIn(box, "fix the login");
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		await waitFor(() =>
			expect(testing.posted("/api/conversations/c9/prompt")).toHaveLength(1),
		);
		expect(testing.posted("/api/conversations/auto")).toEqual([
			{ method: "POST", body: { task: null, prompt: "fix the login" } },
		]);
		expect(testing.posted("/api/conversations")).toEqual([]);
		expect(
			testing.posted("/api/conversations/c9/prompt")[0]?.body,
		).toMatchObject({ text: "[SPLATES AUTO] fix the login" });

		// Named for what the person said, not the directive it went with.
		const said = [message("user", "[SPLATES AUTO] fix the login")];
		await testing.say(
			conversation({
				id: "c9",
				status: "starting",
				picking: true,
				messages: said.map((each) => ({ ...each, queued: true })),
			}),
		);
		await waitFor(() =>
			expect(view.getByRole("heading", { name: "fix the login" })).toBeTruthy(),
		);
		expect(
			view.getByRole("status", { name: "auto is picking the agent" }),
		).toBeTruthy();

		await testing.say(
			conversation({ id: "c9", status: "starting", messages: said }),
		);
		await waitFor(() =>
			expect(
				view.getByRole("status", { name: "waiting for agent to start" }),
			).toBeTruthy(),
		);
	});

	/** The line a conversation draws for Auto's pick, the judge having found `signs`. */
	const lineFor = async (signs: string[] | null) => {
		const view = await testing.openConversations([
			{ ...turn(["On it."]), events: [picked(signs)] },
		]);
		return await waitFor(() => view.getByRole("note", { name: "splates" }));
	};

	it("draws the pick as a line, what the judge found after it and every reason on hover", async () => {
		const line = await lineFor(["a well-specified edit"]);
		expect(line.textContent).toBe(
			"Auto pickedHaiku 5.5, low effort: a well-specified edit",
		);
		expect(line.querySelector("[title]")?.getAttribute("title")).toBe(
			"judged: a well-specified edit\nneeds tier 1 of 4",
		);
	});

	it("says no judge was asked when none was", async () => {
		const line = await lineFor(null);
		expect(line.textContent).toBe(
			"Auto pickedHaiku 5.5, low effort: no judge to ask",
		);
	});
});

/** Auto's pick of Haiku for the conversation, the judge having found `signs`. */
function picked(signs: string[] | null): Event {
	return {
		id: "a",
		// Before the prompt it was picked for, as the page sends it once the
		// conversation is up.
		at: second(-0.5),
		action: "auto",
		task: null,
		reason: null,
		conversation: "c1",
		agent: "claude",
		model: "haiku",
		effort: "low",
		reasons: [
			"Haiku 5.5, low effort",
			"judged: a well-specified edit",
			"needs tier 1 of 4",
		],
		signs,
	};
}
