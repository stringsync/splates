import { afterEach, describe, expect, it } from "bun:test";
import type { ChainView } from "@splates/server/queue/browser";
import { ChainBar, ChainCard } from "./chain-card";
import { cleanup, fireEvent, render, waitFor } from "./testing";

describe("ChainCard", () => {
	const chain: ChainView = {
		name: "root-slug",
		root: { conversation: "c-root", title: "root-slug" },
		spent: 1_800_000,
		budget: 5_000_000,
		stopped: false,
		nodes: [
			{
				id: 821,
				title: "Fix flaky test",
				status: "running",
				parent: null,
				conversation: "c-821",
				tokens: 900_000,
			},
			{
				id: 825,
				title: "Test the retry path",
				status: "queued",
				parent: 821,
				conversation: null,
				tokens: 0,
			},
			{
				id: 822,
				title: "Note the setting",
				status: "held",
				parent: null,
				conversation: null,
				tokens: 0,
			},
		],
	};

	const originalFetch = globalThis.fetch;
	const serve = (view: ChainView | null) => {
		const calls: { url: string; body: unknown }[] = [];
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			calls.push({
				url: String(input),
				body: init?.body === undefined ? null : JSON.parse(String(init.body)),
			});
			return Response.json(init?.method === "POST" ? {} : view);
		}) as unknown as typeof fetch;
		return calls;
	};

	afterEach(() => {
		cleanup();
		globalThis.fetch = originalFetch;
	});

	it("draws the budget, tree and stats, opens rows and stops auto", async () => {
		const calls = serve(chain);
		const opened: string[] = [];
		const view = render(
			<ChainCard
				conversation="c-root"
				open
				onOpen={(address) => opened.push(address)}
			/>,
		);
		await waitFor(() => {
			expect(view.getByText("of 5.0M tokens")).toBeTruthy();
		});
		expect(view.getByText("3.2M left")).toBeTruthy();

		fireEvent.click(view.getByText("#821 Fix flaky test"));
		fireEvent.click(view.getByText("#825 Test the retry path"));
		expect(opened).toEqual(["c-821", "queued/825"]);

		fireEvent.click(view.getByText("Stop auto"));
		await waitFor(() => {
			expect(calls).toContainEqual({
				url: expect.stringContaining("/api/queue/agent-budget"),
				body: { conversation: "c-root", stop: true },
			});
		});
	});

	it("shows nothing for a conversation in no chain", async () => {
		const calls = serve(null);
		const view = render(
			<ChainCard conversation="c-loner" open onOpen={() => {}} />,
		);
		await waitFor(() => expect(calls.length).toBeGreaterThan(0));
		expect(view.container.textContent).toBe("");
	});

	it("shows a bar on a phone that opens the chain as a sheet", async () => {
		serve(chain);
		const view = render(<ChainBar conversation="c-root" onOpen={() => {}} />);
		const bar = await view.findByText("1.8M / 5.0M");
		fireEvent.click(bar);
		await waitFor(() => {
			expect(
				view.getByText("Tap a task to open its conversation"),
			).toBeTruthy();
		});
	});
});
