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

	it("checkpoints the projects picked in a dialog, this one picked to start, then what follows", async () => {
		testing.projects = [
			project("webappwiz", [live("c1", "Fix login")], true),
			project("shop", [live("s1", "Fix cart"), live("s2", "Fix tax")]),
			project("quiet", []),
		];
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Fix login", status: "running" })],
			null,
		);
		await act(async () => fireEvent.click(await menuItem(view, "Checkpoint")));
		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Checkpoint" }),
		);
		const box = (slug: string) =>
			within(dialog).getByRole("checkbox", {
				name: `Checkpoint ${slug}`,
			}) as HTMLInputElement;
		expect(box("webappwiz").checked).toBe(true);
		expect(box("shop").checked).toBe(false);
		expect(within(dialog).queryByText("quiet")).toBeNull();
		expect(testing.posted("/api/checkpoint")).toEqual([]);

		await act(async () => fireEvent.click(box("shop")));
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("radio", {
					name: /^Checkpoint, restart and resume/,
				}),
			),
		);
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("radio", { name: /^Checkpoint and restart/ }),
			),
		);
		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: "Proceed" })),
		);

		expect(testing.posted("/api/checkpoint")).toEqual([
			{
				method: "POST",
				body: { projects: ["webappwiz", "shop"], after: "restart" },
			},
		]);
	});

	it("goes straight to Checkpointing, though a listing asked before the checkpoint lands after", async () => {
		testing.projects = [project("webappwiz", [live("c1", "One")], true)];
		const view = await testing.openConversations(
			[conversation({ id: "c1", status: "running" })],
			null,
		);
		await act(async () => fireEvent.click(await menuItem(view, "Checkpoint")));
		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Checkpoint" }),
		);
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("radio", {
					name: /^Checkpoint, restart and resume/,
				}),
			),
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
		testing.restarting = { resume: true };

		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: "Proceed" })),
		);
		const going = await waitFor(() =>
			view.getByText(
				"Each agent is bringing its ARBOR.md up to date, then arbor dev restarts and each resumes.",
			),
		);
		await act(async () => release());

		expect(view.getByRole("dialog", { name: "Checkpoint" })).toBeTruthy();
		expect(going.isConnected).toBe(true);
	});

	it("shows Checkpoint while no project has an agent running, with nothing to pick", async () => {
		testing.projects = [project("webappwiz", [], true)];
		const view = await testing.openConversations(
			[conversation({ id: "c2", title: "Old one", status: "stopped" })],
			null,
		);

		await act(async () => fireEvent.click(await menuItem(view, "Checkpoint")));

		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Checkpoint" }),
		);
		expect(within(dialog).getByText("No agent is running.")).toBeTruthy();
		expect(within(dialog).queryByRole("checkbox")).toBeNull();

		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: "Restart" })),
		);
		expect(testing.posted("/api/checkpoint/restart")).toHaveLength(1);
		await waitFor(() => view.getByRole("dialog", { name: "Restart" }));

		// Back as another run, it says so rather than offering to checkpoint.
		testing.run = "run-2";
		const restarted = await waitFor(() => {
			const shown = view.getByRole("dialog", { name: "Restart" });
			expect(shown.textContent).toContain(
				"arbor dev restarted on arbor 0.0.1.",
			);
			return shown;
		});
		expect(within(restarted).queryByText("No agent is running.")).toBeNull();
		expect(
			within(restarted).getByRole("button", { name: "Reload page" }),
		).toBeTruthy();
		await act(async () =>
			fireEvent.click(
				within(restarted)
					.getAllByRole("button", { name: "Close" })
					.at(-1) as Element,
			),
		);
		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
	});

	it("offers no restart with no agent running where arbor dev cannot make one", async () => {
		testing.projects = [project("webappwiz", [], true)];
		testing.restartable = false;
		const view = await testing.openConversations([], null);

		await act(async () => fireEvent.click(await menuItem(view, "Checkpoint")));

		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Checkpoint" }),
		);
		expect(
			within(dialog).queryByRole("button", { name: "Restart" }),
		).toBeNull();
	});

	it("says how each agent of a checkpoint under way gets on, closing and opening again from the button", async () => {
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
			fireEvent.click(await menuItem(view, "Checkpoint under way")),
		);

		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Checkpoint" }),
		);
		expect(within(dialog).queryByRole("checkbox")).toBeNull();
		expect(
			within(dialog).getByRole("img", { name: "Checkpointed" }),
		).toBeTruthy();
		expect(
			within(dialog).getByRole("img", { name: "Checkpointing" }),
		).toBeTruthy();
		expect(
			within(dialog).getByRole("img", { name: "No response" }),
		).toBeTruthy();
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
			fireEvent.click(await menuItem(view, "Checkpoint under way")),
		);
		await waitFor(() => view.getByRole("dialog", { name: "Checkpoint" }));
	});

	it("says a checkpoint is done on the button, opening Done, and resumes its agents", async () => {
		testing.projects = [
			project("webappwiz", [live("c1", "One", "asked")], true),
		];
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "One", status: "running" })],
			null,
		);
		await menuItem(view, "Checkpoint under way");
		expect(view.queryByRole("dialog")).toBeNull();

		testing.projects = [
			project("webappwiz", [live("c1", "One", "done")], true),
		];
		await testing.say(
			conversation({
				id: "c1",
				title: "One",
				status: "stopped",
				checkpoint: "done",
			}),
		);

		await act(async () =>
			fireEvent.click(await menuItem(view, "Checkpoint done")),
		);
		expect(view.queryAllByRole("dialog")).toHaveLength(1);
		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Checkpoint" }),
		);
		expect(dialog.textContent).toContain("1 agent checkpointed and stopped.");
		expect(
			within(dialog).queryByRole("button", { name: "Retry missed" }),
		).toBeNull();
		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: "Resume" })),
		);
		expect(testing.posted("/api/checkpoint/resume")).toEqual([
			{ method: "POST", body: {} },
		]);

		testing.projects = [project("webappwiz", [live("c1", "One")], true)];
		await testing.say(
			conversation({ id: "c1", title: "One", status: "running" }),
		);
		await waitFor(() =>
			expect(dialog.textContent).toContain("1 agent resumed."),
		);
		expect(within(dialog).getByRole("img", { name: "Resumed" })).toBeTruthy();
		expect(within(dialog).queryByRole("button", { name: "Resume" })).toBeNull();
		expect(view.getByRole("dialog", { name: "Resume" })).toBe(dialog);

		// Seen and closed, it leaves the button for the next checkpoint.
		await act(async () =>
			fireEvent.click(
				within(dialog)
					.getAllByRole("button", { name: "Close" })
					.at(-1) as Element,
			),
		);
		await menuItem(view, "Checkpoint");
	});

	it("retries those a checkpoint missed, or closes, leaving them stopped", async () => {
		testing.projects = [
			project(
				"webappwiz",
				[live("c1", "One", "done"), live("c2", "Two", "asked")],
				true,
			),
		];
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "One", status: "stopped" })],
			null,
		);
		testing.projects = [
			project(
				"webappwiz",
				[live("c1", "One", "done"), live("c2", "Two", "unanswered")],
				true,
			),
		];
		await testing.say(conversation({ id: "c2", title: "Two", status: "idle" }));
		await act(async () =>
			fireEvent.click(await menuItem(view, "Checkpoint done")),
		);

		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Checkpoint" }),
		);
		expect(dialog.textContent).toContain("1 missed: Two.");
		// The footer's, not the corner's, which does the same.
		const click = (name: string) =>
			act(async () =>
				fireEvent.click(
					within(dialog).getAllByRole("button", { name }).at(-1) as Element,
				),
			);

		await click("Retry missed");
		expect(testing.posted("/api/checkpoint")).toEqual([
			{
				method: "POST",
				body: { projects: ["webappwiz"], after: "stop", conversations: ["c2"] },
			},
		]);
		await click("Close");
		expect(
			testing.posted("/api/conversations/checkpoint?project=webappwiz"),
		).toEqual([{ method: "DELETE", body: {} }]);
	});

	it("keeps a done checkpoint on the button while looking at one of its agents", async () => {
		testing.projects = [
			project("webappwiz", [live("c1", "One", "asked")], true),
		];
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "One", status: "running" })],
			null,
		);
		testing.projects = [
			project("webappwiz", [live("c1", "One", "done")], true),
		];
		await testing.say(
			conversation({
				id: "c1",
				title: "One",
				status: "stopped",
				checkpoint: "done",
			}),
		);
		await act(async () =>
			fireEvent.click(await menuItem(view, "Checkpoint done")),
		);
		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Checkpoint" }),
		);

		await act(async () =>
			fireEvent.click(within(dialog).getByRole("link", { name: /One/ })),
		);

		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
		expect(
			testing.posted("/api/conversations/checkpoint?project=webappwiz"),
		).toEqual([]);
		await act(async () =>
			fireEvent.click(await menuItem(view, "Checkpoint done")),
		);
		await waitFor(() => view.getByRole("dialog", { name: "Checkpoint" }));
	});
});
