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

	it("holds one title through a restart that waits to resume, then offers Resume", async () => {
		testing.projects = [
			project("webappwiz", [live("c1", "One", "asked")], true),
		];
		testing.restarting = { resume: false, shutdown: false };
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
		expect(steps(dialog)).toEqual(["Checkpoint", "Restart"]);
		expect(current(dialog)).toBe("Checkpoint");
		expect(dialog.textContent).toContain("0 of 1 agent checkpointed.");

		testing.projects = [
			project("webappwiz", [live("c1", "One", "done")], true),
		];
		await testing.say(
			conversation({ id: "c1", status: "stopped", checkpoint: "done" }),
		);
		await waitFor(() => expect(current(dialog)).toBe("Restart"));
		expect(dialog.textContent).toContain(
			"arbor dev is restarting. This page reloads once it is back.",
		);
		// No list of agents while all goes well.
		expect(within(dialog).queryByRole("link")).toBeNull();
		expect(
			within(dialog)
				.getAllByRole("button")
				.map((each) => each.textContent),
		).toEqual(["Close", "Close"]);

		// Back, as another run, its agents waiting to be resumed.
		await act(async () => testing.talkStream?.onerror?.());
		testing.restarting = null;
		testing.restarted = "waiting";
		testing.run = "run-2";
		await act(async () => testing.talkStream?.onopen?.());
		await testing.say(
			conversation({ id: "c1", status: "stopped", checkpoint: "done" }),
		);

		const waiting = await waitFor(() =>
			view.getByRole("dialog", { name: "Agents waiting to resume" }),
		);
		expect(testing.reloads).toBe(1);
		expect(waiting.textContent).toContain(
			"Now on arbor 0.0.1. 1 agent waiting to resume.",
		);
		expect(
			within(waiting)
				.getAllByRole("button")
				.map((each) => each.textContent),
		).toEqual(["Close", "Resume", "Close"]);
		await act(async () =>
			fireEvent.click(within(waiting).getByRole("button", { name: "Resume" })),
		);
		expect(testing.posted("/api/checkpoint/resume")).toEqual([
			{ method: "POST", body: {} },
		]);

		testing.restarted = null;
		testing.projects = [project("webappwiz", [live("c1", "One")], true)];
		await testing.say(conversation({ id: "c1", status: "running" }));
		const resumed = await waitFor(() =>
			view.getByRole("dialog", { name: "arbor dev restarted" }),
		);
		await waitFor(() =>
			expect(resumed.textContent).toContain(
				"Now on arbor 0.0.1. 1 agent back at work.",
			),
		);
		expect(current(resumed)).toBeNull();
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
		expect(dialog.textContent).toContain(
			"Now on arbor 0.0.1. 0 of 1 agent back at work.",
		);

		testing.restarted = null;
		testing.projects = [project("webappwiz", [live("c1", "One")], true)];
		await testing.say(conversation({ id: "c1", status: "running" }));
		await waitFor(
			() =>
				expect(dialog.textContent).toContain(
					"Now on arbor 0.0.1. 1 agent back at work.",
				),
			{ timeout: 3000 },
		);
		// The same screen throughout, rather than one sliding in per step.
		expect(view.getByRole("dialog", { name: "arbor dev restarted" })).toBe(
			dialog,
		);
		expect(current(dialog)).toBeNull();
	});

	it("says in the header, after the restart's reload, how its agents resume, then that it restarted", async () => {
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

		const again = await testing.openConversations(
			[conversation({ id: "c1", status: "stopped", checkpoint: "done" })],
			null,
		);

		// Back in the work, rather than in a dialog.
		expect(again.queryByRole("dialog")).toBeNull();
		await waitFor(() =>
			again.getByRole("button", { name: "Resuming 1 agent" }),
		);
		testing.restarted = null;
		testing.projects = [project("webappwiz", [live("c1", "One")], true)];
		await testing.say(conversation({ id: "c1", status: "running" }));
		const restarted = await waitFor(() =>
			again.getByRole("button", { name: "Restarted" }),
		);

		await act(async () => fireEvent.click(restarted));

		await waitFor(() =>
			again.getByRole("dialog", { name: "arbor dev restarted" }),
		);
	});

	it("says in red in the header when agents wait to resume after a restart, opening Power to resume them", async () => {
		testing.projects = [
			project("webappwiz", [live("c1", "One", "done")], true),
		];
		testing.restarted = "waiting";
		const view = await testing.openConversations(
			[conversation({ id: "c1", status: "stopped", checkpoint: "done" })],
			null,
		);
		const badge = await waitFor(() =>
			view.getByRole("button", { name: "1 agent waiting to resume" }),
		);

		await act(async () => fireEvent.click(badge));

		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Agents waiting to resume" }),
		);
		expect(within(dialog).getByRole("button", { name: "Resume" })).toBeTruthy();
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
});
