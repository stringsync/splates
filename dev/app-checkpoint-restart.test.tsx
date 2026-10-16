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
			fireEvent.click(await menuItem(view, "Restarting arbor dev")),
		);
		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Restarting arbor dev" }),
		);
		expect(steps(dialog)).toEqual(["Checkpoint", "Restart", "Resume"]);
		expect(current(dialog)).toBe("Checkpoint");

		testing.goAway();

		await waitFor(() => expect(current(dialog)).toBe("Restart"), {
			timeout: 3000,
		});
		testing.restarting = null;
		testing.restarted = "resuming";
		testing.run = "run-2";
		testing.projects = [
			project("webappwiz", [live("c1", "One", "done")], true),
		];
		testing.comeBack();
		await waitFor(() => expect(current(dialog)).toBe("Resume"), {
			timeout: 3000,
		});
		expect(dialog.textContent).toContain("0 of 1 agent back at work.");
		within(dialog).getByText("arbor 0.0.1");

		testing.restarted = null;
		testing.projects = [project("webappwiz", [live("c1", "One")], true)];
		await testing.say(conversation({ id: "c1", status: "running" }));
		await waitFor(() => within(dialog).getByText("1 agent back at work."), {
			timeout: 3000,
		});
		// The same screen throughout, rather than one sliding in per step.
		expect(view.getByRole("dialog", { name: "arbor dev restarted" })).toBe(
			dialog,
		);
		expect(current(dialog)).toBeNull();
	});

	it("opens, after the restart's reload, on its agents resuming, then on the arbor it runs", async () => {
		testing.projects = [
			project("webappwiz", [live("c1", "One", "asked")], true),
		];
		testing.restarting = { resume: true, shutdown: false };
		const view = await testing.openConversations(
			[conversation({ id: "c1", status: "running" })],
			null,
		);
		await waitFor(() => view.getByRole("button", { name: "Restarting" }));
		testing.restarting = null;
		testing.restarted = "resuming";
		testing.run = "run-2";
		testing.projects = [
			project("webappwiz", [live("c1", "One", "done")], true),
		];
		await waitFor(() => expect(testing.reloads).toBe(1), { timeout: 3000 });
		cleanup();

		const again = await testing.open();

		const dialog = await waitFor(() =>
			again.getByRole("dialog", { name: "Restarting arbor dev" }),
		);
		await waitFor(() => expect(current(dialog)).toBe("Resume"));
		testing.restarted = null;
		testing.projects = [project("webappwiz", [live("c1", "One")], true)];
		await testing.say(conversation({ id: "c1", status: "running" }));

		const restarted = await waitFor(
			() => again.getByRole("dialog", { name: "arbor dev restarted" }),
			{ timeout: 3000 },
		);
		within(restarted).getByText("1 agent back at work.");
		within(restarted).getByText("arbor 0.0.1");
		// The dialog says it, so the header does not.
		expect(again.queryByRole("button", { name: "Restarted" })).toBeNull();
	});

	it("opens, after a restart's reload with no agent to resume, on the arbor it updated to", async () => {
		testing.projects = [project("webappwiz", [], true)];
		testing.restarting = { resume: false, shutdown: false };
		const view = await testing.openConversations([], null, {
			release: { running: "0.0.43", newest: "0.0.44" },
		});
		await waitFor(() => view.getByRole("button", { name: "Restarting" }));
		testing.restarting = null;
		testing.run = "run-2";
		testing.served = {
			...testing.served,
			release: { running: "0.0.44", newest: "0.0.44" },
		};
		await waitFor(() => expect(testing.reloads).toBe(1), { timeout: 3000 });
		cleanup();

		const again = await testing.open({
			release: { running: "0.0.44", newest: "0.0.44" },
		});

		const restarted = await waitFor(() =>
			again.getByRole("dialog", { name: "arbor dev restarted" }),
		);
		expect(restarted.textContent).toContain("arbor dev is back.");
		within(restarted).getByText("arbor 0.0.44");
		within(restarted).getByText("Updated from arbor 0.0.43");
		expect(again.queryByRole("button", { name: "Restarted" })).toBeNull();
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
			fireEvent.click(await menuItem(view, "Restarting arbor dev")),
		);

		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Restarting arbor dev" }),
		);
		expect(
			within(dialog)
				.getAllByRole("link")
				.map((each) => each.textContent),
		).toEqual(["Two"]);
		expect(dialog.textContent).toContain("Missed the checkpoint: Two.");
	});

	it("checkpoints and shuts down, saying so once arbor dev has gone", async () => {
		testing.projects = [project("webappwiz", [live("c1", "One")], true)];
		const view = await testing.openConversations(
			[conversation({ id: "c1", status: "running" })],
			null,
		);
		await act(async () => fireEvent.click(await menuItem(view, "Power")));
		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Power" }),
		);
		testing.projects = [
			project("webappwiz", [live("c1", "One", "asked")], true),
		];
		testing.restarting = { resume: false, shutdown: true };

		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "Shut down" }),
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
		testing.projects = [project("webappwiz", [live("c1", "One")], true)];
		const view = await testing.openConversations(
			[conversation({ id: "c1", status: "running" })],
			null,
		);
		await act(async () => fireEvent.click(await menuItem(view, "Power")));
		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Power" }),
		);
		testing.projects = [
			project("webappwiz", [live("c1", "One", "asked")], true),
		];
		testing.restarting = { resume: false, shutdown: true };
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "Shut down" }),
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
