import { afterEach, beforeEach, expect, it } from "bun:test";
import type { Cascade } from "@splates/server/ship";
import type { MachineStatus } from "./api";
import { act, cleanup, fireEvent, Testing, waitFor } from "./testing";

let testing: Testing;
beforeEach(() => {
	(
		window as unknown as { happyDOM: { setURL(url: string): void } }
	).happyDOM.setURL("http://localhost/");
	localStorage.clear();
	testing = new Testing();
});
afterEach(() => {
	cleanup();
	testing.dispose();
	history.replaceState(null, "", "/");
});

const cascade = (status: Cascade["status"], seen = false): Cascade => ({
	id: "c1",
	from: "example",
	status,
	started: "2026-10-29T12:00:00Z",
	ended: null,
	seen,
	steps: [],
});

function machine(running: Cascade | null): MachineStatus {
	return {
		kind: "Mac",
		cpu: 0.2,
		memory: 0.5,
		load: 1,
		cores: 8,
		temperature: null,
		splates: null,
		queue: [],
		ship: { cascade: running, ship: null },
	} as unknown as MachineStatus;
}

async function clickShip(running: Cascade | null) {
	testing.machine = machine(running);
	const view = testing.render({});
	// Lets the machine reading arrive.
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 50));
	});
	await act(async () =>
		fireEvent.click(view.getByRole("tab", { name: /Ship$/ })),
	);
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 20));
	});
}

it("opens the active ship from the Ship tab while a ship runs", async () => {
	await clickShip(cascade("running"));
	await waitFor(() => expect(location.hash).toBe("#ships/active"));
});

it("opens the results of a finished ship not yet seen", async () => {
	await clickShip(cascade("done"));
	await waitFor(() => expect(location.hash).toBe("#ships/active"));
});

it("opens the planner once the results were seen", async () => {
	await clickShip(cascade("done", true));
	expect(location.hash).toBe("#ships");
});
