import "./testing-dom";
import { afterEach, expect, it } from "bun:test";
import { EvalsPage } from "./evals-page";
import { act, cleanup, fireEvent, render, waitFor } from "./testing";

const realFetch = globalThis.fetch;
afterEach(() => {
	cleanup();
	globalThis.fetch = realFetch;
});

it("opens on the planner, with a History row naming the runs kept", async () => {
	serve();
	const view = render(
		<EvalsPage
			open={{ batch: null, run: null, plan: null }}
			onOpen={() => {}}
		/>,
	);
	expect(view.queryByRole("link", { name: /^History/ })).toBeNull();
	const row = await view.findByRole("link", { name: /^History/ });
	expect(row.getAttribute("href")).toBe("#evals/history");
	await waitFor(() => expect(row.textContent).toContain("1 run · last"));
	expect(view.queryByRole("tab")).toBeNull();
	expect(view.queryByText(/Step 1 of 3/)).toBeNull();
});

it("shows an Eval agents row that opens the saved agents", async () => {
	serve();
	const view = render(
		<EvalsPage
			open={{ batch: null, run: null, plan: null }}
			onOpen={() => {}}
		/>,
	);
	const row = await view.findByRole("button", { name: /Eval agents/ });
	await act(async () => fireEvent.click(row));
	const dialog = await waitFor(() => view.getByRole("dialog"));
	expect(dialog.textContent).toContain("Saved eval agents");
});

it("lists past runs one line each at #evals/history and opens a run's report", async () => {
	serve();
	const opened: (string | null)[] = [];
	const view = render(
		<EvalsPage
			open={{ batch: null, run: null, plan: null, tab: "history" }}
			onOpen={(id) => {
				opened.push(id);
			}}
		/>,
	);
	const run = await waitFor(() => view.getByRole("button", { name: /1 cell/ }));
	expect(run.textContent).toContain("$0.20");
	fireEvent.click(view.getByRole("button", { name: "Failed" }));
	expect(view.getByText("No failed runs.")).toBeTruthy();
	fireEvent.click(view.getByRole("button", { name: "Passed" }));
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
				},
			]);
		}
		if (url.includes("/api/evals/scenarios")) {
			return Response.json([
				{ id: "a/one", skill: "a", group: null, about: null },
				{ id: "a/two", skill: "a", group: null, about: null },
			]);
		}
		if (url.includes("/api/evals/agents")) {
			return Response.json({ agents: [], problem: null, roster: [] });
		}
		return Response.json([]);
	}) as typeof fetch;
}

it("has no budget row: each conversation's agent asks for its own", async () => {
	serve();
	const view = render(
		<EvalsPage
			open={{ batch: null, run: null, plan: null }}
			onOpen={() => {}}
		/>,
	);
	await view.findByRole("button", { name: /Eval agents/ });

	expect(view.queryByRole("button", { name: /^Budget/ })).toBeNull();
});

it("opens an eval file on its own page, under Evals, without the History and agents rows", async () => {
	serve();
	const view = render(
		<EvalsPage
			open={{ batch: null, run: null, plan: null, file: "a" }}
			onOpen={() => {}}
		/>,
	);
	await waitFor(() =>
		expect(view.getByRole("checkbox", { name: "Select a" })).toBeTruthy(),
	);
	expect(view.getByRole("button", { name: "Evals" })).toBeTruthy();
	expect(
		view
			.getByRole("navigation", { name: "Breadcrumb" })
			.querySelector("[aria-current=page]")?.textContent,
	).toBe("a");
	expect(view.queryByRole("link", { name: /History/ })).toBeNull();
});

it("reviews the chosen specs from the pinned bar and goes back from it", async () => {
	serve();
	const feed = {
		conversations: [],
		events: { on: () => () => {} },
	} as unknown as import("./conversation-feed").ConversationFeed;
	const view = render(
		<EvalsPage
			open={{ batch: null, run: null, plan: null, file: "a" }}
			onOpen={() => {}}
			feed={feed}
		/>,
	);
	fireEvent.click(
		await waitFor(() => view.getByRole("checkbox", { name: "Select a" })),
	);
	fireEvent.click(view.getByRole("button", { name: "Review 2 specs" }));
	expect(view.getByText(/Accepting creates 1 conversation,/)).toBeTruthy();
	fireEvent.click(view.getByRole("button", { name: "Back" }));
	expect(view.getByRole("button", { name: "Review 2 specs" })).toBeTruthy();
});
