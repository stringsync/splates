import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	AGENTS,
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's orphaned tasks", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const failed = conversation({
		id: "c1",
		task: "beta",
		status: "failed",
		error: "exited 1",
	});

	/** The row of task `name` on the Tasks page, not the sidebar's conversation. */
	const rowOf = (
		view: Awaited<ReturnType<Testing["openTasks"]>>,
		name: string,
	) =>
		within(view.getByRole("tabpanel")).getByRole("button", {
			name: new RegExp(name),
		});

	const openTask = async () => {
		const view = await testing.openTasks({
			tasks: [details({ task: "beta" })],
		});
		await act(async () => fireEvent.click(rowOf(view, "beta")));
		const dialog = await waitFor(() => view.getByRole("dialog"));
		return {
			view,
			bar: within(within(dialog).getByRole("toolbar", { name: "actions" })),
		};
	};

	it("dots the Tasks tab and marks the row of a task whose agent failed, and only then", async () => {
		testing.talk = { agents: AGENTS, conversations: [failed] };
		let view = await testing.openTasks({ tasks: [details({ task: "beta" })] });

		const tab = view.getByRole("tab", { name: /Tasks/ });
		expect(
			within(tab).getByRole("img", { name: "orphaned tasks" }),
		).toBeTruthy();
		const row = rowOf(view, "beta");
		expect(within(row).getByRole("status", { name: "orphaned" })).toBeTruthy();

		cleanup();
		testing.dispose();
		testing = new Testing();
		testing.talk = {
			agents: AGENTS,
			conversations: [{ ...failed, status: "stopped", error: null }],
		};
		view = await testing.openTasks({ tasks: [details({ task: "beta" })] });
		expect(
			within(view.getByRole("tab", { name: /Tasks/ })).queryByRole("img", {
				name: "orphaned tasks",
			}),
		).toBeNull();
	});

	it("restarts a failed agent on its task from the task's dialog", async () => {
		testing.talk = { agents: AGENTS, conversations: [failed] };
		const { bar } = await openTask();

		await act(async () =>
			fireEvent.click(bar.getByRole("button", { name: "Restart" })),
		);

		expect(testing.posted("/api/conversations/c1/restart")).toHaveLength(1);
	});

	it("hands a failed agent's task to a new conversation with the agent picked, sent the prompt that claims it", async () => {
		testing.talk = { agents: AGENTS, conversations: [failed] };
		const { view, bar } = await openTask();
		const prompt = "[SPLATES TASK beta]\n\nThe agent before you…";
		// What hand-off answers, and as the conversation started next.
		testing.reply = {
			...conversation({ id: "c2", agent: "codex", task: "beta" }),
			prompt,
		};

		await act(async () =>
			fireEvent.click(bar.getByRole("button", { name: /Hand to a new agent/ })),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("menuitem", { name: /Codex/ })),
			),
		);

		await waitFor(() =>
			expect(testing.posted("/api/conversations/c2/prompt")).toHaveLength(1),
		);
		expect(testing.posted("/api/conversations/c1/hand-off")).toHaveLength(1);
		expect(testing.posted("/api/conversations")[0]?.body).toMatchObject({
			agent: "codex",
			task: "beta",
		});
		expect(
			testing.posted("/api/conversations/c2/prompt")[0]?.body,
		).toMatchObject({ text: prompt });
	});
});
