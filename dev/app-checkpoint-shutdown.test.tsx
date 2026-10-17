import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	live,
	menuItem,
	project,
	Testing,
	waitFor,
	within,
} from "./testing";

/** The step a run is on, as its line marks it. */
function current(dialog: HTMLElement): string | null {
	return (
		within(dialog).queryByRole("listitem", { current: "step" })?.textContent ??
		null
	);
}

/** Every step of a run, in order. */
function steps(dialog: HTMLElement): string[] {
	return within(dialog)
		.getAllByRole("listitem")
		.map((each) => each.textContent ?? "");
}

describe("App's shutdown confirmation", () => {
	let testing: Testing;
	let view: Awaited<ReturnType<Testing["openConversations"]>>;
	let dialog: HTMLElement;

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	beforeEach(async () => {
		testing = new Testing();
		testing.projects = [project("webappwiz", [live("c1", "One")], true)];
		view = await testing.openConversations(
			[conversation({ id: "c1", status: "running" })],
			null,
		);
		await act(async () => fireEvent.click(await menuItem(view, "Power")));
		dialog = await waitFor(() => view.getByRole("dialog", { name: "Power" }));
	});

	it("checkpoints and shuts down, saying so once arbor dev has gone", async () => {
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "Shut down" }),
			),
		);
		const confirmation = await waitFor(() =>
			view.getByRole("dialog", { name: "Shut down arbor dev?" }),
		);
		expect(testing.posted("/api/power")).toEqual([]);
		expect(testing.posted("/api/checkpoint")).toEqual([]);
		testing.projects = [
			project("webappwiz", [live("c1", "One", "asked")], true),
		];
		testing.restarting = { resume: false, shutdown: true };
		await act(async () =>
			fireEvent.click(
				within(confirmation).getByRole("button", { name: "Shut down" }),
			),
		);

		expect(testing.posted("/api/checkpoint")).toEqual([
			{
				method: "POST",
				body: { projects: ["webappwiz"], after: "shutdown" },
			},
		]);
		const going = await waitFor(() =>
			view.getByRole("dialog", { name: "Shutting down arbor dev" }),
		);
		expect(steps(going)).toEqual(["Checkpoint", "Shut down"]);

		testing.goAway();

		const gone = await waitFor(
			() => view.getByRole("dialog", { name: "arbor dev shut down" }),
			{ timeout: 3000 },
		);
		expect(gone.textContent).toContain(
			"Start arbor dev again to resume the agents.",
		);
		expect(current(gone)).toBeNull();
		await act(async () =>
			fireEvent.click(
				within(gone)
					.getAllByRole("button", { name: "Close" })
					.at(-1) as Element,
			),
		);
		await menuItem(view, "arbor dev shut down");
	});

	it("closes once arbor dev is started again after a shutdown", async () => {
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "Shut down" }),
			),
		);
		const confirmation = await waitFor(() =>
			view.getByRole("dialog", { name: "Shut down arbor dev?" }),
		);
		expect(testing.posted("/api/power")).toEqual([]);
		expect(testing.posted("/api/checkpoint")).toEqual([]);
		testing.projects = [
			project("webappwiz", [live("c1", "One", "asked")], true),
		];
		testing.restarting = { resume: false, shutdown: true };
		await act(async () =>
			fireEvent.click(
				within(confirmation).getByRole("button", { name: "Shut down" }),
			),
		);
		testing.goAway();
		await waitFor(
			() => view.getByRole("dialog", { name: "arbor dev shut down" }),
			{ timeout: 3000 },
		);

		testing.restarting = null;
		testing.run = "run-2";
		testing.projects = [
			project("webappwiz", [live("c1", "One", "done")], true),
		];
		testing.comeBack();

		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull(), {
			timeout: 3000,
		});
		await menuItem(view, "Agents checkpointed");
	});
});
