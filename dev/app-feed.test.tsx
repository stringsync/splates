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

	it("says it is outdated, with what to run, when a newer arbor moved the records on", async () => {
		const view = await testing.open();

		testing.refuse(
			"outdated",
			"written by a newer arbor\nRun `bunx @webappwiz/arbor@latest` instead.",
		);
		await act(async () => testing.stream?.onmessage?.());

		const badge = await waitFor(() => view.getByText("Outdated"));
		expect(badge.textContent).toBe("Outdated");
		expect(badge.title).toContain("bunx @webappwiz/arbor@latest");
		expect(view.queryByText(/Offline/)).toBeNull();
	});

	it("grays out the tab's icon while offline, and brings it back", async () => {
		const icon = document.createElement("link");
		icon.rel = "icon";
		icon.href = "data:image/svg+xml,tree";
		document.head.append(icon);
		const view = await testing.open();

		testing.goAway();
		await act(async () => testing.stream?.onmessage?.());
		await waitFor(() => expect(icon.href).toContain("saturate"));

		view.unmount();
		expect(icon.href).toBe("data:image/svg+xml,tree");
		icon.remove();
	});
});
