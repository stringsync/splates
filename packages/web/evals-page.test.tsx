import { afterEach, expect, it } from "bun:test";
import { EvalsPage } from "./evals-page";
import { cleanup, fireEvent, render, waitFor } from "./testing";

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
			open={{ batch: null, run: null, plan: null }}
			onOpen={(id) => {
				opened.push(id);
			}}
		/>,
	);
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
