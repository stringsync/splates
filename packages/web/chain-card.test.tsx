import { afterEach, describe, expect, it } from "bun:test";
import type { ChainView } from "@splates/server/queue/browser";
import type { Event } from "@splates/server/records";
import { consumeQueuedTarget, useQueuedTarget } from "./arrivals";
import { ChainBanner, ChainProvider, QueuedBar } from "./chain-card";
import { tierOf } from "./event-tier";
import { act, cleanup, fireEvent, render, waitFor, within } from "./testing";

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

	it("says who queued a task and how many it queued, opening the parent from the chain dialog", async () => {
		serve(chain);
		const opened: string[] = [];
		const view = render(
			<ChainBanner
				conversation="c-821"
				onOpen={(address) => opened.push(address)}
			/>,
		);
		await waitFor(() => {
			expect(
				view.getByText(/Queued by root-slug · queued 1 more/),
			).toBeTruthy();
		});
		fireEvent.click(view.getByRole("button", { name: /Queued by root-slug/ }));
		const dialog = await view.findByRole("dialog");
		fireEvent.click(within(dialog).getByText("root-slug"));
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

	it("targets the enqueued task in the origin conversation when opening the parent from the chain dialog", async () => {
		serve(chain);
		const opened: string[] = [];
		function TargetProbe({ conversation }: { conversation: string }) {
			const target = useQueuedTarget(conversation);
			return <output data-testid="target">{target ?? "none"}</output>;
		}
		const view = render(
			<>
				<ChainBanner
					conversation="c-821"
					onOpen={(address) => opened.push(address)}
				/>
				<TargetProbe conversation="c-root" />
			</>,
		);
		fireEvent.click(await view.findByRole("button", { name: /View/ }));
		const dialog = await view.findByRole("dialog");
		fireEvent.click(within(dialog).getByText("root-slug"));
		expect(opened).toEqual(["c-root"]);
		expect(view.getByTestId("target").textContent).toBe("821");
		act(() => consumeQueuedTarget("c-root", 821));
	});

	it("renders an inline QueuedBar as a single-line ThreadBar opening ChainDialog with arrival ring", async () => {
		serve(chain);
		const opened: string[] = [];
		const view = render(
			<ChainProvider
				conversation="c-root"
				arrivedTask={821}
				onOpen={(address) => opened.push(address)}
			>
				<QueuedBar
					tasks={[
						{ id: 821, subject: "Fix flaky test" },
						{ id: 822, subject: "Note the setting" },
					]}
				/>
			</ChainProvider>,
		);
		const bar = view.getByRole("status", { name: "queued tasks" });
		expect(bar.dataset.queuedTasks).toBe("821,822");
		expect(bar.querySelector("[data-thread-bar]")?.className).toContain(
			"ring-2",
		);
		expect(bar.textContent).toContain("Queued #821 and #822");
		const viewButton = await within(bar).findByRole("button", {
			name: /View/,
		});
		fireEvent.click(viewButton);
		const dialog = await view.findByRole("dialog");
		expect(dialog.textContent).toContain("Connected conversations");
		fireEvent.click(within(dialog).getByText("#821 Fix flaky test"));
		fireEvent.click(viewButton);
		const reopened = await view.findByRole("dialog");
		fireEvent.click(within(reopened).getByText("#822 Note the setting"));
		expect(opened).toEqual(["c-821", "queued/822"]);
	});

	it("makes successful queue add events loud and keeps refused ones quiet", () => {
		const ok = {
			id: "e1",
			at: "2026-11-26T18:00:00Z",
			action: "queue add",
			reason: null,
			task: null,
			conversation: "c-root",
			tasks: [{ id: 821, subject: "Fix flaky test" }],
		} as Event;
		const refused = { ...ok, reason: "cap" } as Event;
		expect(tierOf(ok)).toBe("loud");
		expect(tierOf(refused)).toBe("quiet");
	});
});
