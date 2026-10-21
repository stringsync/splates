import { afterEach, describe, expect, it } from "bun:test";
import type { Event, JudgedNote } from "@stringsync/splates-server/records";
import {
	act,
	cleanup,
	fireEvent,
	second,
	Testing,
	turn,
	waitFor,
	within,
} from "./testing";

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

	it("shows the notes a message came with as one pill that lists them and opens each", async () => {
		testing = new Testing();
		testing.notes.items = [
			{
				path: "/repo/notes/retries.md",
				description: "When uploads retry",
				text: "",
				body: "Retry twice.",
			},
		];
		const view = await testing.openConversations([
			{
				...turn(["On it."]),
				events: [
					attached([
						judged("notes/merging.md", { tier: "optional", updated: true }),
						judged("notes/queue.md", { tier: null, inContext: true }),
						judged("notes/retries.md"),
						judged("notes/billing.md", { tier: null, probability: 0.1 }),
					]),
				],
			},
		]);
		const thread = await waitFor(() =>
			view.getByRole("region", { name: "Tests" }),
		);
		const pill = await waitFor(() => {
			const found = thread.querySelector("[data-slot=aui_user-message-notes]");
			expect(found).not.toBeNull();
			return within(found as HTMLElement).getByRole("button");
		});
		expect(pill.textContent).toBe("3 notes");
		await act(async () => fireEvent.click(pill));
		const list = await waitFor(() =>
			view.getByRole("list", { name: "Pointed to for this message" }),
		);
		const rows = within(list).getAllByRole("button");
		expect(rows.map((row) => row.textContent)).toEqual([
			"retries.mdWhen uploads retry",
			"merging.mdmaybe relevantupdated",
			"queue.mdin context",
		]);
		await act(async () => fireEvent.click(rows[0] as HTMLElement));
		await waitFor(() =>
			expect(view.getByRole("dialog").textContent).toContain("Retry twice."),
		);
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
