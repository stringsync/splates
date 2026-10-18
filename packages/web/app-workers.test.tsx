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

	it("shows where the rollout stands with each worker waiting on an update", async () => {
		const view = await openWorkers({
			...pool([
				worker("made", { build: "0.9.0", kind: "provisioned", tasks: ["a"] }),
				worker("box", { build: "0.9.0" }),
				worker("den", { build: "0.9.0" }),
				worker("old", { build: "0.8.0" }),
			]),
			rollout: {
				updating: { id: "made", stage: "moving", agents: 1 },
				next: ["box", "den"],
				byHand: ["old"],
			},
		});

		const lines = within(
			view.getByRole("list", { name: "waiting on an update" }),
		)
			.getAllByRole("listitem")
			.map((line) => line.textContent);
		expect(lines).toEqual([
			"made runs 0.9.0, moving its agent off it",
			"box runs 0.9.0, next",
			"den runs 0.9.0, waiting its turn",
			"old runs 0.8.0, update it by hand",
		]);
	});

	it("shows each worker as `splates worker list` does, and which waits on an update", async () => {
		const view = await openWorkers(
			pool([
				worker("local", { kind: "local", tasks: ["fix-login"] }),
				worker("box", { build: "0.9.0", draining: true }),
			]),
		);

		const box = view.getByRole("listitem", { name: "worker box" });
		expect(box.textContent).toContain("linux");
		expect(box.textContent).toContain("0/4");
		expect(box.textContent).toContain("draining");
		expect(box.textContent).toContain("update waiting");
		expect(
			view.getByRole("list", { name: "waiting on an update" }).textContent,
		).toBe("box runs 0.9.0");
		expect(view.getByText(/This server runs 1\.0\.0/).textContent).toBe(
			"This server runs 1.0.0, and 1 of 2 workers do. They update one at a time.",
		);
		expect(
			view.getByRole("listitem", { name: "worker local" }).textContent,
		).toContain("fix-login");
	});

	it("shows a worker under WSL as linux (wsl2)", async () => {
		const view = await openWorkers(pool([worker("home", { host: "wsl2" })]));

		expect(
			view.getByRole("listitem", { name: "worker home" }).textContent,
		).toContain("linux (wsl2)");
	});

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
		const mac = within(view.getByRole("region", { name: "this mac" }));
		expect(
			mac
				.getByRole("switch", { name: "Runs agents" })
				.getAttribute("aria-checked"),
		).toBe("true");
		expect(mac.getByText("A worker")).toBeDefined();
		expect(mac.getByText(/Updating: temporarily/)).toBeDefined();
		expect(mac.getByRole("spinbutton").getAttribute("value")).toBe("7");
	});

	it("turns this Mac off as a worker at once, by removing its worker", async () => {
		const view = await openWorkers(pool([worker("local", { kind: "local" })]));
		const mac = view.getByRole("region", { name: "this mac" });
		testing.holdWrites();

		await act(async () =>
			fireEvent.click(within(mac).getByRole("switch", { name: "Runs agents" })),
		);

		expect(mac.textContent).toContain("Not a worker");
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
		const mac = view.getByRole("region", { name: "this mac" });
		testing.holdWrites();

		await act(async () =>
			fireEvent.click(within(mac).getByRole("switch", { name: "Runs agents" })),
		);

		expect(mac.textContent).toContain("the one here runs to its end");
		await act(async () => testing.release());
	});

	it("turns this Mac back on as a worker at once, adding its worker back", async () => {
		const view = await openWorkers(pool([]));
		const mac = view.getByRole("region", { name: "this mac" });
		testing.holdWrites();

		await act(async () =>
			fireEvent.click(within(mac).getByRole("switch", { name: "Runs agents" })),
		);

		expect(mac.textContent).toContain("A worker");
		expect(testing.posts.at(-1)).toMatchObject({
			path: "/api/workers/local",
			method: "PUT",
			body: JSON.stringify({ draining: false }),
		});
		await act(async () => testing.release());
	});

	it("goes back and says why when turning this Mac off is refused", async () => {
		const view = await openWorkers(pool([worker("local", { kind: "local" })]));
		const mac = view.getByRole("region", { name: "this mac" });
		testing.refuseWrites = { reason: "usage", message: "no such worker" };

		await act(async () =>
			fireEvent.click(within(mac).getByRole("switch", { name: "Runs agents" })),
		);

		await waitFor(() =>
			expect(within(mac).getByRole("alert").textContent).toBe(
				"Not turned off: no such worker",
			),
		);
		expect(mac.textContent).toContain("A worker");
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

	it("drains a worker, and removes one with agents on it once they end", async () => {
		const view = await openWorkers(
			pool([worker("box", { slots: { used: 1, total: 4 }, tasks: ["a"] })]),
		);
		const box = view.getByRole("listitem", { name: "worker box" });
		testing.holdWrites();

		await act(async () =>
			fireEvent.click(within(box).getByRole("button", { name: "Drain" })),
		);
		expect(within(box).getByRole("button", { name: "Resume" })).toBeTruthy();
		await act(async () =>
			fireEvent.click(within(box).getByRole("button", { name: "Remove" })),
		);

		expect(box.textContent).toContain("removing");
		expect(testing.posts.map(({ path, method }) => [path, method])).toEqual([
			["/api/workers/box", "PUT"],
			["/api/workers/box", "DELETE"],
		]);
		await act(async () =>
			fireEvent.click(within(box).getByRole("button", { name: "Remove now" })),
		);
		expect(testing.posts.at(-1)).toMatchObject({
			path: "/api/workers/box?force",
			method: "DELETE",
		});
		expect(view.queryByRole("listitem", { name: "worker box" })).toBeNull();
		await act(async () => testing.release());
	});

	it("wakes a worker asleep at home, showing it waking at once", async () => {
		const view = await openWorkers(
			pool([worker("pc", { health: "asleep", host: "wsl2" }), worker("box")]),
		);
		const pc = view.getByRole("listitem", { name: "worker pc" });
		const box = view.getByRole("listitem", { name: "worker box" });
		testing.holdWrites();

		expect(within(box).queryByRole("button", { name: "Wake" })).toBeNull();
		await act(async () =>
			fireEvent.click(within(pc).getByRole("button", { name: "Wake" })),
		);

		expect(pc.textContent).toContain("waking");
		expect(within(pc).queryByRole("button", { name: "Wake" })).toBeNull();
		expect(testing.posts.at(-1)).toMatchObject({
			path: "/api/workers/pc/wake",
			method: "POST",
		});
		await act(async () => testing.release());
	});

	it("names the keys each worker holds, and links an empty cell to the Creds page", async () => {
		testing.workerKeys = {
			keys: [],
			providers: [
				{
					id: "anthropic",
					name: "Anthropic",
					env: "ANTHROPIC_API_KEY",
					agents: ["claude"],
					keys: "https://platform.claude.com/settings/keys",
					limits: "https://platform.claude.com/settings/workspaces",
					scope: "workspace",
					proxy: {
						upstream: "https://api.anthropic.com",
						header: "x-api-key",
						base: "ANTHROPIC_BASE_URL",
					},
				},
			],
			holders: { workers: ["box", "bare"], types: [] },
		};
		const view = await openWorkers(
			pool([
				worker("local", { kind: "local" }),
				worker("box", { keys: ["anthropic", "mystery"] }),
				worker("bare"),
			]),
		);

		await waitFor(() =>
			expect(
				view.getByRole("listitem", { name: "worker box" }).textContent,
			).toContain("Anthropic, mystery"),
		);
		expect(
			view.getByRole("listitem", { name: "worker local" }).textContent,
		).toContain("signs in as you");
		await act(async () =>
			fireEvent.click(
				within(view.getByRole("listitem", { name: "worker bare" })).getByRole(
					"button",
					{ name: "none: add one" },
				),
			),
		);
		expect(view.getByRole("region", { name: "creds" })).toBeTruthy();
	});

	it("gives a join command to copy for another machine", async () => {
		const view = await openWorkers(pool([worker("local", { kind: "local" })]));
		testing.reply = { token: "t0ken", expiresAt: Date.now() + 900_000 };

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Add a worker" })),
		);

		await waitFor(() =>
			expect(
				view.getByRole("region", { name: "join command" }).textContent,
			).toContain(
				`splates worker run --coordinator ${location.origin} --join t0ken`,
			),
		);
		expect(
			view.getByRole("region", { name: "windows join command" }).textContent,
		).toContain(
			`stringsync/splates/v1.0.0/windows/install-worker.ps1))) -Coordinator '${location.origin}' -Join 't0ken' -Version '1.0.0'`,
		);
		expect(testing.posts.at(-1)).toMatchObject({
			path: "/api/workers/invite",
			method: "POST",
		});
	});
});

/** A pool of `workers`, its server on 1.0.0. */
function pool(workers: WorkerListing[]): WorkerPool {
	return {
		workers,
		refused: [],
		build: "1.0.0",
		rollout: { updating: null, next: [], byHand: [] },
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
		lastHeard: null,
		wokenAt: null,
		tasks: [],
		dollarsPerHour: 0,
		keys: [],
		...overrides,
	};
}
