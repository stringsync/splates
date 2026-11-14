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

	it("waits for Run in a budgeted loop", async () => {
		const starts: unknown[] = [];
		serveUnstartedEval(starts);
		const view = await testing.openConversations([
			conversation({
				title: "Evals",
				messages: [
					message("user", "[SPLATES EVAL LOOP scenario decisions/ask-first]"),
					...ongoing().messages,
				],
			}),
		]);
		await waitFor(() =>
			expect(
				view.getByRole("button", { name: "Run" }).hasAttribute("disabled"),
			).toBe(false),
		);
		expect(starts).toEqual([]);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Run" })),
		);
		await waitFor(() => expect(starts).toHaveLength(1));
		expect(starts[0]).toMatchObject({
			agents: [{ agent: "claude" }],
			budget: { usd: 7 },
		});
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
		// The card folds once the server has the note.
		await testing.say(
			conversation({
				title: "Evals",
				messages: [
					...asking.messages,
					{
						...message(
							"user",
							"[SPLATES RUN DENIED]\n\n> **Anything else?**\n\nToo costly today.",
						),
						id: testing.sentId(
							"c1",
							"[SPLATES RUN DENIED]\n\n> **Anything else?**\n\nToo costly today.",
						),
					},
				],
			}),
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
		expect(view.getByLabelText("Loading evals")).toBeTruthy();
		expect(view.queryByRole("button", { name: "Run" })).toBeNull();

		await act(async () => arrive());
		await waitFor(() =>
			expect(view.getByTestId("record-cost").textContent).toContain(
				"Landed2 of 4",
			),
		);
		expect(view.getByText("Running evals")).toBeTruthy();
		expect(view.queryByText("Run splates evals")).toBeNull();
	});

	it("shows spent of budget on a started run's card", async () => {
		serveOngoingEval(Promise.resolve());
		const view = await testing.openConversations([ongoing()]);
		await waitFor(() =>
			expect(view.getByTestId("record-cost").textContent).toContain(
				"of $10.00 budget",
			),
		);
		expect(view.queryByLabelText("Max rounds")).toBeNull();
		expect(view.queryByText(/^Stopped:/)).toBeNull();
	});
});

function ongoing() {
	return conversation({
		title: "Evals",
		messages: [
			message(
				"agent",
				"## 🔐 Permission: run evals splates: the decision probes\n\nChecks the ask-first rule.\n\n- `decisions/ask-first`",
			),
		],
	});
}

function serveOngoingEval(reading: Promise<void>): void {
	const pageFetch = globalThis.fetch;
	const answer = async (body: unknown) => {
		await reading;
		return Response.json(body);
	};
	const routes = new Map<string, () => Promise<Response>>([
		[
			"/api/evals/budget",
			() =>
				answer({
					budget: { usd: 10 },
					spentUsd: 3.5,
					tokens: 1200,
				}),
		],
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

function serveUnstartedEval(starts: unknown[]): void {
	const pageFetch = globalThis.fetch;
	globalThis.fetch = (async (path: string, init?: RequestInit) => {
		const route = path.split("?")[0];
		if (route === "/api/evals/agents") {
			return Response.json({
				agents: [{ agent: "claude" }],
				problem: null,
				roster: [],
			});
		}
		if (route === "/api/evals/scenarios") {
			return Response.json([
				{ id: "decisions/ask-first", group: "decisions", about: "Ask first" },
			]);
		}
		if (route === "/api/evals/plan") {
			return Response.json({ cells: 1, usd: 1, refused: false, output: "" });
		}
		if (route === "/api/evals/budget") {
			return Response.json({
				budget: { usd: 7 },
				spentUsd: 0,
				tokens: 0,
			});
		}
		if (route === "/api/evals/launch") {
			if (init?.method === "POST") {
				starts.push(JSON.parse(init.body as string));
				return Response.json({
					id: "launch-1",
					key: "run-key",
					status: "done",
					batch: null,
					output: "",
				});
			}
			return Response.json(null);
		}
		return pageFetch(path, init);
	}) as typeof fetch;
}
