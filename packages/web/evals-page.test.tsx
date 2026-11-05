import { afterEach, expect, it } from "bun:test";
import { conversation, message } from "@splates/server/fixtures";
import { EvalsPage } from "./evals-page";
import { act, cleanup, fireEvent, render, waitFor } from "./testing";

const realFetch = globalThis.fetch;
afterEach(() => {
	cleanup();
	globalThis.fetch = realFetch;
});

it("shows conversation totals beside linked batches and still opens reports", async () => {
	serve();
	const opened: (string | null)[] = [];
	const view = render(
		<EvalsPage
			onOpenConversation={() => {}}
			open={{ batch: null, run: null, plan: null }}
			onOpen={(id) => {
				opened.push(id);
			}}
		/>,
	);
	fireEvent.click(view.getByRole("tab", { name: "History" }));
	fireEvent.click(
		await waitFor(() => view.getByRole("button", { name: /Recent runs/ })),
	);
	const totals = view.getByText(
		"$1.25 of $10.00 · 1,200 tokens · round 2 of 3",
	);
	expect(totals).toBeTruthy();
	fireEvent.click(view.getByRole("button", { name: /1 cell/ }));
	expect(opened).toEqual(["batch"]);
});

function serve(): void {
	globalThis.fetch = (async (input) => {
		const url = String(input);
		if (url === "/api/evals") {
			return Response.json([
				{
					id: "batch",
					skill: "test",
					startedAt: "2026-11-04T12:00:00Z",
					targets: [],
					tally: { pass: 1 },
					cells: 1,
					tokens: 200,
					costUsd: 0.2,
					conversation: "loop",
					budget: {
						budget: { usd: 10, rounds: 3 },
						spentUsd: 1.25,
						tokens: 1200,
						roundsUsed: 2,
						stoppedBy: null,
					},
				},
			]);
		}
		if (url.includes("/api/evals/agents")) {
			return Response.json({ agents: [], problem: null, roster: [] });
		}
		return Response.json([]);
	}) as typeof fetch;
}

it("keeps every unarchived eval conversation in Active and preserves the planner across tabs", async () => {
	serve();
	let changed = () => {};
	const make = (id: string, archived = false, done = false) =>
		conversation({
			id,
			archived,
			name: id,
			status: "running",
			messages: [
				message("user", "[SPLATES EVAL LOOP scenario a/one]"),
				...(done ? [message("agent", "## ✅ Done: passed")] : []),
			],
		});
	const feed = {
		conversations: [
			make("running"),
			make("completed", false, true),
			make("archived", true),
		],
		events: {
			on: (_: string, callback: () => void) => {
				changed = callback;
				return () => {};
			},
		},
	} as unknown as import("./conversation-feed").ConversationFeed;
	const opened: string[] = [];
	const view = render(
		<EvalsPage
			onOpenConversation={(id) => opened.push(id)}
			open={{ batch: null, run: null, plan: null }}
			onOpen={() => {}}
			feed={feed}
		/>,
	);
	fireEvent.click(view.getByRole("tab", { name: "Active (2)" }));
	fireEvent.click(view.getByRole("button", { name: /running a\/one/ }));
	expect(opened).toEqual(["running"]);
	fireEvent.click(view.getByRole("button", { name: /completed a\/one/ }));
	expect(opened).toEqual(["running", "completed"]);
	expect(view.getByText("Completed")).toBeTruthy();
	expect(view.queryByRole("button", { name: /archived/ })).toBeNull();
	act(() => {
		feed.conversations = [
			make("running", true),
			make("completed", false, true),
		];
		changed();
	});
	expect(view.getByRole("tab", { name: "Active (1)" })).toBeTruthy();
	fireEvent.click(view.getByRole("tab", { name: "Plan" }));
	await waitFor(() =>
		expect(view.getByLabelText("Budget in dollars")).toBeTruthy(),
	);
	fireEvent.change(view.getByLabelText("Budget in dollars"), {
		target: { value: "12" },
	});
	fireEvent.click(view.getByRole("tab", { name: "Active (1)" }));
	fireEvent.click(view.getByRole("tab", { name: "Plan" }));
	expect(view.getByLabelText("Budget in dollars").getAttribute("value")).toBe(
		"12",
	);
});
