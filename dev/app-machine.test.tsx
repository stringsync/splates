import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { MachineStatus } from "./api";
import { act, cleanup, fireEvent, Testing, waitFor, within } from "./testing";

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

	it("says the Mac is busy while a heavy job waits, naming what runs and what waits", async () => {
		testing.machine = reading({
			heavy: {
				cap: 2,
				running: [
					job("preMerge", "alpha", 11),
					job("wiz dev test", "beta", 12),
				],
				waiting: [job("postCheckout", "gamma", 13)],
			},
		});
		const view = await testing.open();

		await act(async () =>
			fireEvent.click(await waitFor(() => view.getByText("Mac busy"))),
		);

		const jobs = await waitFor(() =>
			view.getByRole("region", { name: "Heavy jobs" }),
		);
		expect(jobs.textContent).toContain("2 of 2");
		expect(
			within(jobs).getByRole("list", { name: "Running" }).textContent,
		).toBe("alpha · preMergebeta · wiz dev test");
		expect(
			within(jobs).getByRole("list", { name: "Waiting" }).textContent,
		).toBe("gamma · postCheckout");
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
		heavy: { cap: 2, running: [], waiting: [] },
		...over,
	};
}

/** A heavy job of `task`'s, running or waiting since ten this morning. */
function job(what: string, task: string | null, pid: number) {
	return { what, task, pid, since: "2026-10-16T10:00:00.000Z" };
}
