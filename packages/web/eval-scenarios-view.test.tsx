import { afterEach, expect, it } from "bun:test";
import type { ConversationFeed } from "./conversation-feed";
import { EvalScenarios } from "./eval-scenarios-view";
import { cleanup, fireEvent, render, waitFor } from "./testing";

const realFetch = globalThis.fetch;
afterEach(() => {
	cleanup();
	globalThis.fetch = realFetch;
});
it("browses never-run scenarios without offering execution controls", async () => {
	globalThis.fetch = (async (input) =>
		Response.json(
			String(input).includes("scenarios")
				? [{ id: "a/one", skill: "a", about: "A requirement" }]
				: [],
		)) as typeof fetch;
	const view = render(<EvalScenarios onOpenBatch={() => {}} />);
	await waitFor(() => expect(view.getByText("never run")).toBeTruthy());
	expect(view.getByText("a/one")).toBeTruthy();
	expect(view.getByText("A requirement")).toBeTruthy();
	expect(view.queryByText("Scenario details and history")).toBeNull();
	expect(view.queryByRole("button", { name: /Plan|Run|Improve/ })).toBeNull();
});
const passingFetch = (status: "pass" | "fail") =>
	(async (input) => {
		const url = String(input);
		if (url.includes("/api/evals/run")) {
			return Response.json({
				checks: [
					{ id: "c1", about: "wrote result.txt" },
					{ id: "c2", about: "never ran merge" },
				],
			});
		}
		if (url.includes("/api/evals/batch")) {
			return Response.json({
				id: "b1",
				startedAt: "2026-01-01T00:00:00Z",
				grid: [
					{
						scenario: "a/one",
						aspect: "a",
						requirement: "A requirement",
						target: "t",
						repetition: 0,
						run: { id: "r1", status },
					},
				],
			});
		}
		if (url.includes("/api/evals/scenarios") || url.includes("scenarios")) {
			return Response.json([{ id: "a/one", skill: "a", about: "About it" }]);
		}
		return Response.json([{ id: "b1" }]);
	}) as typeof fetch;
it("folds a card whose checks all passed to its summary, open on request", async () => {
	globalThis.fetch = passingFetch("pass");
	const view = render(<EvalScenarios onOpenBatch={() => {}} />);
	const toggle = await waitFor(() =>
		view.getByRole("button", { name: "Show the checks of a/one" }),
	);
	expect(view.getByText("About it")).toBeTruthy();
	expect(view.getByText("2 checks")).toBeTruthy();
	expect(view.queryByText("wrote result.txt")).toBeNull();
	fireEvent.click(toggle);
	expect(view.getByText("wrote result.txt")).toBeTruthy();
});
it("leaves a card with a failing check open", async () => {
	globalThis.fetch = passingFetch("fail");
	const view = render(<EvalScenarios onOpenBatch={() => {}} />);
	await waitFor(() => expect(view.getByText("wrote result.txt")).toBeTruthy());
});
const feed = {
	agents: [],
	conversations: [],
	put: () => undefined,
	current: () => ({ archived: false }),
	subscribe: () => () => {},
	send: () => ({ id: "m1" }),
	answered: () => undefined,
	refused: () => undefined,
} as unknown as ConversationFeed;
const scenariosFetch = (bodies: Record<string, string[]>) =>
	(async (input, init) => {
		const url = String(input);
		if (init?.method === "POST") {
			bodies[url] = [...(bodies[url] ?? []), String(init.body ?? "")];
		}
		return Response.json(
			url === "/api/conversations/auto"
				? { id: `c${(bodies[url] ?? []).length}` }
				: url.includes("/prompt")
					? { id: "c1" }
					: url.includes("scenarios")
						? [
								{ id: "a/one", skill: "a", about: null },
								{ id: "a/two", skill: "a", about: null },
							]
						: [],
		);
	}) as typeof fetch;
it("starts a conversation with the eval loop directive and opens it", async () => {
	localStorage.clear();
	const bodies: Record<string, string[]> = {};
	globalThis.fetch = scenariosFetch(bodies);
	const view = render(<EvalScenarios onOpenBatch={() => {}} feed={feed} />);
	await waitFor(() => expect(view.getByText("a/one")).toBeTruthy());
	fireEvent.click(view.getByRole("button", { name: "Start a/one" }));
	await waitFor(() => expect(location.hash).toBe("#conversations/c1"));
	const words = JSON.parse(
		bodies["/api/conversations/auto"]?.[0] ?? "{}",
	).words;
	expect(words).toContain("eval loop");
	expect(words).toContain("a/one");
	expect(
		view.getByRole("link", { name: "Open the conversation for a/one" }),
	).toBeTruthy();
	expect(view.queryByRole("button", { name: "Start a/one" })).toBeNull();
});
it("starts a conversation per scenario in a section after asking", async () => {
	localStorage.clear();
	const bodies: Record<string, string[]> = {};
	globalThis.fetch = scenariosFetch(bodies);
	const view = render(<EvalScenarios onOpenBatch={() => {}} feed={feed} />);
	await waitFor(() => expect(view.getByText("a/one")).toBeTruthy());
	fireEvent.click(view.getByRole("button", { name: "Start all 2" }));
	await waitFor(() =>
		expect(view.getByText("Start 2 conversations?")).toBeTruthy(),
	);
	expect(bodies["/api/conversations/auto"]).toBeUndefined();
	fireEvent.click(view.getByRole("button", { name: "Start all" }));
	await waitFor(() => expect(view.getByText("All started")).toBeTruthy());
	expect(bodies["/api/conversations/auto"]?.length).toBe(2);
});
it("keeps an opened conversation until it is archived", async () => {
	localStorage.clear();
	const bodies: Record<string, string[]> = {};
	globalThis.fetch = scenariosFetch(bodies);
	let archived = false;
	let changed = () => {};
	const kept = {
		...feed,
		current: () => ({ id: "c1", archived }),
		subscribe: (fn: () => void) => {
			changed = fn;
			return () => {};
		},
	} as unknown as ConversationFeed;
	const view = render(<EvalScenarios onOpenBatch={() => {}} feed={kept} />);
	await waitFor(() => expect(view.getByText("a/one")).toBeTruthy());
	fireEvent.click(view.getByRole("button", { name: "Start a/one" }));
	await waitFor(() =>
		expect(
			view.getByRole("link", { name: "Open the conversation for a/one" }),
		).toBeTruthy(),
	);
	archived = true;
	changed();
	await waitFor(() =>
		expect(view.getByRole("button", { name: "Start a/one" })).toBeTruthy(),
	);
	localStorage.clear();
});
