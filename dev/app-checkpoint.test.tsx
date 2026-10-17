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

describe("App's checkpoint dialog", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("restarts at once with agents at work, naming the one a restart stops, and checkpoints none", async () => {
		testing.projects = [
			project("webappwiz", [live("c1", "Fix login")], true),
			project("shop", [
				live("s1", "Fix cart", null, true),
				live("s2", "Fix tax", null, true),
			]),
			project("quiet", []),
		];
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Fix login", status: "running" })],
			null,
		);
		await act(async () => fireEvent.click(await menuItem(view, "Power")));
		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Power" }),
		);
		expect(dialog.textContent).toContain("3 agents at work in 2 projects.");
		expect(
			(
				within(dialog).getByRole("checkbox", {
					name: "Checkpoint before shutting down",
				}) as HTMLInputElement
			).checked,
		).toBe(true);
		expect(dialog.textContent).toContain("Restart stops mid-turn: Fix login.");
		expect(dialog.textContent).not.toContain("Fix cart");
		testing.restarting = { resume: false, shutdown: false };

		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: "Restart" })),
		);

		expect(testing.posted("/api/checkpoint")).toEqual([]);
		expect(testing.posted("/api/power")).toEqual([
			{ method: "POST", body: { shutdown: false } },
		]);
	});

	it("goes straight to Checkpointing, though a listing asked before the checkpoint lands after", async () => {
		testing.projects = [project("webappwiz", [live("c1", "One")], true)];
		const view = await testing.openConversations(
			[conversation({ id: "c1", status: "running" })],
			null,
		);
		await act(async () => fireEvent.click(await menuItem(view, "Power")));
		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Power" }),
		);
		let release = () => {};
		testing.listingProjects = new Promise((resolve) => {
			release = resolve;
		});
		await testing.say(conversation({ id: "c1", status: "idle" }));
		testing.listingProjects = Promise.resolve();
		testing.projects = [
			project("webappwiz", [live("c1", "One", "asked")], true),
		];
		testing.restarting = { resume: false, shutdown: true };

		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "Shut down" }),
			),
		);
		const going = await waitFor(() =>
			view.getByText("0 of 1 agent checkpointed."),
		);
		await act(async () => release());

		expect(
			view.getByRole("dialog", { name: "Shutting down arbor dev" }),
		).toBeTruthy();
		expect(going.isConnected).toBe(true);
	});

	it("shows Checkpoint while no project has an agent running, with nothing to pick", async () => {
		testing.projects = [project("webappwiz", [], true)];
		const view = await testing.openConversations(
			[conversation({ id: "c2", title: "Old one", status: "stopped" })],
			null,
		);

		await act(async () => fireEvent.click(await menuItem(view, "Power")));

		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Power" }),
		);
		expect(within(dialog).getByText("No agent is running.")).toBeTruthy();
		expect(
			within(dialog).queryByRole("checkbox", { name: /^Checkpoint/ }),
		).toBeNull();

		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: "Restart" })),
		);
		expect(testing.posted("/api/power")).toEqual([
			{ method: "POST", body: { shutdown: false } },
		]);
		await waitFor(() =>
			view.getByRole("dialog", { name: "Restarting arbor dev" }),
		);

		// Back as another run, it says so rather than offering to checkpoint.
		testing.run = "run-2";
		const restarted = await waitFor(() => {
			const shown = view.getByRole("dialog", { name: "arbor dev restarted" });
			expect(shown.textContent).toContain("arbor dev is back.");
			within(shown).getByText("arbor 0.0.1");
			return shown;
		});
		expect(within(restarted).queryByText("No agent is running.")).toBeNull();
		expect(testing.reloads).toBe(1);
		await act(async () =>
			fireEvent.click(
				within(restarted)
					.getAllByRole("button", { name: "Close" })
					.at(-1) as Element,
			),
		);
		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
	});

	it("restarts with no checkpoint, saying what that stops, then reloads the page once back", async () => {
		testing.projects = [project("webappwiz", [live("c1", "Fix login")], true)];
		testing.held = [{ where: "terminal", command: "vim" }];
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Fix login", status: "running" })],
			null,
		);
		await act(async () => fireEvent.click(await menuItem(view, "Power")));
		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Power" }),
		);
		expect(dialog.textContent).toContain("Kills: vim (terminal).");
		expect(dialog.textContent).toContain("Restart stops mid-turn: Fix login.");

		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("checkbox", {
					name: "Checkpoint before shutting down",
				}),
			),
		);
		expect(dialog.textContent).toContain("Stops mid-turn: Fix login.");
		expect(dialog.textContent).not.toContain("Restart stops");
		testing.restarting = { resume: false, shutdown: false };
		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: "Restart" })),
		);

		expect(testing.posted("/api/power")).toEqual([
			{ method: "POST", body: { shutdown: false } },
		]);
		expect(testing.posted("/api/checkpoint")).toEqual([]);
		await waitFor(() =>
			expect(
				view.getByRole("dialog", { name: "Restarting arbor dev" }).textContent,
			).toContain(
				"arbor dev is restarting. This page reloads once it is back.",
			),
		);
		expect(testing.reloads).toBe(0);

		testing.restarting = null;
		testing.run = "run-2";
		await waitFor(() => expect(testing.reloads).toBe(1), { timeout: 3000 });
	});

	it("shuts down with no checkpoint, saying what that stops where a restart would keep it", async () => {
		testing.projects = [
			project("webappwiz", [live("c1", "One", null, true)], true),
		];
		const view = await testing.openConversations(
			[conversation({ id: "c1", status: "running" })],
			null,
		);
		await act(async () => fireEvent.click(await menuItem(view, "Power")));
		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Power" }),
		);
		expect(dialog.textContent).toContain(
			"1 agent at work in 1 project. A restart keeps them at work.",
		);
		expect(dialog.textContent).not.toContain("mid-turn");
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("checkbox", {
					name: "Checkpoint before shutting down",
				}),
			),
		);
		expect(dialog.textContent).toContain("Shutdown stops mid-turn: One.");
		expect(dialog.textContent).not.toContain("Restart stops");
		testing.restarting = { resume: false, shutdown: true };
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "Shut down" }),
			),
		);

		expect(testing.posted("/api/power")).toEqual([
			{ method: "POST", body: { shutdown: true } },
		]);
		testing.goAway();
		const gone = await waitFor(
			() => view.getByRole("dialog", { name: "arbor dev shut down" }),
			{ timeout: 3000 },
		);
		expect(gone.textContent).toContain(
			"Start arbor dev again from a terminal.",
		);
	});

	it("offers no restart with no agent running where arbor dev cannot make one", async () => {
		testing.projects = [project("webappwiz", [], true)];
		testing.restartable = false;
		const view = await testing.openConversations([], null);

		await act(async () => fireEvent.click(await menuItem(view, "Power")));

		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Power" }),
		);
		expect(
			within(dialog).queryByRole("button", { name: "Restart" }),
		).toBeNull();
	});

	it("says how a checkpoint under way gets on, naming only the one it missed, closing and opening again from the button", async () => {
		testing.projects = [
			project("webappwiz", [live("c1", "Fix login")], true),
			project("shop", [
				live("s1", "One", "done"),
				live("s2", "Two", "asked"),
				live("s3", "Three", "unanswered"),
			]),
		];
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Fix login", status: "running" })],
			null,
		);

		await act(async () =>
			fireEvent.click(await menuItem(view, "Checkpointing agents")),
		);

		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Checkpointing agents" }),
		);
		expect(within(dialog).queryByRole("checkbox")).toBeNull();
		expect(dialog.textContent).toContain("1 of 3 agents checkpointed.");
		expect(
			within(dialog)
				.getAllByRole("link")
				.map((each) => each.textContent),
		).toEqual(["Three"]);
		expect(
			within(dialog).getByRole("listitem", { current: "step" }).textContent,
		).toBe("Checkpoint");
		expect(within(dialog).queryByRole("button", { name: "Resume" })).toBeNull();

		await act(async () =>
			fireEvent.click(
				within(dialog)
					.getAllByRole("button", { name: "Close" })
					.at(-1) as Element,
			),
		);
		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
		await act(async () =>
			fireEvent.click(await menuItem(view, "Checkpointing agents")),
		);
		await waitFor(() =>
			view.getByRole("dialog", { name: "Checkpointing agents" }),
		);
	});

	it("keeps a done checkpoint on the button while looking at the agent it missed", async () => {
		testing.projects = [
			project(
				"webappwiz",
				[live("c1", "One", "done"), live("c2", "Two", "unanswered")],
				true,
			),
		];
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "One", status: "stopped" })],
			null,
		);
		await act(async () =>
			fireEvent.click(await menuItem(view, "Agents checkpointed")),
		);
		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Agents checkpointed" }),
		);

		await act(async () =>
			fireEvent.click(within(dialog).getByRole("link", { name: "Two" })),
		);

		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
		expect(
			testing.posted("/api/conversations/checkpoint?project=webappwiz"),
		).toEqual([]);
		await act(async () =>
			fireEvent.click(await menuItem(view, "Agents checkpointed")),
		);
		await waitFor(() =>
			view.getByRole("dialog", { name: "Agents checkpointed" }),
		);
	});
});
