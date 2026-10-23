import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type {
	HeldListing,
	WorkerListing,
	WorkerPool,
} from "@stringsync/splates-server/workers";
import { act, cleanup, fireEvent, Testing, waitFor, within } from "./testing";

describe("App's queue controls", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const openQueue = async (shown: WorkerPool) => {
		testing.workers = shown;
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Queue/ })),
		);
		await waitFor(() => view.getByRole("region", { name: "queue controls" }));
		return view;
	};

	it("says how many of the slots run, counting only what takes one", async () => {
		const view = await openQueue(
			pool({
				held: [
					held("a", { capped: true, task: "groom-backlog" }),
					held("b", { capped: false, task: "mine" }),
				],
			}),
		);
		const controls = within(
			view.getByRole("region", { name: "queue controls" }),
		);
		expect(controls.getByRole("status").textContent).toBe("1 of 3 running");
		const running = within(view.getByRole("region", { name: "Running" }));
		expect(running.getByText("groom-backlog")).toBeDefined();
		expect(running.queryByText("mine")).toBeNull();
	});

	it("explains a limit lowered below what runs", async () => {
		const view = await openQueue(
			pool({
				total: 1,
				held: [held("a", { capped: true }), held("b", { capped: true })],
			}),
		);
		expect(view.getByRole("status").textContent).toBe(
			"2 running, over the limit · new ones wait until under 1",
		);
	});

	it("pauses at once, and the button turns to Resume", async () => {
		const view = await openQueue(pool({}));
		testing.holdWrites();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Pause" })),
		);

		expect(view.getByRole("button", { name: "Resume" })).toBeDefined();
		expect(view.getByRole("status").textContent).toContain("Paused");
		expect(testing.posts.at(-1)).toMatchObject({
			path: "/api/workers/local",
			method: "PUT",
			body: JSON.stringify({ paused: true }),
		});
	});

	it("resumes a worker turned off before, turning it back on", async () => {
		const view = await openQueue(pool({ draining: true }));

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Resume" })),
		);

		expect(testing.posts.at(-1)).toMatchObject({
			path: "/api/workers/local",
			method: "PUT",
			body: JSON.stringify({ paused: false, draining: false }),
		});
	});

	it("sets how many agents run at once from its stepper", async () => {
		const view = await openQueue(pool({}));

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "More at once" })),
		);

		expect(testing.posts.at(-1)).toMatchObject({
			path: "/api/workers/local",
			method: "PUT",
			body: JSON.stringify({ slots: 4 }),
		});
	});
});

/** The pool of this machine's worker, `total` slots, with `held` holding them. */
function pool({
	total = 3,
	held = [],
	paused = false,
	draining = false,
}: {
	total?: number;
	held?: HeldListing[];
	paused?: boolean;
	draining?: boolean;
}): WorkerPool {
	const local: WorkerListing = {
		id: "local",
		kind: "local",
		platform: "darwin",
		host: null,
		build: "1.0.0",
		protocol: "1.0",
		slots: { used: held.length, total },
		health: "connected",
		draining,
		removing: false,
		updating: false,
		verified: null,
		lastHeard: null,
		tasks: [],
	};
	return { workers: [local], refused: [], build: "1.0.0", paused, held };
}

/** Conversation `id` holding a slot in the project under test. */
function held(id: string, overrides: Partial<HeldListing>): HeldListing {
	return {
		id,
		project: "/repo",
		task: null,
		capped: true,
		since: new Date().toISOString(),
		...overrides,
	};
}
