import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { MachineStatus } from "./api";
import {
	act,
	cleanup,
	clickShown,
	fireEvent,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's machine stats", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("shows the Mac's CPU and memory at the top of the page menu, with no badge while it copes", async () => {
		testing.machine = reading();
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "More" })),
		);

		const stats = await waitFor(() =>
			view.getByRole("region", { name: "This Mac" }),
		);
		expect(within(stats).getByLabelText("CPU").textContent).toContain("23%");
		expect(within(stats).getByLabelText("Memory").textContent).toContain("61%");
		// No sensor to read on a Mac.
		expect(within(stats).queryByLabelText("Temp")).toBeNull();
		expect(view.queryByRole("status", { name: /busy/ })).toBeNull();
	});

	it("shows the temperature where a sensor reads one", async () => {
		testing.machine = reading({ kind: "machine", temperature: 52.4 });
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "More" })),
		);

		const stats = await waitFor(() =>
			view.getByRole("region", { name: "This machine" }),
		);
		expect(within(stats).getByLabelText("Temp").textContent).toContain("52°");
	});

	it("says the Mac is busy in the header while it is strained, with the numbers a tap away", async () => {
		testing.machine = reading({ cpu: 0.94, load: 15.1 });
		const view = await testing.open();

		const badge = await waitFor(() => view.getByText("Mac busy"));
		await act(async () => fireEvent.click(badge));

		expect(
			await waitFor(() => view.getByText(/Load 15\.1 on 16 cores/)),
		).toBeTruthy();
		expect(view.getByLabelText("CPU").textContent).toContain("94%");
	});

	it("says how many agents and queued tasks wait for a slot in the header, each agent a tap away to move up", async () => {
		const since = new Date(Date.now() - 4 * 60_000).toISOString();
		testing.machine = reading({
			queue: [
				{
					id: "c1",
					project: "/code/app",
					task: "login",
					position: 1,
					since,
					reason: "no free slot",
				},
				{
					id: "c2",
					project: "/code/site",
					task: "deploy",
					position: 2,
					since,
					reason: "needs Linux",
				},
				{
					id: "#7",
					project: "/code/app",
					task: "#7 Cache the score",
					position: 3,
					since,
					reason: "no free slot",
					queued: true,
				},
			],
		});
		const view = await testing.open();

		await clickShown(() => view.getByText("3 queued"));
		const queue = await waitFor(() =>
			view.getByRole("list", { name: "Queue" }),
		);
		expect(queue.textContent).toContain("login");
		expect(queue.textContent).toContain("app · 4m · no free slot");
		expect(queue.textContent).toContain("site · 4m · needs Linux");
		expect(
			within(queue).queryByRole("button", { name: "Move login up" }),
		).toBeNull();
		expect(queue.textContent).toContain("#7 Cache the score");
		expect(
			within(queue).queryByRole("button", {
				name: "Move #7 Cache the score up",
			}),
		).toBeNull();

		await act(async () =>
			fireEvent.click(
				within(queue).getByRole("button", { name: "Move deploy up" }),
			),
		);
		const moved = testing.posts.find((post) =>
			post.path.startsWith("/api/queue/c2/position"),
		);
		expect(moved?.method).toBe("PUT");
		expect(JSON.parse(String(moved?.body))).toEqual({ position: 1 });
	});

	it("shows no queue badge while nothing waits", async () => {
		testing.machine = reading();
		const view = await testing.open();
		await waitFor(() => view.getByRole("button", { name: "More" }));
		expect(view.queryByText(/queued$/)).toBeNull();
	});

	it("shows nothing of the machine while the server does not say", async () => {
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "More" })),
		);

		await waitFor(() => view.getByRole("menuitem", { name: "Settings" }));
		expect(view.queryByRole("region", { name: /^This / })).toBeNull();
	});
});

/** A Mac of 16 cores, coping. */
function reading(over: Partial<MachineStatus> = {}): MachineStatus {
	return {
		kind: "Mac",
		cpu: 0.23,
		memory: 0.61,
		load: 3.2,
		cores: 16,
		temperature: null,
		queue: [],
		...over,
	};
}
