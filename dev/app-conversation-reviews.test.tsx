import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	type ConversationsView,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	textIn,
	typeIn,
	waitFor,
	within,
} from "./testing";

describe("App's review panel and demo cards", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const reviewing = conversation({
		title: "Header",
		messages: [
			message(
				"agent",
				[
					"## 🔍 Ready to merge header onto main",
					"",
					"The header wraps on phones.",
					"",
					"Open the page at 390px wide.",
					"",
					'Reply "merge", or say what to change.',
				].join("\n"),
			),
		],
	});
	const box = (view: ConversationsView) =>
		view.getByRole("textbox", {
			name: "Message input",
		});

	it("shows a review apart from questions, merging from the card", async () => {
		const view = await testing.openConversations([reviewing]);
		const panel = await waitFor(() =>
			view.getByRole("region", { name: "review header" }),
		);
		expect(within(panel).getByText("The header wraps on phones.")).toBeTruthy();
		expect(view.queryByText(/Reply "merge"/)).toBeNull();
		expect(view.queryByRole("list", { name: "questions" })).toBeNull();

		await act(async () =>
			fireEvent.click(within(panel).getByRole("button", { name: "Merge" })),
		);

		expect(textIn(box(view))).toBe("");
		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{ method: "POST", body: { text: "merge" } },
		]);
	});

	it("says what to change from the card by keyboard, kept as a draft until sent", async () => {
		const view = await testing.openConversations([reviewing]);
		const panel = await waitFor(() =>
			view.getByRole("region", { name: "review header" }),
		);
		const changes = within(panel).getByRole("textbox", {
			name: "Changes to header",
		}) as HTMLTextAreaElement;
		// Ready to answer as soon as it shows.
		await waitFor(() => expect(document.activeElement === changes).toBe(true));
		const merge = within(panel).getByRole("button", {
			name: "Merge",
		}) as HTMLButtonElement;
		expect(merge.disabled).toBe(false);

		await act(async () =>
			fireEvent.change(changes, {
				target: { value: "merge the header first" },
			}),
		);
		expect(changes.value).toBe("merge the header first");
		// Merging would leave the changes unsaid.
		expect(merge.disabled).toBe(true);
		expect(textIn(box(view))).toBe("");
		expect(localStorage.getItem("arbor.draft.c1:review:0")).toBe(
			"merge the header first",
		);
		await act(async () =>
			fireEvent.keyDown(changes, { key: "Enter", shiftKey: true }),
		);
		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([]);
		await act(async () => fireEvent.keyDown(changes, { key: "Enter" }));

		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{ method: "POST", body: { text: "merge the header first" } },
		]);
	});

	it("folds once the person has replied, opening on the reply that was sent, whatever is typed after", async () => {
		const view = await testing.openConversations([
			conversation({
				...reviewing,
				messages: [
					...reviewing.messages,
					message("user", "merge"),
					message("agent", "Merged."),
				],
			}),
		]);
		const panel = await waitFor(() =>
			view.getByRole("region", { name: "review header" }),
		);
		const fold = within(panel).getByRole("button", {
			name: /Ready to merge/,
		});
		expect(fold.getAttribute("aria-expanded")).toBe("false");
		expect(fold.textContent).toContain("Merge approved");
		expect(panel.textContent).not.toContain("The header wraps on phones.");

		await typeIn(box(view), "merge");
		await act(async () => fireEvent.click(fold));

		expect(panel.textContent).toContain("The header wraps on phones.");
		expect(within(panel).queryByRole("button", { name: /^Merge/ })).toBeNull();
		expect(within(panel).queryByRole("textbox")).toBeNull();
	});

	const demo = [
		"### 🎬 Demo: dragging a card",
		"",
		"Open http://localhost:4310. It's a demo repo.",
		"",
		"1. Press and hold a card.",
		"   It lifts.",
		"2. Drag it to another lane.",
		"   It lands where you drop it.",
	];

	it("shows a demo as steps to tick off, where it runs a click away", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Demo",
				messages: [message("agent", demo.join("\n"))],
			}),
		]);

		const card = await waitFor(() =>
			view.getByRole("region", { name: "demo dragging a card" }),
		);
		expect(
			within(card).getByRole("link", { name: "Open" }).getAttribute("href"),
		).toBe("http://localhost:4310");
		expect(card.textContent).toContain("It lands where you drop it.");
		expect(card.textContent).toContain("0 of 2 tried");
		const first = within(card).getByRole("checkbox", {
			name: "Step 1 tried",
		}) as HTMLInputElement;

		await act(async () => fireEvent.click(first));

		expect(first.checked).toBe(true);
		expect(card.textContent).toContain("1 of 2 tried");
	});

	it("shows an escalation's demo in its questions' card, above them", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Demo",
				messages: [
					message(
						"agent",
						[
							"## ⚠️ Escalated board: needs a phone check",
							"",
							"Cards drag on phones now.",
							"",
							...demo,
							"",
							"1. Does dragging feel right?",
						].join("\n"),
					),
				],
			}),
		]);

		const card = await waitFor(() =>
			view.getByRole("region", { name: "escalated board" }),
		);
		const shown = within(card).getByRole("region", {
			name: "demo dragging a card",
		});
		expect(shown.textContent).toContain("Press and hold a card.");
		expect(card.textContent).toContain("Does dragging feel right?");
		expect(view.getAllByRole("region", { name: /^demo/ })).toEqual([shown]);
	});

	it("shows a review's demo in its panel, above Merge", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Demo",
				messages: [
					message(
						"agent",
						[
							"## 🔍 Ready to merge board onto main",
							"",
							"Cards drag on phones now.",
							"",
							...demo,
							"",
							'Reply "merge", or say what to change.',
						].join("\n"),
					),
				],
			}),
		]);

		const panel = await waitFor(() =>
			view.getByRole("region", { name: "review board" }),
		);
		expect(
			within(panel).getByRole("region", { name: "demo dragging a card" })
				.textContent,
		).toContain("Drag it to another lane.");
		expect(within(panel).getByRole("button", { name: "Merge" })).toBeTruthy();
	});
});
