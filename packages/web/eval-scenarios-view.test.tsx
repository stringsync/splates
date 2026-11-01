import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EvalScenarios } from "./eval-scenarios-view";
import { cleanup, fireEvent, render, waitFor } from "./testing";

const SCENARIOS = [
	{ id: "a/one", skill: "a", about: null },
	{ id: "a/two", skill: "a", about: null },
	{ id: "b/one", skill: "b", about: null },
];

describe("EvalScenarios", () => {
	let planned: string[][];

	const realFetch = globalThis.fetch;

	beforeEach(() => {
		planned = [];
		globalThis.fetch = (async (input: RequestInfo | URL) =>
			Response.json(
				String(input).includes("/api/evals/scenarios") ? SCENARIOS : [],
			)) as typeof fetch;
	});

	afterEach(() => {
		cleanup();
		globalThis.fetch = realFetch;
	});

	it("plans one run of every scenario ticked, across categories", async () => {
		const view = render(
			<EvalScenarios
				onPlan={(each) => planned.push(each)}
				onOpenBatch={() => {}}
			/>,
		);
		await waitFor(() => view.getByLabelText("Select a/one"));
		fireEvent.click(view.getByLabelText("Select b/one"));
		fireEvent.click(view.getByLabelText("Select all of a"));
		fireEvent.click(view.getByRole("button", { name: "Plan 3 selected" }));

		expect(planned).toEqual([["a/one", "a/two", "b/one"]]);
	});

	it("still plans a single scenario from its own button", async () => {
		const view = render(
			<EvalScenarios
				onPlan={(each) => planned.push(each)}
				onOpenBatch={() => {}}
			/>,
		);
		await waitFor(() => view.getByLabelText("Select a/one"));
		fireEvent.click(
			view.getAllByRole("button", { name: "Plan" })[1] as HTMLElement,
		);

		expect(planned).toEqual([["a/two"]]);
	});
});
