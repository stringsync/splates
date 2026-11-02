import { afterEach, expect, it } from "bun:test";
import type { ConversationFeed } from "./conversation-feed";
import { EvalActivity } from "./eval-activity";
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
	expect(view.getByText("Scenario details and history")).toBeTruthy();
	expect(view.queryByRole("button", { name: /Plan|Run|Improve/ })).toBeNull();
});
const feed = {
	agents: [],
	conversations: [],
	put: () => undefined,
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
it("links active improvement state to its owning conversation", async () => {
	globalThis.fetch = (async () =>
		Response.json([
			{
				id: "loop",
				version: 3,
				conversation: "owner",
				loop: {
					contract: { scenario: "a/one" },
					stage: { kind: "editing", round: { number: 1 } },
					rounds: [],
				},
			},
		])) as unknown as typeof fetch;
	const view = render(<EvalActivity />);
	await waitFor(() => expect(view.getByText(/Round 1/)).toBeTruthy());
	expect(view.getByRole("link").getAttribute("href")).toBe(
		"#conversations/owner",
	);
	expect(view.getAllByRole("button").length).toBe(1);
});
