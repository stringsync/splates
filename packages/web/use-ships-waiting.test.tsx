import { afterEach, expect, test } from "bun:test";
import { markRecapSeen } from "./ship-recap-seen";
import { act, cleanup, render, waitFor } from "./testing-library";
import {
	useShipFailed,
	useShipRecapReady,
	useShipsRunning,
} from "./use-ships-waiting";

const realFetch = globalThis.fetch;
afterEach(() => {
	cleanup();
	globalThis.fetch = realFetch;
	localStorage.removeItem("splates.ships.recap-seen");
});

function Status() {
	const ready = useShipRecapReady();
	const running = useShipsRunning();
	return <div>{running ? "running" : ready ? "recap ready" : "idle"}</div>;
}

function Failed() {
	return <div>{useShipFailed() ? "failed" : "fine"}</div>;
}

function serve(status: string) {
	globalThis.fetch = (async (input: RequestInfo | URL) =>
		Response.json(
			(input instanceof Request ? input.url : String(input)).includes("waiting")
				? []
				: { runs: [{ id: "latest", status }] },
		)) as typeof fetch;
}

test("successful ship marks its recap until opened", async () => {
	serve("done");
	const view = render(<Status />);
	await waitFor(() => expect(view.getByText("recap ready")).toBeTruthy());
	act(() => markRecapSeen("latest"));
	await waitFor(() => expect(view.getByText("idle")).toBeTruthy());
});

test("failed ship has no successful recap marker", async () => {
	serve("failed");
	const view = render(<Status />);
	await waitFor(() => expect(view.getByText("idle")).toBeTruthy());
});

test("a ship that stopped on a failure is flagged failed", async () => {
	serve("failed");
	const view = render(<Failed />);
	await waitFor(() => expect(view.getByText("failed")).toBeTruthy());
});

test("stopped ship has no successful recap marker", async () => {
	serve("stopped");
	const view = render(<Status />);
	await waitFor(() => expect(view.getByText("idle")).toBeTruthy());
});

test("shows the running status while a ship runs", async () => {
	serve("running");
	const view = render(<Status />);
	await waitFor(() => expect(view.getByText("running")).toBeTruthy());
});
