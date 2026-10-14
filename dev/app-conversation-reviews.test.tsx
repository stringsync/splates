import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	type ConversationsView,
	cleanup,
	conversation,
	details,
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
			{ method: "POST", body: { text: "[ARBOR MERGE]" } },
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

	const assumed = {
		tasks: [
			details({
				task: "header",
				plan: [
					"# header",
					"",
					"## Assumptions",
					"",
					"- [ ] 1. Where should the header wrap?",
					"  - (a) Below 400px (chosen)",
					"  - (b) Below 600px",
					"- [ ] 2. What should the menu be called?",
					"  - (a) Menu (chosen)",
					"  - (b) More",
				].join("\n"),
			}),
		],
	};

	it("lists what the task assumed, from its plan, and sends a challenge with the changes", async () => {
		const view = await testing.openConversations([reviewing], "c1", assumed);
		const panel = await waitFor(() =>
			view.getByRole("region", { name: "review header" }),
		);
		const list = within(panel).getByRole("region", { name: "Assumptions" });
		expect(within(list).getByText("Below 400px")).toBeTruthy();
		// What it passed over waits for a challenge.
		expect(within(list).queryByText("Below 600px")).toBeNull();
		const merge = within(panel).getByRole("button", {
			name: "Merge",
		}) as HTMLButtonElement;
		expect(merge.disabled).toBe(false);

		await act(async () =>
			fireEvent.click(
				within(list).getByRole("button", {
					name: "Challenge assumption 1",
				}),
			),
		);
		const challenge = within(list).getByRole("listitem", {
			name: "question 1",
		});
		// Only what it passed over is offered.
		expect(
			within(challenge).queryByRole("button", { name: /Below 400px/ }),
		).toBeNull();
		await act(async () =>
			fireEvent.click(
				within(challenge).getByRole("button", { name: /Below 600px/ }),
			),
		);
		// Merging would leave the challenge unsaid.
		expect(merge.disabled).toBe(true);
		await act(async () =>
			fireEvent.change(
				within(panel).getByRole("textbox", { name: "Changes to header" }),
				{ target: { value: "and bolder" } },
			),
		);
		await act(async () =>
			fireEvent.click(
				within(panel).getByRole("button", { name: "Send changes" }),
			),
		);

		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{
				method: "POST",
				body: {
					text: [
						"and bolder",
						"",
						"> **Where should the header wrap?**",
						"",
						"- (b) Below 600px",
					].join("\n"),
				},
			},
		]);
	});

	it("puts a challenge away with Keep, leaving the assumption as it was", async () => {
		const view = await testing.openConversations([reviewing], "c1", assumed);
		const panel = await waitFor(() =>
			view.getByRole("region", { name: "review header" }),
		);
		const list = within(panel).getByRole("region", { name: "Assumptions" });
		await act(async () =>
			fireEvent.click(
				within(list).getByRole("button", { name: "Challenge assumption 2" }),
			),
		);
		await act(async () =>
			fireEvent.click(within(list).getByRole("button", { name: /More/ })),
		);
		const merge = within(panel).getByRole("button", {
			name: "Merge",
		}) as HTMLButtonElement;
		expect(merge.disabled).toBe(true);

		await act(async () =>
			fireEvent.click(
				within(list).getByRole("button", { name: "Keep assumption 2" }),
			),
		);

		expect(
			within(list).queryByRole("listitem", { name: "question 2" }),
		).toBeNull();
		expect(
			within(list).getByRole("listitem", { name: "assumption 2" }),
		).toBeTruthy();
		expect(merge.disabled).toBe(false);
		expect(localStorage.getItem("arbor.draft.c1:review:0")).toBeNull();
	});

	it("keeps a challenge written as a draft, open again on return", async () => {
		localStorage.setItem(
			"arbor.draft.c1:review:0",
			"> **What should the menu be called?**\n\n- (b) More",
		);
		const view = await testing.openConversations([reviewing], "c1", assumed);
		const list = await waitFor(() =>
			view.getByRole("region", { name: "Assumptions" }),
		);
		const challenge = within(list).getByRole("listitem", {
			name: "question 2",
		});
		expect(
			within(challenge)
				.getByRole("button", { name: /More/ })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			(
				within(view.getByRole("region", { name: "review header" })).getByRole(
					"button",
					{ name: "Merge" },
				) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	it("folds as approved once Merge has sent its directive, shown as a merge card", async () => {
		const view = await testing.openConversations([
			conversation({
				...reviewing,
				messages: [...reviewing.messages, message("user", "[ARBOR MERGE]")],
			}),
		]);
		const panel = await waitFor(() =>
			view.getByRole("region", { name: "review header" }),
		);
		expect(
			within(panel).getByRole("button", { name: /Ready to merge/ }).textContent,
		).toContain("Merge approved");
		expect(view.getByRole("region", { name: "merge" }).textContent).toContain(
			"Asked the agent to merge the task it had reviewed.",
		);
		expect(view.queryByTitle("[ARBOR MERGE]")).toBeNull();
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

	it("orders a review by what deciding takes: summary, demo, assumptions, checks, then the details folded", async () => {
		const view = await testing.openConversations(
			[
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
			],
			"c1",
			assumed,
		);

		const panel = await waitFor(() =>
			view.getByRole("region", { name: "review header" }),
		);
		const regions = within(panel)
			.getAllByRole("region")
			.map((each) => each.getAttribute("aria-label"));
		expect(regions).toEqual([
			"demo dragging a card",
			"Assumptions",
			"Checks",
			"Details",
		]);
		const text = panel.textContent ?? "";
		expect(text.indexOf("The header wraps on phones.")).toBeLessThan(
			text.indexOf("Drag it to another lane."),
		);
		const checks = within(panel).getByRole("region", { name: "Checks" });
		expect(within(checks).getByText("bun run typecheck")).toBeTruthy();
		expect(within(checks).getByText("bun test")).toBeTruthy();
		// The details wait behind its toggle.
		expect(
			view.queryByText("It breaks at 400px, kept in one constant."),
		).toBeNull();
		fireEvent.click(within(panel).getByRole("button", { name: "Details" }));
		await waitFor(() =>
			expect(
				view.getByText("It breaks at 400px, kept in one constant."),
			).toBeTruthy(),
		);
	});
});
