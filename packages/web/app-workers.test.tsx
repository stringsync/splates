import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type {
	WorkerListing,
	WorkerPool,
} from "@stringsync/splates-server/workers";
import { act, cleanup, fireEvent, Testing, waitFor, within } from "./testing";

describe("App's workers", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const openWorkers = async (pool: WorkerPool) => {
		testing.workers = pool;
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Workers/ })),
		);
		await waitFor(() => view.getByRole("list", { name: "pool" }));
		return view;
	};

	it("keeps this Mac enabled with its slots while an update drains it", async () => {
		const view = await openWorkers(
			pool([
				worker("local", {
					kind: "local",
					draining: true,
					updating: true,
					slots: { used: 0, total: 7 },
				}),
			]),
		);
		const mac = within(view.getByRole("listitem", { name: "worker local" }));
		expect(
			mac
				.getByRole("switch", { name: "Runs agents" })
				.getAttribute("aria-checked"),
		).toBe("true");
		expect(mac.getByText(/Updating: temporarily/)).toBeDefined();
		expect(mac.getByRole("spinbutton").getAttribute("value")).toBe("7");
	});

	it("turns this Mac off as a worker at once, by removing its worker", async () => {
		const view = await openWorkers(pool([worker("local", { kind: "local" })]));
		const mac = view.getByRole("listitem", { name: "worker local" });
		testing.holdWrites();

		await act(async () =>
			fireEvent.click(within(mac).getByRole("switch", { name: "Runs agents" })),
		);

		expect(mac.textContent).toContain("it only coordinates");
		expect(testing.posts.at(-1)).toMatchObject({
			path: "/api/workers/local",
			method: "DELETE",
		});
		await act(async () => testing.release());
	});

	it("drains this Mac while its agents run to their end", async () => {
		const view = await openWorkers(
			pool([
				worker("local", {
					kind: "local",
					tasks: ["fix-login"],
					slots: { used: 1, total: 4 },
				}),
			]),
		);
		const mac = view.getByRole("listitem", { name: "worker local" });
		testing.holdWrites();

		await act(async () =>
			fireEvent.click(within(mac).getByRole("switch", { name: "Runs agents" })),
		);

		expect(mac.textContent).toContain("the one here runs to its end");
		await act(async () => testing.release());
	});

	it("turns this Mac back on as a worker at once, adding its worker back", async () => {
		const view = await openWorkers(pool([]));
		const mac = view.getByRole("listitem", { name: "worker local" });
		testing.holdWrites();

		await act(async () =>
			fireEvent.click(within(mac).getByRole("switch", { name: "Runs agents" })),
		);

		expect(mac.textContent).toContain("Takes new agents");
		expect(testing.posts.at(-1)).toMatchObject({
			path: "/api/workers/local",
			method: "PUT",
			body: JSON.stringify({ draining: false }),
		});
		await act(async () => testing.release());
	});

	it("goes back and says why when turning this Mac off is refused", async () => {
		const view = await openWorkers(pool([worker("local", { kind: "local" })]));
		const mac = view.getByRole("listitem", { name: "worker local" });
		testing.refuseWrites = { reason: "usage", message: "no such worker" };

		await act(async () =>
			fireEvent.click(within(mac).getByRole("switch", { name: "Runs agents" })),
		);

		await waitFor(() =>
			expect(within(mac).getByRole("alert").textContent).toBe(
				"Not turned off: no such worker",
			),
		);
		expect(mac.textContent).toContain("Takes new agents");
	});

	it("sets this Mac's slots", async () => {
		const view = await openWorkers(pool([worker("local", { kind: "local" })]));
		const form = view.getByRole("form", { name: "local slots" });

		fireEvent.change(within(form).getByLabelText("slots"), {
			target: { value: "6" },
		});
		await act(async () => fireEvent.submit(form));

		expect(testing.posts.at(-1)).toMatchObject({
			path: "/api/workers/local",
			method: "PUT",
			body: JSON.stringify({ slots: 6 }),
		});
	});
});

/** A pool of `workers`, its server on 1.0.0. */
function pool(workers: WorkerListing[]): WorkerPool {
	return {
		workers,
		refused: [],
		build: "1.0.0",
	};
}

/** Worker `id`, up, on the server's build, with nothing running. */
function worker(
	id: string,
	overrides: Partial<WorkerListing> = {},
): WorkerListing {
	return {
		id,
		kind: "registered",
		platform: "linux",
		host: null,
		build: "1.0.0",
		protocol: "1.0",
		slots: { used: 0, total: 4 },
		health: "connected",
		draining: false,
		removing: false,
		updating: false,
		verified: null,
		lastHeard: null,
		tasks: [],
		...overrides,
	};
}
