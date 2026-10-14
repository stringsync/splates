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

describe("App's checkpoint restart", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("restarts from a done checkpoint, saying so until arbor dev is back", async () => {
		testing.projects = [
			project("webappwiz", [live("c1", "One", "done")], true),
		];
		const view = await testing.openConversations(
			[conversation({ id: "c1", status: "stopped", checkpoint: "done" })],
			null,
		);
		await act(async () =>
			fireEvent.click(await menuItem(view, "Checkpoint done")),
		);
		const done = await waitFor(() =>
			view.getByRole("dialog", { name: "Checkpoint" }),
		);

		await act(async () =>
			fireEvent.click(within(done).getByRole("button", { name: "Restart" })),
		);

		expect(testing.posted("/api/checkpoint/restart")).toEqual([
			{ method: "POST", body: {} },
		]);
		const restarting = await waitFor(() =>
			view.getByRole("dialog", { name: "Restart" }),
		);
		expect(
			within(restarting).queryByRole("button", { name: "Resume" }),
		).toBeNull();
		// Closing it leaves the restart to go on, rather than forgetting it.
		await act(async () =>
			fireEvent.click(
				within(restarting)
					.getAllByRole("button", { name: "Close" })
					.at(-1) as Element,
			),
		);
		expect(
			testing.posted("/api/conversations/checkpoint?project=webappwiz"),
		).toEqual([]);
		await menuItem(view, "Restarting arbor dev");
	});

	it("says arbor dev is restarting once a checkpoint asked to restart is done, then offers to resume its agents", async () => {
		testing.projects = [
			project("webappwiz", [live("c1", "One", "asked")], true),
		];
		testing.restarting = { resume: false, shutdown: false };
		const view = await testing.openConversations(
			[conversation({ id: "c1", status: "running" })],
			null,
		);
		await menuItem(view, "Checkpoint under way");

		testing.projects = [
			project("webappwiz", [live("c1", "One", "done")], true),
		];
		await testing.say(
			conversation({ id: "c1", status: "stopped", checkpoint: "done" }),
		);
		await act(async () =>
			fireEvent.click(await menuItem(view, "Restarting arbor dev")),
		);
		const restarting = await waitFor(() =>
			view.getByRole("dialog", { name: "Restart" }),
		);
		expect(restarting.textContent).toContain(
			"arbor dev is restarting, then you pick what comes next.",
		);
		for (const name of ["Restart", "Resume"]) {
			expect(within(restarting).queryByRole("button", { name })).toBeNull();
		}

		// Back, as another run, its agents waiting to be resumed.
		await act(async () => testing.talkStream?.onerror?.());
		testing.restarting = null;
		testing.restarted = "waiting";
		testing.run = "run-2";
		await act(async () => testing.talkStream?.onopen?.());
		await testing.say(
			conversation({ id: "c1", status: "stopped", checkpoint: "done" }),
		);

		// Restart shows a while longer, then says it is back.
		const restarted = view.getByRole("dialog", { name: "Restart" });
		await waitFor(() =>
			expect(restarted.textContent).toContain(
				"Now on arbor 0.0.1. 1 agent checkpointed and waiting to resume.",
			),
		);
		for (const name of ["Restart", "Retry missed"]) {
			expect(within(restarted).queryByRole("button", { name })).toBeNull();
		}
		await act(async () =>
			fireEvent.click(
				within(restarted).getByRole("button", { name: "Resume" }),
			),
		);
		expect(testing.posted("/api/checkpoint/resume")).toEqual([
			{ method: "POST", body: {} },
		]);

		// Each one resumed says so, still as after the restart.
		testing.restarted = null;
		testing.projects = [project("webappwiz", [live("c1", "One")], true)];
		await testing.say(conversation({ id: "c1", status: "running" }));
		const resumed = await waitFor(() =>
			view.getByRole("dialog", { name: "Resume" }),
		);
		await waitFor(() =>
			expect(resumed.textContent).toContain(
				"Now on arbor 0.0.1. 1 agent resumed.",
			),
		);
		expect(within(resumed).getByRole("img", { name: "Resumed" })).toBeTruthy();
		expect(
			within(resumed).getByRole("button", { name: "Reload page" }),
		).toBeTruthy();
	});

	it("restarts and resumes, showing each agent carry on, though the page never saw the last answer", async () => {
		testing.projects = [
			project("webappwiz", [live("c1", "One", "asked")], true),
		];
		testing.restarting = { resume: true, shutdown: false };
		const view = await testing.openConversations(
			[conversation({ id: "c1", status: "running" })],
			null,
		);
		await act(async () =>
			fireEvent.click(await menuItem(view, "Checkpoint under way")),
		);
		const going = await waitFor(() =>
			view.getByRole("dialog", { name: "Checkpoint" }),
		);
		expect(going.textContent).toContain(
			"Each agent is bringing its ARBOR.md up to date, then arbor dev restarts and each resumes.",
		);

		testing.goAway();

		const restarting = await waitFor(
			() => view.getByRole("dialog", { name: "Restart" }),
			{ timeout: 3000 },
		);
		expect(restarting.textContent).toContain(
			"arbor dev is restarting, then each agent resumes.",
		);
		expect(
			within(restarting).queryByRole("img", { name: "Checkpointing" }),
		).toBeNull();
		testing.restarting = null;
		testing.restarted = "resuming";
		testing.run = "run-2";
		testing.projects = [
			project("webappwiz", [live("c1", "One", "done")], true),
		];
		testing.comeBack();
		const restarted = await waitFor(
			() => view.getByRole("dialog", { name: "Resume" }),
			{ timeout: 3000 },
		);
		expect(restarted.textContent).toContain(
			"Now on arbor 0.0.1. 0 of 1 agent resumed so far.",
		);
		expect(
			within(restarted).getByRole("img", { name: "Resuming" }),
		).toBeTruthy();
		const list = within(restarted).getByRole("list", { name: "agents" });

		testing.restarted = null;
		testing.projects = [project("webappwiz", [live("c1", "One")], true)];
		await testing.say(conversation({ id: "c1", status: "running" }));
		await waitFor(
			() =>
				expect(restarted.textContent).toContain(
					"Now on arbor 0.0.1. 1 agent resumed.",
				),
			{ timeout: 3000 },
		);
		expect(view.getByRole("dialog", { name: "Resume" })).toBe(restarted);
		expect(
			within(restarted).getByRole("img", { name: "Resumed" }),
		).toBeTruthy();
		// The same slide, rather than a second one sliding in.
		await waitFor(() =>
			expect(
				within(restarted).getByRole("button", { name: "Reload page" }),
			).toBeTruthy(),
		);
		expect(within(restarted).getByRole("list", { name: "agents" })).toBe(list);
	});

	it("shows Restart for a while, though arbor dev came back before the page saw it go", async () => {
		testing.projects = [
			project("webappwiz", [live("c1", "One", "asked")], true),
		];
		testing.restarting = { resume: true, shutdown: false };
		const view = await testing.openConversations(
			[conversation({ id: "c1", status: "running" })],
			null,
		);
		await act(async () =>
			fireEvent.click(await menuItem(view, "Checkpoint under way")),
		);
		await waitFor(() => view.getByRole("dialog", { name: "Checkpoint" }));

		// Back as another run between two asks, its agents already resuming.
		testing.restarting = null;
		testing.restarted = "resuming";
		testing.run = "run-2";
		testing.projects = [
			project("webappwiz", [live("c1", "One", "done")], true),
		];
		const restarting = await waitFor(() =>
			view.getByRole("dialog", { name: "Restart" }),
		);
		expect(restarting.textContent).toContain(
			"arbor dev is restarting, then each agent resumes.",
		);
		await waitFor(() => view.getByRole("dialog", { name: "Resume" }));
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
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("radio", {
					name: /^Checkpoint and shut down/,
				}),
			),
		);
		testing.projects = [
			project("webappwiz", [live("c1", "One", "asked")], true),
		];
		testing.restarting = { resume: false, shutdown: true };

		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: "Proceed" })),
		);

		expect(testing.posted("/api/checkpoint")).toEqual([
			{
				method: "POST",
				body: { projects: ["webappwiz"], after: "shutdown" },
			},
		]);
		await waitFor(() =>
			view.getByText(
				"Each agent is bringing its ARBOR.md up to date, then arbor dev shuts down.",
			),
		);

		testing.goAway();

		const gone = await waitFor(
			() => view.getByRole("dialog", { name: "Shut down" }),
			{ timeout: 3000 },
		);
		expect(gone.textContent).toContain(
			"arbor dev shut down. Start it again to resume each agent.",
		);
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
