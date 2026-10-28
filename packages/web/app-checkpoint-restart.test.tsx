import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
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

describe("App's checkpoint restart", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("restarts and resumes on one screen, though the page never saw the last answer", async () => {
		testing.projects = [
			project("webappwiz", [live("c1", "One", "asked")], true),
		];
		testing.restarting = { resume: true, shutdown: false };
		const view = await testing.openConversations(
			[conversation({ id: "c1", status: "running" })],
			null,
		);
		await act(async () =>
			fireEvent.click(await menuItem(view, "Restarting splates server")),
		);
		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Restarting splates server" }),
		);
		expect(steps(dialog)).toEqual(["Checkpoint", "Restart", "Resume"]);
		expect(current(dialog)).toBe("Checkpoint");

		testing.goAway();

		await waitFor(() => expect(current(dialog)).toBe("Restart"));
		testing.restarting = null;
		testing.restarted = "resuming";
		testing.run = "run-2";
		testing.projects = [
			project("webappwiz", [live("c1", "One", "done")], true),
		];
		testing.comeBack();
		await waitFor(() => expect(current(dialog)).toBe("Resume"));
		expect(dialog.textContent).toContain("0 of 1 agent back at work.");
		within(dialog).getByText("splates 0.0.1");

		testing.restarted = null;
		testing.projects = [project("webappwiz", [live("c1", "One")], true)];
		await testing.say(conversation({ id: "c1", status: "running" }));
		await waitFor(() => within(dialog).getByText("1 agent back at work."));
		// The same screen throughout, rather than one sliding in per step.
		expect(view.getByRole("dialog", { name: "splates server restarted" })).toBe(
			dialog,
		);
		expect(current(dialog)).toBeNull();
	});

	it.each([502, 503, 530])(
		"waits quietly through a proxy %s during restart",
		async (status) => {
			testing.projects = [
				project("webappwiz", [live("c1", "One", "asked")], true),
			];
			testing.restarting = { resume: true, shutdown: false };
			const view = await testing.openConversations(
				[conversation({ id: "c1", status: "running" })],
				null,
			);
			await act(async () =>
				fireEvent.click(await menuItem(view, "Restarting splates server")),
			);
			const dialog = await waitFor(() =>
				view.getByRole("dialog", { name: "Restarting splates server" }),
			);
			expect(current(dialog)).toBe("Checkpoint");
			testing.goAway(status);
			await waitFor(() => expect(current(dialog)).toBe("Restart"));
			expect(view.queryByText(/Projects not listed/)).toBeNull();
			testing.restarting = null;
			testing.run = "run-2";
			testing.comeBack();
			await waitFor(() => expect(testing.reloads).toBe(1));
			expect(view.queryByText(/Projects not listed/)).toBeNull();
		},
	);

	it("shows the refreshing UI as soon as Update is clicked", async () => {
		const view = await testing.open({
			release: { running: "0.0.43", newest: "0.0.44" },
		});

		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("button", { name: "Update" })),
			),
		);

		expect(view.getByRole("status", { name: "Refreshing" })).toBeDefined();
	});

	it("confirms inline after reload while its agents resume", async () => {
		testing.projects = [
			project("webappwiz", [live("c1", "One", "asked")], true),
		];
		testing.restarting = { resume: true, shutdown: false };
		const view = await testing.openConversations(
			[conversation({ id: "c1", status: "running" })],
			null,
		);
		await waitFor(() => view.getByRole("button", { name: "Updating" }));
		testing.restarting = null;
		testing.restarted = "resuming";
		testing.run = "run-2";
		testing.projects = [
			project("webappwiz", [live("c1", "One", "done")], true),
		];
		await waitFor(() => expect(testing.reloads).toBe(1));
		cleanup();

		const again = await testing.open();

		const updated = await waitFor(() =>
			again.getByRole("button", { name: "Updated" }),
		);
		expect((updated as HTMLButtonElement).disabled).toBe(true);
		expect(updated.querySelector("svg")).toBeNull();
		expect(again.queryByRole("dialog")).toBeNull();
		testing.restarted = null;
		testing.projects = [project("webappwiz", [live("c1", "One")], true)];
		await testing.say(conversation({ id: "c1", status: "running" }));
		expect(again.queryByRole("dialog")).toBeNull();
	});

	it("confirms inline after an update, until another update is needed", async () => {
		testing.projects = [project("webappwiz", [], true)];
		testing.restarting = { resume: false, shutdown: false };
		const view = await testing.openConversations([], null, {
			release: { running: "0.0.43", newest: "0.0.44" },
		});
		await waitFor(() => view.getByRole("button", { name: "Updating" }));
		testing.restarting = null;
		testing.run = "run-2";
		testing.served = {
			...testing.served,
			release: null,
		};
		await waitFor(() => expect(testing.reloads).toBe(1));
		cleanup();

		const again = await testing.open({
			release: null,
		});

		await waitFor(() => again.getByRole("button", { name: "Updated" }));
		expect(again.queryByRole("dialog")).toBeNull();

		testing.served = {
			...testing.served,
			release: { running: "0.0.44", newest: "0.0.45" },
		};
		await act(async () => testing.stream?.onmessage?.());
		await waitFor(() => again.getByRole("button", { name: "Update" }));
		expect(again.queryByText("Updated")).toBeNull();
	});

	it("replaces the inline confirmation with the current version after ten seconds", async () => {
		sessionStorage.setItem("splates.power.restarted", "0.0.43");
		const view = await testing.open();
		await waitFor(() => view.getByRole("button", { name: "Updated" }));
		expect(testing.timer.timeouts).toContainEqual(
			expect.objectContaining({ delay: Duration.secs(10), disposed: false }),
		);
		await act(async () => testing.timer.fireTimeouts());
		expect(view.queryByText("Updated")).toBeNull();
		expect(view.getByTitle("Current version: splates 0.0.1").textContent).toBe(
			"v0.0.1",
		);
		expect(view.queryByRole("dialog")).toBeNull();
	});

	it("names the agents a checkpoint missed, and no others", async () => {
		testing.projects = [
			project("webappwiz", [
				live("c1", "One", "done"),
				live("c2", "Two", "unanswered"),
			]),
		];
		testing.restarting = { resume: true, shutdown: false };
		const view = await testing.openConversations(
			[conversation({ id: "c1", status: "stopped", checkpoint: "done" })],
			null,
		);

		await act(async () =>
			fireEvent.click(await menuItem(view, "Restarting splates server")),
		);

		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Restarting splates server" }),
		);
		expect(
			within(dialog)
				.getAllByRole("link")
				.map((each) => each.textContent),
		).toEqual(["Two"]);
		expect(dialog.textContent).toContain("Missed the checkpoint: Two.");
	});
});
