import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	message,
	Testing,
	typeIn,
	waitFor,
	within,
} from "./testing";

describe("App's cards for the calls a reply says it assumed", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	/** The uploads task, whose plan writes the calls its agent made. */
	const uploads = {
		tasks: [
			details({
				task: "uploads",
				plan: [
					"# uploads",
					"",
					"## Assumptions",
					"",
					"- [ ] 3. What should the retry limit be?",
					"  - (a) Three tries, a second apart (chosen)",
					"  - (b) Five tries, backing off",
				].join("\n"),
			}),
		],
	};

	/** A conversation on the uploads task whose agent replied `lines`. */
	const replying = (lines: string[]) =>
		conversation({
			task: "uploads",
			lastTask: "uploads",
			messages: [message("agent", lines.join("\n"))],
		});

	/** The page open on that conversation, and its card of the calls assumed. */
	const assumedCard = async (lines: string[]) => {
		const view = await testing.openConversations(
			[replying(lines)],
			"c1",
			uploads,
		);
		const card = await waitFor(() =>
			view.getByRole("region", { name: "assumed" }),
		);
		return { view, card };
	};

	it("lists the calls as its plan writes them, offering Send only once one is challenged", async () => {
		const { view, card } = await assumedCard([
			"Uploads stop on a 413 now.",
			"",
			"- Assumed 3: Three tries, a second apart",
		]);
		const list = within(card).getByRole("region", { name: "Assumptions" });
		// The card's title says them, so the list folds under none of its own.
		expect(
			within(card).queryByRole("button", { name: /^Assumptions/ }),
		).toBeNull();
		expect(
			within(list).getByText("What should the retry limit be?"),
		).toBeTruthy();
		expect(within(list).getByText("Three tries, a second apart")).toBeTruthy();
		expect(within(card).queryByRole("button", { name: "Send" })).toBeNull();
		expect(view.getByText("Uploads stop on a 413 now.")).toBeTruthy();

		await act(async () =>
			fireEvent.click(
				within(list).getByRole("button", { name: "Challenge assumption 3" }),
			),
		);
		await act(async () =>
			fireEvent.click(
				within(list).getByRole("button", { name: /Five tries, backing off/ }),
			),
		);
		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: "Send" })),
		);

		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{
				method: "POST",
				body: {
					text: [
						"> **What should the retry limit be?**",
						"",
						"- (b) Five tries, backing off",
					].join("\n"),
				},
			},
		]);
	});

	it("lists the calls by number, each under the exhibit it shows", async () => {
		const { card } = await assumedCard([
			"- Assumed 9: Named it `MAX_RETRIES`",
			"",
			"### 🖼️ The retry limit",
			"",
			"![retry limit](/abs/limit.png)",
			"",
			"- Assumed 3: Three tries, a second apart",
		]);
		const exhibit = within(card).getByRole("figure", {
			name: "exhibit for assumption 3",
		});
		expect(exhibit.textContent).toContain("retry limit");
		expect(
			within(exhibit).getByText("What should the retry limit be?"),
		).toBeTruthy();
		expect(
			within(exhibit).getByRole("button", { name: "Challenge assumption 3" }),
		).toBeTruthy();
		expect(
			within(card)
				.getAllByRole("button", { name: /^Challenge assumption/ })
				.map((each) => each.getAttribute("aria-label")),
		).toEqual(["Challenge assumption 3", "Challenge assumption 9"]);
		expect(within(exhibit).queryByText(/MAX_RETRIES/)).toBeNull();
	});

	it("lists them in the questions card they come before, a challenge going with the answers", async () => {
		const view = await testing.openConversations(
			[
				replying([
					"- Assumed 3: Three tries, a second apart",
					"",
					"1. Should a 429 retry?",
				]),
			],
			"c1",
			uploads,
		);
		const card = await waitFor(() =>
			view.getByRole("region", { name: "questions for you" }),
		);
		expect(view.queryByRole("region", { name: "assumed" })).toBeNull();
		// Only what it asks counts toward what is answered.
		expect(card.textContent).toContain("0 of 1 answered");
		await typeIn(
			within(card).getByRole("textbox", { name: "Answer to 1" }),
			"Yes, once",
		);
		const list = within(card).getByRole("region", { name: "Assumptions" });
		await act(async () =>
			fireEvent.click(
				within(list).getByRole("button", { name: "Assumptions 1" }),
			),
		);
		await act(async () =>
			fireEvent.click(
				within(list).getByRole("button", { name: "Challenge assumption 3" }),
			),
		);
		await act(async () =>
			fireEvent.click(
				within(list).getByRole("button", { name: /Five tries, backing off/ }),
			),
		);
		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: "Send" })),
		);

		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{
				method: "POST",
				body: {
					text: [
						"> **Should a 429 retry?**",
						"",
						"Yes, once",
						"",
						"> **What should the retry limit be?**",
						"",
						"- (b) Five tries, backing off",
					].join("\n"),
				},
			},
		]);
	});

	it("challenges a call its plan has no item for in words, quoting its line", async () => {
		const { card } = await assumedCard(["- Assumed 7: Named it `MAX_RETRIES`"]);
		await act(async () =>
			fireEvent.click(
				within(card).getByRole("button", { name: "Challenge assumption 7" }),
			),
		);
		await typeIn(
			within(card).getByRole("textbox", { name: "Answer to 7" }),
			"Call it RETRY_LIMIT",
		);
		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: "Send" })),
		);

		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{
				method: "POST",
				body: {
					text: [
						"> **Named it `MAX_RETRIES`**",
						"",
						"Call it RETRY_LIMIT",
					].join("\n"),
				},
			},
		]);
	});

	it("heads the calls with the escalation they end, rather than drawing it apart", async () => {
		const view = await testing.openConversations(
			[
				replying([
					"## ⚠️ Escalated uploads: needs access to the bucket",
					"",
					"Uploads stop on a 413 now.",
					"",
					"- Assumed 3: Three tries, a second apart",
				]),
			],
			"c1",
			uploads,
		);
		const card = await waitFor(() =>
			view.getByRole("region", { name: "escalated uploads" }),
		);

		expect(within(card).getByText("Uploads stop on a 413 now.")).toBeTruthy();
		expect(
			within(card).getByRole("region", { name: "Assumptions" }),
		).toBeTruthy();
		expect(
			view.getAllByRole("region", { name: "escalated uploads" }),
		).toHaveLength(1);
	});
});
