import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { ConversationState } from "../conversations";
import {
	act,
	type ConversationsView,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	textIn,
	waitFor,
	within,
} from "./testing";

describe("App's question card keys", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const report = [
		"## ⚠️ Escalated header: waiting on two calls",
		"",
		"The header wraps now.",
		"",
		"1. Which pages need it?",
		"   - [a] Todos",
		"   - [b] Tasks",
		"2. How should a stale todo be shown?",
		"   - (a) A muted card",
		"   - (b) A badge",
		"3. Ready to merge?",
	].join("\n");

	const asking = (status: ConversationState["status"] = "idle") =>
		conversation({
			title: "Header",
			status,
			messages: [message("user", "fix the header"), message("agent", report)],
		});

	const box = (view: ConversationsView) =>
		view.getByRole("textbox", {
			name: "Message input",
		});

	const card = (view: ConversationsView, question: string) =>
		view.getByRole("listitem", { name: `question ${question}` });

	it("answers by keyboard alone: letters pick, Enter goes on, and sends from anything else", async () => {
		const view = await testing.openConversations([asking()]);
		const first = await waitFor(() =>
			within(card(view, "1")).getByRole("button", { name: /Todos/ }),
		);
		// Ready to answer as soon as it shows.
		await waitFor(() => expect(document.activeElement === first).toBe(true));
		const key = async (key: string, options = {}) =>
			act(async () =>
				fireEvent.keyDown(document.activeElement as Element, {
					key,
					...options,
				}),
			);

		await key("b");
		await key("a");
		expect(
			within(card(view, "1"))
				.getAllByRole("button", { pressed: true })
				.map((each) => each.textContent),
		).toEqual(["aTodos", "bTasks"]);
		expect(document.activeElement === first).toBe(true);
		await key("Enter");
		expect(document.activeElement?.textContent).toContain("A muted card");
		await key("ArrowDown");
		expect(document.activeElement?.textContent).toContain("A badge");
		await key("b");
		await key("Enter");
		expect(
			document.activeElement === within(card(view, "3")).getByRole("textbox"),
		).toBe(true);
		await act(async () =>
			fireEvent.change(document.activeElement as Element, {
				target: { value: "soon" },
			}),
		);
		await key("Enter");
		const more = view.getByRole("textbox", { name: "Anything else" });
		expect(document.activeElement === more).toBe(true);
		await act(async () =>
			fireEvent.change(more, { target: { value: "Thanks" } }),
		);
		await key("Enter", { shiftKey: true });
		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([]);
		await key("Enter");

		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{
				method: "POST",
				body: {
					text: [
						"Thanks",
						"",
						"> **Which pages need it?**",
						"",
						"- (a) Todos",
						"- (b) Tasks",
						"",
						"> **How should a stale todo be shown?**",
						"",
						"- (b) A badge",
						"",
						"> **Ready to merge?**",
						"",
						"soon",
					].join("\n"),
				},
			},
		]);
	});

	it("scrolls the card to its top as it arrives, clear of the person's message", async () => {
		const scrolled: Element[] = [];
		// scry-ignore fakes-over-mocks: happy-dom lays nothing out, so where the card scrolls has to be spied
		const scroll = spyOn(
			HTMLElement.prototype,
			"scrollIntoView",
		).mockImplementation(function (this: HTMLElement) {
			scrolled.push(this);
		});
		try {
			const view = await testing.openConversations([asking()]);
			const first = await waitFor(() =>
				within(card(view, "1")).getByRole("button", { name: /Todos/ }),
			);
			await waitFor(() => expect(document.activeElement === first).toBe(true));
			const asked = view.getByRole("region", { name: "escalated header" });
			// The thread keeps to it as it places itself.
			expect(new Set(scrolled)).toEqual(new Set([asked]));
			expect(asked.style.scrollMarginTop).toMatch(/^\d+(\.\d+)?px$/);
		} finally {
			scroll.mockRestore();
		}
	});

	it("scrolls the whole next question into view on Enter, clear of the composer", async () => {
		const view = await testing.openConversations([asking()]);
		const first = await waitFor(() =>
			within(card(view, "1")).getByRole("button", { name: /Todos/ }),
		);
		await waitFor(() => expect(document.activeElement === first).toBe(true));
		const scrolled: Element[] = [];
		// scry-ignore fakes-over-mocks: happy-dom lays nothing out, so where the card scrolls has to be spied
		const scroll = spyOn(
			HTMLElement.prototype,
			"scrollIntoView",
		).mockImplementation(function (this: HTMLElement) {
			scrolled.push(this);
		});
		try {
			await act(async () => fireEvent.keyDown(first, { key: "Enter" }));
			await act(async () =>
				fireEvent.keyDown(document.activeElement as Element, {
					key: "Enter",
				}),
			);
		} finally {
			scroll.mockRestore();
		}

		expect(scrolled).toEqual([card(view, "2"), card(view, "3")]);
		const thread = view.container.ownerDocument.querySelector(
			'[data-slot="aui_thread-viewport"]',
		) as HTMLElement;
		expect(thread.style.scrollPaddingBottom).toMatch(/^\d+px$/);
	});

	it("sends with ⌘Enter from any question", async () => {
		const view = await testing.openConversations([asking()]);
		const note = await waitFor(
			() => within(card(view, "3")).getByRole("textbox") as HTMLTextAreaElement,
		);
		await act(async () =>
			fireEvent.change(note, { target: { value: "after a check" } }),
		);
		await act(async () =>
			fireEvent.keyDown(note, { key: "Enter", metaKey: true }),
		);

		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{
				method: "POST",
				body: { text: "> **Ready to merge?**\n\nafter a check" },
			},
		]);
	});

	it("keeps a note that starts like a choice as typed, picking nothing", async () => {
		const view = await testing.openConversations([asking()]);
		const second = await waitFor(() => card(view, "2"));
		const note = within(second).getByRole("textbox") as HTMLTextAreaElement;

		// scry-ignore matchers-over-test-logic: each step types on from the last, checked as typed
		for (const typed of ["a", "a ", "a lot"]) {
			await act(async () =>
				fireEvent.change(note, { target: { value: typed } }),
			);
			expect(note.value).toBe(typed);
		}
		expect(
			within(second)
				.getByRole("button", { name: /A muted card/ })
				.getAttribute("aria-pressed"),
		).toBe("false");
	});

	it("labels how each question picks, and marks the agent's pick", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Header",
				messages: [
					message("user", "fix the header"),
					message(
						"agent",
						[
							"1. How should a stale todo be shown?",
							"   - (a) A muted card (chosen)",
							"   - (b) A badge",
						].join("\n"),
					),
				],
			}),
		]);
		const first = await waitFor(() => card(view, "1"));

		expect(within(first).getByText("Pick one")).toBeTruthy();
		expect(
			within(first).getByRole("button", { name: /A muted card/ }).textContent,
		).toContain("Recommended");
		expect(within(first).queryByText(/\(chosen\)/)).toBeNull();
		expect(
			within(card(view, "1")).queryByText("Select all that apply"),
		).toBeNull();
	});

	it("puts an order question's choices in order by its buttons and Alt with the arrows, sending the letters", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Settings",
				messages: [
					message("user", "add settings pages"),
					message(
						"agent",
						[
							"1. In what order should the pages land?",
							"   - a. Profile",
							"   - b. Billing",
							"   - c. Notifications",
						].join("\n"),
					),
				],
			}),
		]);
		const first = await waitFor(() => card(view, "1"));
		const order = () =>
			within(first)
				.getAllByRole("listitem")
				.map(
					(row) => row.textContent?.match(/Profile|Billing|Notifications/)?.[0],
				);

		expect(
			within(first).getByText("Put in order, first at the top"),
		).toBeTruthy();
		await act(async () =>
			fireEvent.click(within(first).getByRole("button", { name: "Move c up" })),
		);
		expect(order()).toEqual(["Profile", "Notifications", "Billing"]);
		const top = within(first).getAllByRole("listitem")[0] as HTMLElement;
		await act(async () => top.focus());
		await act(async () =>
			fireEvent.keyDown(top, { key: "ArrowDown", altKey: true }),
		);
		expect(order()).toEqual(["Notifications", "Profile", "Billing"]);
		await act(async () =>
			fireEvent.keyDown(top, { key: "Enter", metaKey: true }),
		);

		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{
				method: "POST",
				body: {
					text: [
						"> **In what order should the pages land?**",
						"",
						"1. (c) Notifications",
						"2. (a) Profile",
						"3. (b) Billing",
					].join("\n"),
				},
			},
		]);
	});

	it("answers an order question with the order as it stands", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Settings",
				messages: [
					message("user", "add settings pages"),
					message(
						"agent",
						"1. In what order?\n   - a. Profile\n   - b. Billing",
					),
				],
			}),
		]);
		const first = await waitFor(() => card(view, "1"));
		await act(async () =>
			fireEvent.click(
				within(first).getByRole("button", { name: "Keep this order" }),
			),
		);

		expect(
			within(first).getByRole("button", { name: "Clear order" }),
		).toBeTruthy();
		expect(view.getByText("1 of 1 answered")).toBeTruthy();
	});

	it("folds questions once replied to, opening on the answers sent, never asking them again", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Header",
				messages: [
					message("user", "fix the header"),
					message("agent", report),
					message("user", "1. a, b\n2. b: only on phones\n\nAlso the footer."),
					message("agent", "Done."),
				],
			}),
		]);
		const panel = await waitFor(() =>
			view.getByRole("region", { name: "escalated header" }),
		);
		const fold = within(panel).getByRole("button", {
			name: /Escalated/,
		});
		expect(fold.getAttribute("aria-expanded")).toBe("false");
		expect(fold.textContent).toContain("2 of 3 answered");
		expect(view.queryByRole("list", { name: "questions" })).toBeNull();

		await act(async () => fireEvent.click(fold));

		const second = within(panel).getByRole("listitem", {
			name: "question 2",
		});
		const badge = within(second).getByRole("button", {
			name: /A badge/,
		}) as HTMLButtonElement;
		expect(badge.getAttribute("aria-pressed")).toBe("true");
		expect(badge.disabled).toBe(true);
		expect(within(second).getByText("only on phones")).toBeTruthy();
		expect(within(panel).queryByRole("textbox")).toBeNull();
		expect(within(panel).getByText("Also the footer.")).toBeTruthy();
		expect(textIn(box(view))).toBe("");
	});

	it("waits for the agent to finish writing before showing cards", async () => {
		const view = await testing.openConversations([asking("running")]);
		await waitFor(() =>
			expect(view.getByText(/The header wraps now/)).toBeTruthy(),
		);
		expect(view.queryByRole("list", { name: "questions" })).toBeNull();

		await testing.say(asking("idle"));

		await waitFor(() =>
			expect(view.getByRole("list", { name: "questions" })).toBeTruthy(),
		);
	});
});
