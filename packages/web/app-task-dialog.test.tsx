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

	const asking = details({ task: "beta", plan: BLOCKED });

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

	/** Picks Remove from the dialog's menu of rarer actions. */
	const chooseRemove = async (
		view: Awaited<ReturnType<Testing["open"]>>,
		dialog: HTMLElement,
	) => {
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "More actions" }),
			),
		);
		const item = await waitFor(() =>
			view.getByRole("menuitem", { name: "Remove" }),
		);
		await act(async () => fireEvent.click(item));
	};

	const showTab = async (dialog: HTMLElement, name: RegExp) => {
		await act(async () =>
			fireEvent.click(within(dialog).getByRole("tab", { name })),
		);
		return within(dialog).getByRole("tabpanel");
	};

	it("opens on where a task stands and its Goal, the rest of its plan a tab away", async () => {
		const view = await testing.openTasks({ tasks: [asking] });
		const dialog = await openBeta(view);

		// Its agent carries on with its own pick while the question waits.
		expect(within(dialog).getByText("Working")).toBeTruthy();
		expect(
			within(dialog).getAllByText("How should sessions move?").length,
		).toBeGreaterThan(0);
		expect(
			within(dialog)
				.getAllByRole("tab")
				.map((each) => each.textContent),
		).toEqual(["Overview", "Notes", "Details"]);
		const overview = within(dialog).getByRole("tabpanel");
		expect(overview.textContent).toContain("ship the thing");
		expect(overview.textContent).not.toContain("see the header");

		expect((await showTab(dialog, /Notes/)).textContent).toContain(
			"see the header",
		);
		const details = await showTab(dialog, /Details/);
		expect(within(details).getByText("Merges tried")).toBeTruthy();
	});

	it("says a task waits on you once its agent goes quiet with a question open", async () => {
		const view = await testing.openTasks({
			tasks: [
				details({
					task: "beta",
					activeAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
					plan: "# beta\n\n## Goal\n\nship it\n\n## Blocked\n\n- [ ] 1. Which port should it use?\n",
				}),
			],
		});
		const dialog = await openBeta(view);

		expect(within(dialog).getByText("Waiting on you")).toBeTruthy();
		expect(
			within(dialog).getAllByText("Which port should it use?").length,
		).toBeGreaterThan(0);
	});

	it("counts a task's steps done, and keeps a section the skill does not name under Notes", async () => {
		const view = await testing.openTasks({
			tasks: [
				details({
					task: "beta",
					plan: "# beta\n\n## Goal\n\nship it\n\n## Next\n\n- [x] one\n- [ ] two\n- [ ] three\n\n## Findings\n\nthe cache is cold\n",
				}),
			],
		});
		const dialog = await openBeta(view);

		expect(
			within(within(dialog).getByRole("region", { name: "steps" })).getByText(
				"1 of 3",
			),
		).toBeTruthy();
		expect(within(dialog).queryByRole("tab", { name: /Questions/ })).toBeNull();
		const notes = await showTab(dialog, /Notes/);
		expect(
			within(notes).getByRole("heading", { name: "Findings" }),
		).toBeTruthy();
		expect(notes.textContent).toContain("the cache is cold");
	});

	it("links each port the task serves, through the ports host and on the machine", async () => {
		testing.ports = [
			{
				task: "beta",
				port: 5173,
				worker: "local",
				local: "http://localhost:5173",
				onWorker: "http://localhost:5173",
				remote: "https://beta-5173.ports.example.com",
			},
			{
				task: "gamma",
				port: 3000,
				worker: "local",
				local: "http://localhost:3000",
				onWorker: "http://localhost:3000",
				remote: null,
			},
		];
		const view = await testing.openTasks({ tasks: [asking] });
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

	it("links a port on the worker that serves it, named, when the page is open off the coordinator's machine", async () => {
		testing.ports = [
			{
				task: "beta",
				port: 5173,
				worker: "mac",
				local: "http://127.0.0.1:41022",
				onWorker: "http://127.0.0.1:5173",
				remote: "https://beta-5173.ports.example.com",
			},
		];
		const view = await testing.openTasks({ tasks: [asking] });
		const was = location.href;
		setURL("https://splates.example.com/");
		try {
			const dialog = await openBeta(view);

			const ports = await waitFor(() =>
				within(dialog).getByRole("region", { name: "ports" }),
			);
			expect(
				within(ports)
					.getAllByRole("link")
					.map((link) => link.getAttribute("href")),
			).toEqual([
				"https://beta-5173.ports.example.com",
				"http://127.0.0.1:5173",
			]);
			expect(within(ports).getByText("on mac")).toBeTruthy();
		} finally {
			setURL(was);
		}
	});

	it("answers none of a task's open questions, which its agent asks in its own session", async () => {
		testing.talk = { agents: [], conversations: [] };
		const view = await testing.openTasks({ tasks: [asking] });
		const dialog = await openBeta(view);

		// toBeNull passes on an element here, so count them instead.
		expect(
			within(dialog).queryAllByRole("button", { name: "Answer a question" }),
		).toHaveLength(0);
	});

	it("keeps the open task in the address, and opens the one it names", async () => {
		const view = await testing.openTasks({ tasks: [asking] });
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
			tasks: [{ ...asking, ahead: 0 }],
		});
		const dialog = await openBeta(view);

		await chooseRemove(view, dialog);

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
		const view = await testing.openTasks({ tasks: [asking] });
		const dialog = await openBeta(view);
		const remove = () => chooseRemove(view, dialog);

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
			tasks: [{ ...asking, ahead: 2 }],
		});
		const dialog = await openBeta(view);

		await chooseRemove(view, dialog);

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
			tasks: [{ ...asking, lease: "held" }],
		});
		const dialog = await openBeta(view);

		await chooseRemove(view, dialog);

		const asked = await waitFor(() =>
			view.getByRole("dialog", { name: "Remove beta?" }),
		);
		expect(asked.textContent).toContain("which the page cannot stop");
		expect(testing.posts).toEqual([]);
	});
});

function setURL(url: string): void {
	(
		window as unknown as { happyDOM: { setURL(url: string): void } }
	).happyDOM.setURL(url);
}
