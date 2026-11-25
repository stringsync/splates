import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	typeIn,
	waitFor,
} from "./testing";

describe("App's eval budget card", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("approves the amount it asks, recording it before telling the agent what is left", async () => {
		const answers = serveBudget({ usd: 0, spent: 0 });
		const view = await testing.openConversations([asking("Asks: $10")]);
		const approve = await view.findByRole("button", { name: "Approve $10" });
		expect(view.getByText("Eval budget")).toBeTruthy();
		expect(view.getByText("up to $2.40")).toBeTruthy();
		expect(view.getByText("about 4 rounds")).toBeTruthy();

		await act(async () => fireEvent.click(approve));

		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{
					method: "POST",
					body: {
						text: "[SPLATES EVAL BUDGET APPROVED]\n\nAdded $10.00: $10.00 of $10.00 left.",
					},
				},
			]),
		);
		expect(answers).toMatchObject([{ conversation: "c1", usd: 10 }]);
		// Answered, it folds to what is spent of the budget.
		await waitFor(() =>
			expect(view.getByText("Eval budget approved · $10")).toBeTruthy(),
		);
		expect(view.getByText("$0 of $10 spent")).toBeTruthy();
		expect(view.queryByRole("button", { name: /Approve/ })).toBeNull();
	});

	it("approves a picked or custom amount instead of the one asked", async () => {
		const answers = serveBudget({ usd: 0, spent: 0 });
		const view = await testing.openConversations([asking("Asks: $10")]);
		await act(async () =>
			fireEvent.click(await view.findByRole("button", { name: "$20" })),
		);
		expect(view.getByRole("button", { name: "Approve $20" })).toBeTruthy();
		await act(async () =>
			fireEvent.change(
				view.getByRole("textbox", { name: "Custom amount in dollars" }),
				{ target: { value: "7.5" } },
			),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Approve $7.50" })),
		);

		await waitFor(() => expect(answers).toMatchObject([{ usd: 7.5 }]));
	});

	it("declines with Anything else, recording no amount", async () => {
		const answers = serveBudget({ usd: 0, spent: 0 });
		const view = await testing.openConversations([asking("Asks: $10")]);
		await typeIn(
			await view.findByRole("textbox", { name: "Anything else" }),
			"Out of quota until Monday.",
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /Decline/ })),
		);

		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{
					method: "POST",
					body: {
						text: "[SPLATES EVAL BUDGET DECLINED]\n\n> **Anything else?**\n\nOut of quota until Monday.",
					},
				},
			]),
		);
		expect(answers).toMatchObject([{ usd: null }]);
	});

	it("asks for more on top of a budget running short, showing what is spent", async () => {
		serveBudget({ usd: 10, spent: 9.2 });
		const view = await testing.openConversations([asking("Asks: +$5")]);

		await waitFor(() =>
			expect(view.getByText("More eval budget")).toBeTruthy(),
		);
		expect(view.getByRole("button", { name: "Add $5" })).toBeTruthy();
		expect(view.getByText("$0.80 left")).toBeTruthy();
	});
});

function asking(asks: string) {
	return conversation({
		title: "Evals",
		messages: [
			message(
				"agent",
				`## 🔐 Permission: eval budget: the asking specs\n\nTwo asking specs fail on codex.\n\n${asks}\nRound: up to $2.40`,
			),
		],
	});
}

/**
 * Serves `/api/evals/budget` as `budget` stands, adding what the card
 * approves. Answers the bodies the card posted.
 */
function serveBudget(budget: {
	usd: number;
	spent: number;
}): Record<string, unknown>[] {
	const pageFetch = globalThis.fetch;
	const posted: Record<string, unknown>[] = [];
	const answers: Record<string, number | null> = {};
	globalThis.fetch = (async (path: string, init?: RequestInit) => {
		const route = path.split("?")[0];
		if (route !== "/api/evals/budget") {
			return pageFetch(path, init);
		}
		if (init?.method === "POST") {
			const sent = JSON.parse(String(init.body)) as {
				card: string;
				usd: number | null;
			};
			posted.push(sent);
			answers[sent.card] = sent.usd;
			budget.usd += sent.usd ?? 0;
		}
		return Response.json({ ...budget, answers });
	}) as typeof fetch;
	return posted;
}
