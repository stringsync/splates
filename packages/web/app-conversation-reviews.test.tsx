import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { details } from "./fixtures";
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

	it("leads with the live task's Before and After, its prose below", async () => {
		const view = await testing.openConversations([reviewing], undefined, {
			tasks: [
				details({
					task: "header",
					plan: "# header\n\n## Before\n\nIt wraps.\n\n## After\n\nIt fits.\n\nChecked at 390px.",
				}),
			],
		});
		const panel = await waitFor(() =>
			view.getByRole("region", { name: "review header" }),
		);
		expect(
			within(within(panel).getByRole("region", { name: "before" })).getByText(
				"It wraps.",
			),
		).toBeTruthy();
		expect(within(panel).getByText("It fits.")).toBeTruthy();
		expect(within(panel).getByText("The header wraps on phones.")).toBeTruthy();
	});

	it("switches After between Expected and Actual, opening on Actual, an older As built being Actual", async () => {
		const view = await testing.openConversations([reviewing], undefined, {
			tasks: [
				details({
					task: "header",
					plan: "# header\n\n## Before\n\nIt wraps.\n\n## After\n\nIt fits.\n\n*Expected*: the sketch.\n\n*As built*: the result.",
				}),
			],
		});
		const panel = await waitFor(() =>
			view.getByRole("region", { name: "review header" }),
		);
		const after = within(panel).getByRole("region", { name: "after" });
		expect(within(after).getByText("The result.")).toBeTruthy();
		expect(within(after).queryByText("The sketch.")).toBeNull();
		expect(within(panel).queryByText(/As built/)).toBeNull();
		await act(async () =>
			fireEvent.click(within(after).getByRole("button", { name: "Expected" })),
		);
		expect(within(after).getByText("The sketch.")).toBeTruthy();
		expect(within(after).queryByText("The result.")).toBeNull();
		expect(
			within(after)
				.getByRole("button", { name: "Expected" })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			within(after)
				.getByRole("button", { name: "Actual" })
				.getAttribute("aria-pressed"),
		).toBe("false");
		expect(within(after).getByText("It fits.")).toBeTruthy();
	});

	it("has no switch for an After holding only one of them", async () => {
		const view = await testing.openConversations([reviewing], undefined, {
			tasks: [
				details({
					task: "header",
					plan: "# header\n\n## After\n\nIt fits.\n\n*Expected*: the sketch.",
				}),
			],
		});
		const panel = await waitFor(() =>
			view.getByRole("region", { name: "review header" }),
		);
		expect(within(panel).getByText("The sketch.")).toBeTruthy();
		expect(within(panel).queryByRole("button", { name: "Actual" })).toBeNull();
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
			{ method: "POST", body: { text: "[SPLATES MERGE]" } },
		]);
	});

	it("says what to change from the card by keyboard, kept as a draft until sent", async () => {
		const view = await testing.openConversations([reviewing]);
		const panel = await waitFor(() =>
			view.getByRole("region", { name: "review header" }),
		);
		const changes = within(panel).getByRole("textbox", {
			name: "Changes to header",
		});
		// Ready to answer as soon as it shows.
		await waitFor(() => expect(document.activeElement === changes).toBe(true));
		expect(button(panel)).toBe("Merge");

		await typeIn(changes, "merge the header first");
		expect(textIn(changes)).toBe("merge the header first");
		// Merging would leave the changes unsaid, so Send stands in for it.
		expect(button(panel)).toBe("Send");
		expect(textIn(box(view))).toBe("");
		expect(localStorage.getItem("splates.draft.c1:review:0")).toBe(
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

	it("keeps changes written as a draft, there again on return", async () => {
		localStorage.setItem("splates.draft.c1:review:0", "merge the header first");
		const view = await testing.openConversations([reviewing]);
		const panel = await waitFor(() =>
			view.getByRole("region", { name: "review header" }),
		);
		expect(
			textIn(within(panel).getByRole("textbox", { name: "Changes to header" })),
		).toBe("merge the header first");
		expect(button(panel)).toBe("Send");
	});

	it("shows an approved review as a line of splates's, in place of the Merge it sent", async () => {
		const view = await testing.openConversations([
			conversation({
				...reviewing,
				messages: [...reviewing.messages, message("user", "[SPLATES MERGE]")],
			}),
		]);
		const line = await waitFor(() =>
			view.getByRole("note", { name: "splates" }),
		);
		expect(line.textContent).toBe("Review approvedheaderShow");
		expect(view.queryByTitle("[SPLATES MERGE]")).toBeNull();
		expect(view.queryByRole("region", { name: "review header" })).toBeNull();
	});

	it("opens an approved review from its line, with nothing left to answer", async () => {
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
		const line = await waitFor(() =>
			view.getByRole("note", { name: "splates" }),
		);
		await act(async () =>
			fireEvent.click(within(line).getByRole("button", { name: "Show" })),
		);

		const panel = view.getByRole("region", { name: "review header" });
		expect(panel.textContent).toContain("The header wraps on phones.");
		expect(within(panel).queryByRole("button", { name: /^Merge/ })).toBeNull();
		expect(within(panel).queryByRole("textbox")).toBeNull();
		expect(within(line).getByRole("button", { name: "Hide" })).toBeTruthy();
	});

	it("folds once the person asked for changes, opening on what they asked, whatever is typed after", async () => {
		const view = await testing.openConversations([
			conversation({
				...reviewing,
				messages: [...reviewing.messages, message("user", "Shorter title.")],
			}),
		]);
		const panel = await waitFor(() =>
			view.getByRole("region", { name: "review header" }),
		);
		const fold = within(panel).getByRole("button", {
			name: /Ready to merge/,
		});
		expect(fold.getAttribute("aria-expanded")).toBe("false");
		expect(fold.textContent).toContain("Changes asked");
		expect(panel.textContent).not.toContain("The header wraps on phones.");

		await typeIn(box(view), "merge");
		await act(async () => fireEvent.click(fold));

		expect(panel.textContent).toContain("The header wraps on phones.");
		expect(panel.textContent).toContain("Asked forShorter title.");
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

	it("shows a demo as steps to follow, where it runs a click away", async () => {
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
		expect(card.textContent).toContain("It lands where you drop it.");
		expect(within(card).queryByRole("checkbox")).toBeNull();
		expect(card.textContent).not.toContain("tried");
	});

	// vet-ignore simple-test-setup: it opens a conversation of its own, which no other test shares
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

	// vet-ignore simple-test-setup: it opens a conversation of its own, which no other test shares
	it("orders a review by what deciding takes: summary, demo, checks, then the details under a header", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Header",
				messages: [
					message(
						"agent",
						[
							"## 🔍 Ready to merge header onto main",
							"",
							"The header wraps on phones.",
							"",
							...demo,
							"",
							"Checks: `bun run typecheck`, `bun test`",
							"",
							"It breaks at 400px, kept in one constant.",
							"",
							'Reply "merge", or say what to change.',
						].join("\n"),
					),
				],
			}),
		]);

		const panel = await waitFor(() =>
			view.getByRole("region", { name: "review header" }),
		);
		const regions = within(panel)
			.getAllByRole("region")
			.map((each) => each.getAttribute("aria-label"));
		expect(regions).toEqual(["demo dragging a card"]);
		const text = panel.textContent ?? "";
		expect(text.indexOf("The header wraps on phones.")).toBeLessThan(
			text.indexOf("Drag it to another lane."),
		);
		expect(
			within(panel).getByText("It breaks at 400px, kept in one constant."),
		).toBeTruthy();
	});
});

/** The one button the review's footer shows: Merge, or Send. */
function button(panel: HTMLElement): string {
	const shown = ["Merge", "Send"].filter(
		(name) => within(panel).queryByRole("button", { name }) !== null,
	);
	expect(shown).toHaveLength(1);
	return shown[0] ?? "";
}
