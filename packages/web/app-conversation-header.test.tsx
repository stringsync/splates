import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	setSystemTime,
} from "bun:test";
import {
	act,
	cleanup,
	clickShown,
	conversation,
	details,
	fireEvent,
	message,
	openRow,
	Testing,
	todo,
	tool,
	waitFor,
	within,
} from "./testing";

describe("App's conversation header", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("rings how full the context is, opening on what the session read, wrote, and cost", async () => {
		const view = await testing.openConversations([
			conversation({
				id: "c1",
				task: "alpha",
				title: "Fix login",
				usage: {
					context: { used: 84_000, size: 200_000 },
					input: 1_234_567,
					cached: 1_200_000,
					output: 34_000,
					cost: { amount: 3.214, currency: "USD", said: 3.214 },
					limits: [],
				},
			}),
			conversation({ id: "c2", title: "Look around" }),
		]);

		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "42% of context used" }),
			),
		);
		const card = await waitFor(
			() => view.getByRole("region", { name: "Context" }).parentElement,
		);
		expect(
			[...(card?.querySelectorAll("section") ?? [])].map(
				(section) => section.textContent,
			),
		).toEqual([
			"Context42%•84k / 200k",
			"Tokens1.2M in•34k out1.2M of those in from cache",
			"Cost3.21 USD",
		]);
		// Nothing to show before the agent says.
		await openRow(view, "Look around");
		expect(view.queryByRole("button", { name: /of context used/ })).toBeNull();
	});

	// scry-ignore simple-test-setup: the tasks and todos it opens with are what it takes up, and no other test opens with them
	it("takes up a task no conversation runs in, or an open todo, from the branch atop a main-tree conversation's widgets", async () => {
		const view = await testing.openConversations(
			[
				conversation({ id: "c1", title: "Look around" }),
				conversation({ id: "c2", task: "alpha", title: "Fix login" }),
			],
			"c1",
			{
				tasks: [
					details({ task: "alpha" }),
					details({ task: "beta" }),
					details({ task: "gamma", dispatched: true }),
				],
				todos: [
					todo({ id: 12, subject: "Retry the upload on a 413", position: 2 }),
					todo({ id: 14, subject: "Show the size limit", takenBy: "limits" }),
					todo({ id: 9, subject: "Name the upload", position: 1 }),
				],
			},
		);
		const open = async () =>
			act(async () =>
				fireEvent.click(
					within(view.getByRole("navigation", { name: "actions" })).getByRole(
						"button",
						{ name: "main" },
					),
				),
			);

		await open();
		const items = await waitFor(() => view.getAllByRole("menuitem"));
		// alpha has its conversation, gamma is handed to an agent, and 14 is taken.
		expect(items.map((each) => each.textContent)).toEqual([
			"beta",
			"Name the upload#9",
			"Retry the upload on a 413#12",
		]);
		await act(async () => fireEvent.click(items[0] as HTMLElement));
		await open();
		await clickShown(() =>
			view.getByRole("menuitem", { name: /Retry the upload/ }),
		);
		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{
				method: "POST",
				body: {
					text: "[SPLATES TASK beta]",
				},
			},
			{ method: "POST", body: { text: "[SPLATES TASK #12]" } },
		]);
	});

	it("offers its actions in a panel just right of its messages, its task's changes among them, closing them on Escape", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", task: "alpha", title: "Fix login" }),
			conversation({ id: "c2", title: "Look around" }),
		]);
		const overview = view.getByRole("navigation", { name: "actions" });

		await act(async () =>
			fireEvent.click(
				within(overview).getByRole("button", { name: /Review changes/ }),
			),
		);
		await waitFor(() =>
			view.getByRole("complementary", { name: "changes in alpha" }),
		);
		await act(async () => fireEvent.keyDown(document.body, { key: "Escape" }));
		expect(view.queryByRole("complementary")).toBeNull();

		await openRow(view, "Look around");
		const main = view.getByRole("navigation", { name: "actions" });
		expect(
			within(main)
				.getAllByRole("button")
				.map((button) => button.textContent),
		).toEqual([
			"main",
			"Terminal⌃`",
			"Defer",
			"Keep this",
			"Show timestamps",
			"Archive⌥⌘⌫",
		]);
	});

	it("floats its widgets over the thread where they cannot dock, from the one button in its header or ⌥⌘/, until Escape, a click outside, or an action", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", task: "alpha", title: "Fix login" }),
		]);
		const toggle = view.getByRole("button", { name: "Widgets" });
		const widgets = view.getByRole("region", { name: "widgets" });

		// The widgets' button in place of one per action.
		expect(
			within(toggle.closest("header") as HTMLElement).queryByRole("button", {
				name: /Terminal|Archive|Background/,
			}),
		).toBeNull();
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		expect(widgets.inert).toBe(true);

		await act(async () => fireEvent.click(toggle));
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
		expect(widgets.inert).toBe(false);
		await act(async () => fireEvent.keyDown(document.body, { key: "Escape" }));
		expect(toggle.getAttribute("aria-expanded")).toBe("false");

		await act(async () =>
			fireEvent.keyDown(document.body, {
				code: "Slash",
				altKey: true,
				metaKey: true,
			}),
		);
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
		await act(async () => fireEvent.pointerDown(document.body));
		expect(toggle.getAttribute("aria-expanded")).toBe("false");

		await act(async () => fireEvent.click(toggle));
		await act(async () =>
			fireEvent.click(
				within(widgets).getByRole("button", { name: /Terminal/ }),
			),
		);
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
	});

	it("pauses a running agent from the actions card, saying so until its checkpoint ends", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", title: "Fix login", status: "running" }),
		]);
		const actions = () => view.getByRole("navigation", { name: "actions" });

		await act(async () =>
			fireEvent.click(within(actions()).getByRole("button", { name: "Pause" })),
		);
		expect(testing.posted("/api/conversations/c1/pause")).toEqual([
			{ method: "POST", body: {} },
		]);

		await testing.say(
			conversation({
				id: "c1",
				title: "Fix login",
				status: "running",
				checkpoint: "asked",
				pausing: true,
			}),
		);
		expect(
			within(actions()).queryByRole("button", { name: "Pause" }),
		).toBeNull();
		expect(within(actions()).getByText("Pausing…")).toBeTruthy();

		await testing.say(conversation({ id: "c1", title: "Fix login" }));
		expect(within(actions()).queryByText(/Paus/)).toBeNull();
	});

	it("says an agent has not checkpointed once a pause has waited three minutes", async () => {
		const view = await testing.openConversations([
			conversation({
				id: "c1",
				title: "Fix login",
				status: "running",
				checkpoint: "asked",
				pausing: true,
			}),
		]);
		const actions = () => view.getByRole("navigation", { name: "actions" });
		expect(within(actions()).getByText("Pausing…")).toBeTruthy();
		expect(within(actions()).queryByText(/not checkpointed/)).toBeNull();

		const real = Date.now();
		setSystemTime(new Date(real + 3 * 60_000 + 1_000));
		try {
			expect(
				await within(actions()).findByText(/not checkpointed/),
			).toBeTruthy();
		} finally {
			setSystemTime();
		}
	});

	it("requests a project-note draft without interrupting a running turn", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", title: "Project decisions", status: "running" }),
		]);
		const actions = () => view.getByRole("navigation", { name: "actions" });
		await act(async () =>
			fireEvent.click(
				within(actions()).getByRole("button", { name: "Keep this" }),
			),
		);
		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{ method: "POST", body: { text: "[SPLATES KEEP]" } },
		]);
		expect(testing.posted("/api/conversations/c1/send-now")).toEqual([]);

		await testing.say(conversation({ id: "c1", title: "Project decisions" }));
		expect(
			within(actions()).getByRole("button", { name: "Keep this" }),
		).toBeTruthy();

		await testing.say(
			conversation({
				id: "c1",
				title: "Project decisions",
				status: "running",
				checkpoint: "asked",
			}),
		);
		expect(
			within(actions()).queryByRole("button", { name: "Keep this" }),
		).toBeNull();

		await testing.say(
			conversation({
				id: "c1",
				title: "Project decisions",
				archived: true,
			}),
		);
		expect(
			within(actions()).queryByRole("button", { name: "Keep this" }),
		).toBeNull();
	});

	it("defers what the person last asked from under Pause, stopping the turn so the agent saves its work", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", title: "Fix login", status: "running" }),
		]);
		const actions = view.getByRole("navigation", { name: "actions" });

		await act(async () =>
			fireEvent.click(within(actions).getByRole("button", { name: "Defer" })),
		);
		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/send-now")).toHaveLength(1),
		);
		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{ method: "POST", body: { text: "[SPLATES DEFER]" } },
		]);
	});

	it("offers Defer whether or not the agent is working, though not while it checkpoints", async () => {
		const view = await testing.openConversations([
			conversation({
				id: "c1",
				title: "Fix login",
				messages: [message("user", "Fix the login form")],
			}),
		]);
		const actions = () => view.getByRole("navigation", { name: "actions" });
		const defer = () =>
			within(actions()).queryByRole("button", { name: "Defer" });

		await act(async () => fireEvent.click(defer() as HTMLElement));
		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{ method: "POST", body: { text: "[SPLATES DEFER]" } },
		]);

		await testing.say(
			conversation({
				id: "c1",
				title: "Fix login",
				status: "stopped",
				checkpoint: "done",
				messages: [
					message("user", "Fix the login form"),
					message("user", "[SPLATES CHECKPOINT]"),
					message("agent", "Checkpointed."),
				],
			}),
		);
		expect(
			within(actions()).getByRole("button", { name: "Resume" }),
		).toBeTruthy();
		expect(defer()).toBeTruthy();

		await testing.say(
			conversation({
				id: "c1",
				title: "Fix login",
				status: "running",
				checkpoint: "asked",
			}),
		);
		expect(defer()).toBeNull();
	});

	it("resumes an agent from the actions card once the person's last word paused it", async () => {
		const view = await testing.openConversations([
			conversation({
				id: "c1",
				title: "Fix login",
				messages: [
					message("user", "Fix the login form"),
					message("agent", "On it."),
					message("user", "[SPLATES CHECKPOINT]"),
					message("agent", "Checkpointed."),
				],
			}),
		]);
		const actions = () => view.getByRole("navigation", { name: "actions" });

		await act(async () =>
			fireEvent.click(
				within(actions()).getByRole("button", { name: "Resume" }),
			),
		);
		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{ method: "POST", body: { text: "[SPLATES RESUME]" } },
		]);

		await testing.say(
			conversation({
				id: "c1",
				title: "Fix login",
				messages: [
					message("user", "[SPLATES CHECKPOINT]"),
					message("user", "Carry on"),
				],
			}),
		);
		expect(
			within(actions()).queryByRole("button", { name: "Resume" }),
		).toBeNull();
	});

	it("says a budget stop waits on the worker budget, beside Resume", async () => {
		const view = await testing.openConversations([
			conversation({
				id: "c1",
				title: "Fix login",
				status: "stopped",
				checkpoint: "done",
				budgetStop: "daily limit $5.00 reached",
				messages: [
					message("user", "[SPLATES CHECKPOINT]"),
					message("agent", "Checkpointed."),
				],
			}),
		]);
		const actions = view.getByRole("navigation", { name: "actions" });

		expect(
			within(actions).getByText("Waits on the worker budget"),
		).toBeTruthy();
		expect(within(actions).getByText("daily limit $5.00 reached")).toBeTruthy();
		expect(
			within(actions).getByRole("button", { name: "Resume" }),
		).toBeTruthy();
	});

	it("lists the commands it left in the background in a card of their own, newest first, the latest three until expanded", async () => {
		const command = (id: string, name: string) => ({
			id,
			name,
			command: null,
			subagent: null,
			state: "completed" as const,
			output: null,
		});
		const view = await testing.openConversations([
			conversation({
				id: "c1",
				title: "Serve it",
				background: [
					command("b1", "Install"),
					command("b2", "Build"),
					{ ...command("b3", "Run the tests"), state: "failed" },
					{
						...command("b4", "Start the dev server"),
						command: "bun dev",
						state: "running",
					},
					command("b5", "Lint"),
				],
			}),
		]);
		const card = view.getByRole("region", { name: "background commands" });
		const rows = () =>
			within(card)
				.getAllByRole("listitem")
				.map((item) => [
					within(item).getByRole("button").title,
					item.textContent,
				]);
		expect(within(card).getByRole("heading").textContent).toBe(
			"Background1 running",
		);
		expect(rows()).toEqual([
			["Lint", "LintDone"],
			["bun dev", "Start the dev serverRunning"],
			["Run the tests", "Run the testsFailed"],
		]);

		const toggle = within(card).getByRole("button", { name: "Show 2 more" });
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		await act(async () => fireEvent.click(toggle));
		expect(toggle.textContent).toBe("Show fewer");
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
		expect(rows().map(([title]) => title)).toEqual([
			"Lint",
			"bun dev",
			"Run the tests",
			"Build",
			"Install",
		]);

		await testing.say(conversation({ id: "c1", title: "Serve it" }));
		expect(
			view.queryByRole("region", { name: "background commands" }),
		).toBeNull();
	});

	it("puts a line in the thread where it left each command in the background, saying how each ended", async () => {
		const left = (id: string, command: string, exitCode: number | null) =>
			tool({
				id: `t-${id}`,
				title: command,
				command,
				background: {
					id,
					state:
						exitCode === null
							? "running"
							: exitCode === 0
								? "completed"
								: "failed",
					exitCode,
					until: null,
				},
			});
		const view = await testing.openConversations([
			conversation({
				id: "c1",
				title: "Serve it",
				messages: [
					message("user", "serve it and test it"),
					message(
						"agent",
						left("b1", "bun dev", null),
						left("b2", "bun test", 1),
						left("b3", "bun run lint", 0),
						"Started them.",
					),
				],
				background: [
					{
						id: "b1",
						name: "Start the dev server",
						command: "bun dev",
						subagent: null,
						state: "running",
						output: "/tmp/b1.output",
					},
				],
			}),
		]);

		const lines = view.getAllByRole("note", { name: "background command" });
		expect(lines.map((line) => line.textContent)).toEqual([
			"Running in the backgroundShow",
			"Failed in the background, exit 1Show",
			"Ran in the background, exit 0Show",
		]);
		const failed = within(lines[1] as HTMLElement);
		await act(async () =>
			fireEvent.click(failed.getByRole("button", { name: "Show" })),
		);
		expect(failed.getByText("bun test").tagName).toBe("CODE");
		await act(async () =>
			fireEvent.click(failed.getByRole("button", { name: "Hide" })),
		);
		expect(failed.queryByText("bun test")).toBeNull();
	});

	it("marks a conversation with a spinner in the sidebar while it has a command running, without listing the command", async () => {
		const running = {
			id: "b1",
			name: "Start the dev server",
			command: "bun dev",
			subagent: null,
			state: "running" as const,
			output: "/tmp/b1.output",
		};
		const view = await testing.openConversations([
			conversation({
				id: "c1",
				title: "Serve it",
				background: [running],
			}),
		]);
		const sidebar = view.getByRole("navigation", { name: "conversations" });
		expect(
			within(sidebar).getByRole("status", {
				name: "background commands running",
			}),
		).toBeTruthy();
		expect(
			within(sidebar).queryByRole("button", { name: /Start the dev server/ }),
		).toBeNull();

		await testing.say(
			conversation({
				id: "c1",
				title: "Serve it",
				background: [{ ...running, state: "completed" }],
			}),
		);
		expect(
			within(sidebar).queryByRole("status", {
				name: "background commands running",
			}),
		).toBeNull();
	});

	it("names the subagent that started a command in its row's title", async () => {
		const view = await testing.openConversations([
			conversation({
				id: "c1",
				title: "Serve it",
				background: [
					{
						id: "b1",
						name: "Watch the build",
						command: "bun build --watch",
						subagent: { id: "a1", title: "Check the build" },
						state: "running",
						output: null,
					},
				],
			}),
		]);

		expect(
			within(
				view.getByRole("region", { name: "background commands" }),
			).getByRole("button", { name: /Watch the build/ }).title,
		).toBe("bun build --watch\nStarted by Check the build");
	});

	// scry-ignore simple-test-setup: only this test reads a command's output, so it holds its own rather than share one every test ignores
	it("opens a command's output beside the page from its row in the card, with a Stop while it runs", async () => {
		testing.outputs = { b1: "listening on 3000" };
		const running = {
			id: "b1",
			name: "Start the dev server",
			command: "bun dev",
			subagent: null,
			state: "running" as const,
			output: "/tmp/b1.output",
		};
		const view = await testing.openConversations([
			conversation({ id: "c1", title: "Serve it", background: [running] }),
		]);

		const row = within(
			view.getByRole("region", { name: "background commands" }),
		).getByRole("button", { name: /Start the dev server/ });
		await act(async () => fireEvent.click(row));
		// The pane is a chunk fetched as it first opens.
		const pane = await waitFor(() =>
			view.getByRole("complementary", { name: "background command" }),
		);
		expect(within(pane).getByRole("heading").textContent).toBe(
			"Start the dev server",
		);
		await waitFor(() =>
			expect(within(pane).getByTestId("output").textContent).toContain(
				"$ bun devlistening on 3000",
			),
		);
		await act(async () =>
			fireEvent.click(within(pane).getByRole("button", { name: "Stop" })),
		);
		expect(testing.posted("/api/conversations/c1/stop-background")).toEqual([
			{ method: "POST", body: { background: "b1" } },
		]);
		expect(within(pane).getByRole("button", { name: "Stopping" })).toBeTruthy();

		await testing.say(
			conversation({
				id: "c1",
				title: "Serve it",
				background: [{ ...running, state: "stopped" }],
			}),
		);
		expect(within(pane).queryByRole("button", { name: /Stop/ })).toBeNull();
		expect(within(pane).getByRole("status").textContent).toBe("Stopped");
		await act(async () =>
			fireEvent.click(within(pane).getByRole("button", { name: "Close" })),
		);
		expect(
			view.queryByRole("complementary", { name: "background command" }),
		).toBeNull();

		await act(async () => fireEvent.click(row));
		expect(
			view.getByRole("complementary", { name: "background command" }),
		).toBeTruthy();
	});
});
