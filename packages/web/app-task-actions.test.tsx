import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	AGENTS,
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	message,
	resize,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's task dialog on a phone", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		resize(390, 844);
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		resize(1024, 768);
	});

	const openTask = async (task: ReturnType<typeof details>) => {
		const view = await testing.open({ tasks: [task] });
		await act(async () => {
			location.hash = `#tasks/${task.task}`;
			dispatchEvent(new HashChangeEvent("hashchange"));
		});
		const dialog = await waitFor(() => view.getByRole("dialog"));
		return {
			view,
			bar: within(within(dialog).getByRole("toolbar", { name: "actions" })),
		};
	};

	it("keeps the most pressing action out and the rest in a menu, past two", async () => {
		testing.talk = { agents: AGENTS, conversations: [] };
		const { view, bar } = await openTask(details({ task: "beta", ahead: 2 }));

		expect(bar.getAllByRole("button").map((each) => each.textContent)).toEqual([
			"Review changes",
			"",
		]);
		await act(async () =>
			fireEvent.click(bar.getByRole("button", { name: "More actions" })),
		);
		const items = await waitFor(() => view.getAllByRole("menuitem"));
		expect(items.map((each) => each.textContent)).toEqual([
			"Auto pick",
			"Claude",
			"Codex",
			"Remove",
		]);

		// Removing still asks first, its commits not yet on main.
		await act(async () =>
			fireEvent.click(view.getByRole("menuitem", { name: "Remove" })),
		);
		expect(
			await waitFor(() => view.getByRole("heading", { name: "Remove beta?" })),
		).toBeTruthy();
	});

	it("names the conversation working on it, rather than showing a bare spinner", async () => {
		testing.talk = {
			agents: AGENTS,
			conversations: [
				conversation({ id: "c1", task: "beta", status: "running" }),
			],
		};
		const { bar } = await openTask(details({ task: "beta", ahead: 2 }));

		const open = bar.getByRole("button", { name: /^Open / });
		const name = open.getAttribute("title") ?? "";
		expect(name).not.toBe("");
		expect(open.textContent).toContain(name);
	});

	it("shows two actions side by side, with no menu", async () => {
		testing.talk = { agents: AGENTS, conversations: [] };
		const { bar } = await openTask(details({ task: "beta", ahead: 0 }));

		expect(bar.getByRole("button", { name: "Remove" })).toBeTruthy();
		expect(
			bar.getByRole("button", { name: /Start a conversation/ }),
		).toBeTruthy();
		expect(bar.queryByRole("button", { name: "More actions" })).toBeNull();
	});

	it("offers to archive a deferred task's conversation instead of only removing it", async () => {
		testing.talk = {
			agents: AGENTS,
			conversations: [
				conversation({
					id: "c1",
					task: "beta",
					messages: [
						message(
							"agent",
							"## ⏸ Deferred beta: waiting on an upstream release\n\nThe work is back on the list.",
						),
					],
				}),
			],
		};
		const { view } = await openTask(
			details({
				task: "beta",
				takenBy: "c1",
				ahead: 0,
				unmerged: false,
			}),
		);

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Remove" })),
		);
		expect(view.getByRole("heading", { name: "Remove beta?" })).toBeTruthy();
		expect(testing.posted("/api/tasks/beta")).toEqual([]);

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Archive instead" })),
		);
		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/archived")).toEqual([
				{ method: "PUT", body: { archived: true } },
			]),
		);
		expect(testing.posted("/api/tasks/beta")).toEqual([
			{ method: "DELETE", body: {} },
		]);
	});

	it("asks before removing a paused task even with nothing unmerged", async () => {
		testing.talk = {
			agents: AGENTS,
			conversations: [
				conversation({
					id: "c1",
					task: "beta",
					status: "stopped",
					checkpoint: "done",
					messages: [message("user", "[SPLATES CHECKPOINT]")],
				}),
			],
		};
		const { view } = await openTask(
			details({
				task: "beta",
				takenBy: "c1",
				ahead: 0,
				unmerged: false,
			}),
		);

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Remove" })),
		);
		expect(view.getByRole("heading", { name: "Remove beta?" })).toBeTruthy();
		expect(view.getByRole("button", { name: "Archive instead" })).toBeTruthy();
		expect(testing.posted("/api/tasks/beta")).toEqual([]);
	});

	it("hides a removed task at once, and brings it back saying why when refused", async () => {
		const { view } = await openTask(
			details({ task: "alpha", ahead: 0, unmerged: false }),
		);
		testing.holdWrites();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Remove" })),
		);
		await waitFor(() =>
			expect(view.queryAllByRole("button", { name: "Remove" })).toHaveLength(0),
		);
		expect(testing.posted("/api/tasks/alpha")).toHaveLength(1);

		testing.refuseWrites = { reason: "busy", message: "locked" };
		await act(async () => testing.release());
		await waitFor(() => view.getByRole("button", { name: "Remove" }));
		expect(view.getByText("Not removed: locked")).toBeTruthy();
	});
});
