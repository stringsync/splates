import { afterEach, describe, expect, it } from "bun:test";
import type { ChainView } from "@splates/server/queue/browser";
import { ChainBanner } from "./chain-card";
import { cleanup, fireEvent, render, waitFor } from "./testing";

describe("ChainBanner", () => {
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
		const calls: string[] = [];
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			calls.push(String(input));
			return Response.json(view);
		}) as unknown as typeof fetch;
		return calls;
	};

	afterEach(() => {
		cleanup();
		globalThis.fetch = originalFetch;
	});

	it("says on the root which tasks it queued", async () => {
		serve(chain);
		const view = render(
			<ChainBanner conversation="c-root" onOpen={() => {}} />,
		);
		await waitFor(() => {
			expect(view.getByText("Queued #821 and #822")).toBeTruthy();
		});
	});

	it("says who queued a task and how many it queued, opening the parent", async () => {
		serve(chain);
		const opened: string[] = [];
		const view = render(
			<ChainBanner
				conversation="c-821"
				onOpen={(address) => opened.push(address)}
			/>,
		);
		await waitFor(() => {
			expect(view.getByText(/queued 1 more/)).toBeTruthy();
		});
		fireEvent.click(view.getByText("root-slug"));
		expect(opened).toEqual(["c-root"]);
	});

	it("opens the tree and the budget in a dialog, whose rows open", async () => {
		serve(chain);
		const opened: string[] = [];
		const view = render(
			<ChainBanner
				conversation="c-821"
				onOpen={(address) => opened.push(address)}
			/>,
		);
		fireEvent.click(await view.findByText("View"));
		await waitFor(() => {
			expect(view.getByText("of 5.0M tokens")).toBeTruthy();
		});
		expect(view.getByText("3.2M left")).toBeTruthy();
		expect(view.getByText("Connected conversations")).toBeTruthy();
		fireEvent.click(view.getByText("#825 Test the retry path"));
		expect(opened).toEqual(["queued/825"]);
	});

	it("shows nothing for a conversation in no chain", async () => {
		const calls = serve(null);
		const view = render(
			<ChainBanner conversation="c-loner" onOpen={() => {}} />,
		);
		await waitFor(() => expect(calls.length).toBeGreaterThan(0));
		expect(view.container.textContent).toBe("");
	});
});
