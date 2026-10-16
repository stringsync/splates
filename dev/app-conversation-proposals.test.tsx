import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	type ConversationsView,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	typeIn,
	waitFor,
	within,
} from "./testing";

describe("App's questions card under a proposal", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	/** A proposal resting on the calls `asked` lists, as a numbered list. */
	const proposing = (asked: string[]) =>
		conversation({
			title: "Header",
			messages: [
				message(
					"agent",
					[
						"## 💡 Proposed a wrapping header",
						"",
						"Let the header wrap on phones.",
						"",
						"#### It overflows at 390px.",
						"",
						"- The menu runs off the edge.",
						"",
						"1. Where should the header wrap?",
						"   - (a) Below 400px (chosen)",
						"   - (b) Below 600px",
						...asked,
					].join("\n"),
				),
			],
		});

	/** The page opened on `proposal`, and its card. */
	async function opened(
		proposal: ReturnType<typeof proposing>,
	): Promise<{ view: ConversationsView; card: HTMLElement }> {
		const view = await testing.openConversations([proposal]);
		const card = await waitFor(() =>
			view.getByRole("region", { name: "proposal a wrapping header" }),
		);
		return { view, card };
	}

	it("heads the questions with the proposal, approving what it chose", async () => {
		const { card } = await opened(proposing([]));
		expect(within(card).getByText("Questions: a wrapping header")).toBeTruthy();
		expect(
			within(card).getByText("Let the header wrap on phones."),
		).toBeTruthy();
		expect(within(card).getByText("The menu runs off the edge.")).toBeTruthy();
		const chose = within(card).getByRole("button", { name: /Below 400px/ });
		expect(chose.getAttribute("aria-pressed")).toBe("true");

		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: "Approve" })),
		);

		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{ method: "POST", body: { text: "[ARBOR APPROVE]" } },
		]);
	});

	it("replies, approving nothing, once a pick differs from what it chose", async () => {
		const { card } = await opened(proposing([]));

		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: /600px/ })),
		);
		expect(within(card).queryByRole("button", { name: "Approve" })).toBeNull();
		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: "Send" })),
		);

		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{
				method: "POST",
				body: {
					text: [
						"> **Where should the header wrap?**",
						"",
						"- (b) Below 600px",
					].join("\n"),
				},
			},
		]);
	});

	it("shows its choices' reasons only once asked, picking nothing", async () => {
		const { card } = await opened(
			proposing([
				"2. How should the menu fold?",
				"   - (a) Into a sheet (chosen)",
				"     Why: a sheet keeps every item one tap away.",
				"   - (b) Into a dropdown",
				"     Why: a dropdown keeps the page in view.",
			]),
		);
		const show = within(card).getByRole("button", { name: "Show reasons" });
		expect(show.getAttribute("aria-pressed")).toBe("false");
		expect(
			within(card).queryByText("a sheet keeps every item one tap away."),
		).toBeNull();

		await act(async () => fireEvent.click(show));

		expect(
			within(card).getByText("a sheet keeps every item one tap away."),
		).toBeTruthy();
		expect(
			within(card).getByText("a dropdown keeps the page in view."),
		).toBeTruthy();
		const sheet = within(card).getByRole("button", { name: /Into a sheet/ });
		expect(sheet.getAttribute("aria-pressed")).toBe("true");
		expect(
			within(card).getAllByRole("button", {
				name: /Show reasons|Hide reasons/,
			}),
		).toHaveLength(1);
	});

	it("approves only once a call with nothing chosen is answered", async () => {
		const { card } = await opened(proposing(["2. What should the menu say?"]));
		const send = within(card).getByRole("button", { name: "Send" });
		expect(send.hasAttribute("disabled")).toBe(true);

		await typeIn(
			within(card).getByRole("textbox", { name: "Answer to 2" }),
			"More",
		);
		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: "Approve" })),
		);

		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{
				method: "POST",
				body: {
					text: [
						"[ARBOR APPROVE]",
						"",
						"> **What should the menu say?**",
						"",
						"More",
					].join("\n"),
				},
			},
		]);
	});

	it("replies, approving nothing, once anything else is written", async () => {
		const { card } = await opened(proposing([]));

		await typeIn(
			within(card).getByRole("textbox", { name: "Anything else" }),
			"Hold off on the menu",
		);
		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: "Send" })),
		);

		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{ method: "POST", body: { text: "Hold off on the menu" } },
		]);
	});
});
