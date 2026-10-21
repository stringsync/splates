import { afterEach, describe, expect, it } from "bun:test";
import type { Event, JudgedNote } from "@stringsync/splates-server/records";
import { cleanup, second, Testing, turn, waitFor, within } from "./testing";

const judged = (path: string, more: Partial<JudgedNote> = {}): JudgedNote => ({
	path,
	probability: 0.9,
	tier: "now",
	inContext: false,
	updated: false,
	...more,
});

const attached = (notes: JudgedNote[], holdout = false): Event => ({
	id: "n1",
	at: second(0.5),
	action: "notes attached",
	task: null,
	reason: null,
	conversation: "c1",
	notes,
	holdout,
	ms: 800,
});

describe("App's note chips", () => {
	let testing: Testing;

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("shows the notes a message came with under it, marking those held or edited", async () => {
		testing = new Testing();
		const view = await testing.openConversations([
			{
				...turn(["On it."]),
				events: [
					attached([
						judged("notes/retries.md"),
						judged("notes/merging.md", { tier: "optional", updated: true }),
						judged("notes/queue.md", { tier: null, inContext: true }),
						judged("notes/billing.md", { tier: null, probability: 0.1 }),
					]),
				],
			},
		]);
		const thread = await waitFor(() =>
			view.getByRole("region", { name: "Tests" }),
		);
		const chips = await waitFor(() => {
			const found = thread.querySelector("[data-slot=aui_user-message-notes]");
			expect(found).not.toBeNull();
			return found as HTMLElement;
		});
		expect(
			[...chips.querySelectorAll("button")].map((chip) => chip.textContent),
		).toEqual(["retries.md", "merging.mdupdated", "queue.mdin context"]);
		expect(
			within(chips).getByTitle("notes/queue.md (in context)"),
		).toBeTruthy();
	});

	it("shows nothing for a conversation held out from pointers", async () => {
		testing = new Testing();
		const view = await testing.openConversations([
			{ ...turn(["On it."]), events: [attached([judged("notes/a.md")], true)] },
		]);
		const thread = await waitFor(() =>
			view.getByRole("region", { name: "Tests" }),
		);
		await waitFor(() =>
			expect(within(thread).getByText("On it.")).toBeTruthy(),
		);
		expect(
			thread.querySelector("[data-slot=aui_user-message-notes]"),
		).toBeNull();
	});
});
