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

describe("App's run evals card", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("rejects with Anything else, telling the agent and folding the card", async () => {
		const asking = conversation({
			title: "Evals",
			messages: [
				message(
					"agent",
					"## 🔐 Permission: run evals splates: the decision probes\n\nChecks the ask-first rule.\n\n- `decisions/ask-first`",
				),
			],
		});
		const view = await testing.openConversations([asking]);
		await typeIn(
			view.getByRole("textbox", { name: "Anything else" }),
			"Too costly today.",
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /Reject/ })),
		);
		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{
					method: "POST",
					body: {
						text: "[SPLATES RUN DENIED]\n\n> **Anything else?**\n\nToo costly today.",
					},
				},
			]),
		);
		await waitFor(() => expect(view.getByText("Evals rejected")).toBeTruthy());
	});

	it("opens an ongoing run on its progress, not the unstarted card", async () => {
		let arrive = () => {};
		const reading = new Promise<void>((resolve) => {
			arrive = resolve;
		});
		serveOngoingEval(reading);
		const asking = conversation({
			title: "Evals",
			messages: [
				message(
					"agent",
					"## 🔐 Permission: run evals splates: the decision probes\n\nChecks the ask-first rule.\n\n- `decisions/ask-first`",
				),
			],
		});

		const view = await testing.openConversations([asking]);
		expect(view.getByText("Loading evals")).toBeTruthy();
		expect(view.queryByRole("button", { name: "Run" })).toBeNull();

		await act(async () => arrive());
		await waitFor(() =>
			expect(view.getByText("2 of 4 cells landed · 2 pass")).toBeTruthy(),
		);
		expect(view.getByText("Running evals")).toBeTruthy();
		expect(view.queryByText("Run splates evals")).toBeNull();
	});
});

function serveOngoingEval(reading: Promise<void>): void {
	const pageFetch = globalThis.fetch;
	const answer = async (body: unknown) => {
		await reading;
		return Response.json(body);
	};
	const routes = new Map<string, () => Promise<Response>>([
		[
			"/api/evals/agents",
			() => answer({ agents: [], problem: null, roster: [] }),
		],
		[
			"/api/evals/scenarios",
			() =>
				answer([
					{
						id: "decisions/ask-first",
						group: "decisions",
						about: "Ask first",
					},
				]),
		],
		[
			"/api/evals/launch",
			() =>
				answer({
					id: "launch-1",
					key: "run-key",
					status: "running",
					batch: "batch-1",
					output: "",
				}),
		],
		[
			"/api/evals/batch",
			() =>
				answer({
					id: "batch-1",
					skill: "splates",
					producer: "splates",
					startedAt: "2026-10-27T00:00:00.000Z",
					targets: [],
					tally: { pass: 2, pending: 2 },
					cells: 4,
					tokens: 10,
					costUsd: 0.5,
					grid: [],
				}),
		],
	]);
	globalThis.fetch = ((path: string, init?: RequestInit) => {
		const route = path.split("?")[0] ?? "";
		return routes.get(route)?.() ?? pageFetch(path, init);
	}) as typeof fetch;
}
