import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's task dialog", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const BLOCKED = `# beta

## Goal

ship the thing

## Notes

see the header

## Blocked

- [x] 1. Do the tests pass? → yes
- [ ] 2. How should sessions move?
  Sessions are keyed by the old cookie.
  - (a) Sign everyone out once
  - (b) Migrate each on its next request (chosen)
`;

	const escalated = details({
		task: "beta",
		status: "escalated",
		escalation: "needs a call",
		plan: BLOCKED,
	});

	const openBeta = async (view: Awaited<ReturnType<Testing["open"]>>) => {
		await act(async () =>
			fireEvent.click(
				within(view.getByRole("list", { name: "task list" })).getByRole(
					"button",
					{ name: /beta/ },
				),
			),
		);
		return await waitFor(() => view.getByRole("dialog"));
	};

	it("shows a task's whole plan, Blocked and all, each question's number beside its box", async () => {
		const view = await testing.openTasks({ tasks: [escalated] });
		const dialog = await openBeta(view);

		expect(dialog.textContent).toContain("see the header");
		expect(
			within(dialog).getByRole("heading", { name: "Blocked" }),
		).toBeTruthy();
		const item = within(dialog).getByText(/2\. How should sessions move\?/);
		expect(
			item.closest("li")?.querySelector("input[type=checkbox]"),
		).toBeTruthy();
		expect(
			within(dialog).queryByRole("list", { name: "questions" }),
		).toBeNull();
	});

	it("links each port the task serves, through the ports host and on the machine", async () => {
		testing.ports = [
			{
				task: "beta",
				port: 5173,
				local: "http://localhost:5173",
				remote: "https://beta-5173.ports.example.com",
			},
			{
				task: "gamma",
				port: 3000,
				local: "http://localhost:3000",
				remote: null,
			},
		];
		const view = await testing.openTasks({ tasks: [escalated] });
		const dialog = await openBeta(view);

		const ports = await waitFor(() =>
			within(dialog).getByRole("region", { name: "ports" }),
		);
		expect(
			within(ports)
				.getAllByRole("link")
				.map((link) => link.getAttribute("href")),
		).toEqual(["https://beta-5173.ports.example.com", "http://localhost:5173"]);
	});

	it("answers a task's open questions from its action bar in the dialog when the page runs no conversations", async () => {
		const view = await testing.openTasks({ tasks: [escalated] });
		const dialog = await openBeta(view);

		await act(async () =>
			fireEvent.click(
				within(
					within(dialog).getByRole("toolbar", { name: "actions" }),
				).getByRole("button", { name: "Answer a question" }),
			),
		);

		expect(
			within(dialog).getByRole("region", { name: "questions for you" }),
		).toBeTruthy();
		expect(
			within(dialog).getByRole("button", { name: /Sign everyone out once/ }),
		).toBeTruthy();
	});

	it("goes from a task's open questions to its external agent's view to answer them", async () => {
		testing.talk = { agents: [], conversations: [] };
		const view = await testing.openTasks({ tasks: [escalated] });
		const dialog = await openBeta(view);

		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "Answer a question" }),
			),
		);

		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
		expect(location.hash).toBe("#conversations/task/beta");
		expect(
			within(view.getByRole("region", { name: "beta" })).getByRole("region", {
				name: "questions for you",
			}),
		).toBeTruthy();
	});

	it("leaves a task's open questions to the arbor dev conversation on it, which asks them itself", async () => {
		testing.talk = {
			agents: [],
			conversations: [conversation({ id: "c1", task: "beta" })],
		};
		const view = await testing.openTasks({ tasks: [escalated] });
		const dialog = await openBeta(view);

		// toBeNull passes on an element here, so count them instead.
		expect(
			within(dialog).queryAllByRole("button", { name: "Answer a question" }),
		).toHaveLength(0);
	});

	it("keeps the open task in the address, and opens the one it names", async () => {
		const view = await testing.openTasks({ tasks: [escalated] });
		await openBeta(view);
		expect(location.hash).toBe("#tasks/beta");

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Close" })),
		);
		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
		expect(location.hash).toBe("#tasks");

		await act(async () => {
			location.hash = "#tasks/beta";
		});
		const dialog = await waitFor(() => view.getByRole("dialog"));
		expect(within(dialog).getByRole("heading", { name: "beta" })).toBeTruthy();
	});

	it("offers no changes to review for a task with no commits", async () => {
		testing.talk = { agents: [], conversations: [] };
		const view = await testing.openTasks({
			tasks: [details({ task: "beta", ahead: 0, added: 0, removed: 0 })],
		});
		const dialog = await openBeta(view);

		expect(dialog.textContent).toContain("0 commits");
		expect(within(dialog).queryByText("Review changes")).toBeNull();
	});

	it("removes a task no agent works on, with no commits its base lacks, at once", async () => {
		testing.talk = {
			agents: [],
			conversations: [conversation({ id: "c1", task: "beta", status: "idle" })],
		};
		const view = await testing.openTasks({
			tasks: [{ ...escalated, ahead: 0 }],
		});
		const dialog = await openBeta(view);

		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: "Remove" })),
		);

		await waitFor(() =>
			expect(testing.posts).toEqual([
				{ path: "/api/tasks/beta", method: "DELETE", body: undefined },
			]),
		);
		expect(view.queryByRole("heading", { name: "Remove beta?" })).toBeNull();
	});

	it("asks before removing a task an agent here works on, and removes it only once told to", async () => {
		testing.talk = {
			agents: [],
			conversations: [
				conversation({ id: "c1", task: "beta", status: "running" }),
			],
		};
		const view = await testing.openTasks({ tasks: [escalated] });
		const dialog = await openBeta(view);
		const remove = () =>
			act(async () =>
				fireEvent.click(within(dialog).getByRole("button", { name: "Remove" })),
			);

		await remove();
		const asked = await waitFor(() =>
			view.getByRole("dialog", { name: "Remove beta?" }),
		);
		expect(asked.textContent).toContain(
			"An agent is still working on it. Removing stops it and moves its conversation to the main tree.",
		);
		await act(async () =>
			fireEvent.click(within(asked).getByRole("button", { name: "Cancel" })),
		);
		await waitFor(() =>
			expect(view.queryByRole("dialog", { name: "Remove beta?" })).toBeNull(),
		);
		expect(testing.posts).toEqual([]);

		await remove();
		await act(async () =>
			fireEvent.click(
				within(
					await waitFor(() =>
						view.getByRole("dialog", { name: "Remove beta?" }),
					),
				).getByRole("button", { name: "Remove" }),
			),
		);
		await waitFor(() =>
			expect(testing.posts.map((post) => post.path)).toEqual([
				"/api/tasks/beta",
			]),
		);
	});

	it("asks before removing a task with commits its base lacks, saying how many go", async () => {
		testing.talk = { agents: [], conversations: [] };
		const view = await testing.openTasks({
			tasks: [{ ...escalated, ahead: 2 }],
		});
		const dialog = await openBeta(view);

		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: "Remove" })),
		);

		const asked = await waitFor(() =>
			view.getByRole("dialog", { name: "Remove beta?" }),
		);
		expect(asked.textContent).toContain(
			"Its 2 commits not on main, its worktree and any uncommitted changes are discarded.",
		);
		expect(asked.textContent).not.toContain("working");
		expect(testing.posts).toEqual([]);
	});

	it("asks before removing a task an external agent holds, saying the page cannot stop it", async () => {
		testing.talk = { agents: [], conversations: [] };
		const view = await testing.openTasks({
			tasks: [{ ...escalated, lease: "held" }],
		});
		const dialog = await openBeta(view);

		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: "Remove" })),
		);

		const asked = await waitFor(() =>
			view.getByRole("dialog", { name: "Remove beta?" }),
		);
		expect(asked.textContent).toContain("which the page cannot stop");
		expect(testing.posts).toEqual([]);
	});
});
