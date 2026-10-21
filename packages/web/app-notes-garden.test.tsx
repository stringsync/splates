import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import {
	AGENTS,
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	message,
	Testing,
	waitFor,
	within,
} from "./testing";

const NOTE = {
	path: "/repo/notes/exports.md",
	description: "Why named exports",
	uses: 3,
	recommended: 5,
	followed: 2,
	text: "---\ndescription: Why named exports\n---\nUse named exports.",
	body: "Use named exports.",
	blob: "abc123",
};

const REVIEW = [
	"## 🔍 Ready to merge notes-garden onto main",
	"",
	"Merges two notes on exports.",
	"",
	'Reply "merge", or say what to change.',
].join("\n");

describe("the notes gardener's draft on the Notes page", () => {
	let testing: Testing;
	beforeEach(() => {
		testing = new Testing();
		testing.notes.items = [NOTE];
		testing.diffs["notes-garden"] = [
			{
				path: "notes/exports.md",
				from: null,
				status: "modified",
				added: 1,
				removed: 1,
				binary: false,
				uncommitted: false,
				hunks: [
					{
						range: "@@ -1,2 +1,2 @@",
						lines: [
							{ kind: "context", text: "Use named exports." },
							{ kind: "removed", text: "Default exports are fine." },
							{ kind: "added", text: "Never default exports." },
						],
					},
				],
			},
			{
				path: "notes/default-exports.md",
				from: null,
				status: "deleted",
				added: 0,
				removed: 3,
				binary: false,
				uncommitted: false,
				hunks: [],
			},
		];
	});
	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const gardener = (messages: ConversationState["messages"]) =>
		conversation({ id: "g1", task: "notes-garden", messages });

	const openNotes = async (held: ConversationState[]) => {
		testing.talk = { agents: AGENTS, conversations: held };
		const view = await testing.open({
			tasks: [
				details({
					task: "notes-garden",
					lease: "held",
					ahead: 1,
					added: 1,
					removed: 4,
				}),
			],
		});
		await act(async () => {
			location.hash = "#notes";
			window.dispatchEvent(new HashChangeEvent("hashchange"));
		});
		return within(
			await waitFor(() =>
				view.getByRole("region", { name: "notes gardener's draft" }),
			),
		);
	};

	it("shows each note the draft changes or removes, old against new", async () => {
		const draft = await openNotes([gardener([message("agent", REVIEW)])]);
		expect(await draft.findByText("notes/exports.md")).toBeTruthy();
		expect(draft.getByText("notes/default-exports.md")).toBeTruthy();
		expect(draft.getByText("deleted")).toBeTruthy();
		fireEvent.click(draft.getByRole("button", { name: /Expand all/ }));
		expect(draft.getByText("Default exports are fine.")).toBeTruthy();
		expect(draft.getByText("Never default exports.")).toBeTruthy();
	});

	it("merges the draft from the page, as the review card would", async () => {
		const draft = await openNotes([gardener([message("agent", REVIEW)])]);
		await act(async () =>
			fireEvent.click(await draft.findByRole("button", { name: /Merge/ })),
		);
		expect(draft.getByText(/Merge asked/)).toBeTruthy();
		expect(testing.posted("/api/conversations/g1/prompt")).toEqual([
			{ method: "POST", body: { text: "[SPLATES MERGE]" } },
		]);
	});

	it("sends the draft back with what to change", async () => {
		const draft = await openNotes([gardener([message("agent", REVIEW)])]);
		fireEvent.change(
			await draft.findByLabelText("What to change in the gardener's draft"),
			{ target: { value: "Keep the default exports note" } },
		);
		expect(
			draft.getByRole("button", { name: /Merge/ }).hasAttribute("disabled"),
		).toBe(true);
		await act(async () =>
			fireEvent.click(draft.getByRole("button", { name: /Send back/ })),
		);
		expect(testing.posted("/api/conversations/g1/prompt")).toEqual([
			{
				method: "POST",
				body: { text: "Keep the default exports note" },
			},
		]);
	});

	it("offers no merge while the gardener is still drafting", async () => {
		const draft = await openNotes([
			gardener([message("user", "[SPLATES GARDEN]")]),
		]);
		expect(await draft.findByText("notes/exports.md")).toBeTruthy();
		expect(draft.queryByRole("button", { name: /Merge/ })).toBeNull();
	});
});
