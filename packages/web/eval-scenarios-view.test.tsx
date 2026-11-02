import { afterEach, expect, it } from "bun:test";
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
it("enqueues one task for a single pick and asks first for several", async () => {
	const calls: string[] = [];
	const posted = () => calls.filter((each) => !each.startsWith("GET"));
	globalThis.fetch = (async (input, init) => {
		const url = String(input);
		calls.push(`${init?.method ?? "GET"} ${url}`);
		return Response.json(
			url.includes("/api/todos")
				? { id: 7 }
				: url.includes("scenarios")
					? [
							{ id: "a/one", skill: "a", about: null },
							{ id: "a/two", skill: "a", about: null },
						]
					: [],
		);
	}) as typeof fetch;
	const view = render(<EvalScenarios onOpenBatch={() => {}} />);
	await waitFor(() => expect(view.getByText("a/one")).toBeTruthy());
	fireEvent.click(view.getByRole("checkbox", { name: "Select a/one" }));
	fireEvent.click(view.getByRole("button", { name: "Enqueue 1 eval loop" }));
	await waitFor(() => expect(posted().length).toBe(2));
	expect(view.queryByText("Enqueue 1 eval loops?")).toBeNull();
	await waitFor(() =>
		expect(view.queryByRole("button", { name: /Enqueue/ })).toBeNull(),
	);
	fireEvent.click(view.getByRole("checkbox", { name: /Select all/ }));
	fireEvent.click(view.getByRole("button", { name: "Enqueue 2 eval loops" }));
	await waitFor(() =>
		expect(view.getByText("Enqueue 2 eval loops?")).toBeTruthy(),
	);
	expect(posted().length).toBe(2);
	fireEvent.click(view.getByRole("button", { name: "Enqueue all" }));
	await waitFor(() => expect(posted().length).toBe(6));
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
