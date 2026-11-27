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

describe("App's review panel", () => {
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

	it("leads with the live task's Before and After, leaving out the summary After repeats", async () => {
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
		expect(within(panel).queryByText("The header wraps on phones.")).toBeNull();
		expect(
			within(within(panel).getByRole("region", { name: "notes" })).getByText(
				"Open the page at 390px wide.",
			),
		).toBeTruthy();
	});

	// vet-ignore simple-test-setup: its review repeats the record's After picture, which no other test's does
	it("leaves out of Notes a picture After shows, and Notes itself once nothing is left", async () => {
		const review = (...notes: string[]) =>
			conversation({
				title: "Header",
				messages: [
					message(
						"agent",
						[
							"## 🔍 Ready to merge header onto main",
							"",
							"The header fits.",
							"",
							...notes,
							"",
							'Reply "merge", or say what to change.',
						].join("\n"),
					),
				],
			});
		const tasks = [
			details({
				task: "header",
				plan: "# header\n\n## Before\n\nIt wraps.\n\n## After\n\n![fits](</a/fits.png>)\n\nIt fits.",
			}),
		];
		const view = await testing.openConversations(
			[review("![fits again](/a/fits.png)", "", "- Snapshots re-recorded.")],
			undefined,
			{ tasks },
		);
		const panel = await waitFor(() =>
			view.getByRole("region", { name: "review header" }),
		);
		const notes = within(panel).getByRole("region", { name: "notes" });
		expect(within(notes).getByText("Snapshots re-recorded.")).toBeTruthy();
		expect(panel.innerHTML).toContain("fits");
		expect(panel.innerHTML).not.toContain("fits again");
		cleanup();

		const only = await testing.openConversations(
			[review("![fits again](/a/fits.png)")],
			undefined,
			{ tasks },
		);
		const bare = await waitFor(() =>
			only.getByRole("region", { name: "review header" }),
		);
		expect(within(bare).queryByRole("region", { name: "notes" })).toBeNull();
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

	// vet-ignore simple-test-setup: it opens a conversation of its own, which no other test shares
	it("orders a review by what deciding takes: summary, checks, then the details", async () => {
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
		const text = panel.textContent ?? "";
		expect(text.indexOf("The header wraps on phones.")).toBeLessThan(
			text.indexOf("It breaks at 400px, kept in one constant."),
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
