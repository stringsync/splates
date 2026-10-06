import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, cleanup, snapshot, Testing, todo, waitFor } from "./testing";

describe("App's feed", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("refetches when the server says something moved", async () => {
		const view = await testing.open();

		testing.served = snapshot({
			todos: [todo({ subject: "new one" })],
		});
		await act(async () => testing.stream?.onmessage?.());

		await waitFor(() => expect(view.getByText(/new one/)).toBeTruthy());
	});

	it("says it is offline when the server goes away", async () => {
		const view = await testing.open();
		expect(view.queryByText(/Offline/)).toBeNull();

		testing.goAway();
		await act(async () => testing.stream?.onmessage?.());

		await waitFor(() => expect(view.getByText(/Offline/)).toBeTruthy());
	});
});
