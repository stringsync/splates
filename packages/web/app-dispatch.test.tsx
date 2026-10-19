import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import type { Snapshot } from "@stringsync/splates-server/tasks";
import {
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	Testing,
	textIn,
	todo,
	waitFor,
	within,
} from "./testing";

const AGENTS = [
	{
		id: "claude",
		name: "Claude",
		models: [
			{ id: "opus", name: "Opus" },
			{ id: "haiku", name: "Haiku" },
		],
		settings: [],
		limits: [],
	},
	{ id: "codex", name: "Codex", settings: [], limits: [] },
];

describe("App's controls that put agents to work", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	/** Opens the board with conversations on, holding `held`. */
	const board = async (
		held: ConversationState[],
		overrides: Partial<Snapshot> = {},
	) => {
		testing.talk = { agents: AGENTS, conversations: held };
		const view = await testing.open({
			tasks: [details({ task: "alpha" })],
			todos: [
				todo({ id: 3, subject: "Fix the upload", lane: 1 }),
				todo({ id: 4, subject: "Retry on 413", lane: 1, takenBy: "alpha" }),
			],
			lanes: [{ id: 1, name: "Uploads" }],
			...overrides,
		});
		// Conversations come in on their own feed, after the board.
		await waitFor(() =>
			view.getByRole("button", { name: /^(\d+|Nothing) waiting on you$/ }),
		);
		return view;
	};

	/** Opens task alpha's dialog from the Tasks page. */
	const taskDialog = async (view: Awaited<ReturnType<typeof board>>) => {
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Tasks/ })),
		);
		await act(async () =>
			fireEvent.click(
				within(view.getByRole("region", { name: "tasks" })).getByRole(
					"button",
					{ name: /alpha/ },
				),
			),
		);
		return waitFor(() => view.getByRole("dialog"));
	};

	/** Picks `item` from the menu `trigger` opens. */
	const choose = async (
		view: Awaited<ReturnType<typeof board>>,
		trigger: HTMLElement,
		item: RegExp,
	) => {
		await act(async () => fireEvent.click(trigger));
		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("menuitem", { name: item })),
			),
		);
	};

	const composer = (view: Awaited<ReturnType<typeof board>>) =>
		textIn(view.getByRole("textbox", { name: "Message input" }));

	/** The directives the composer holds as chips, each by its title. */
	const chips = (view: Awaited<ReturnType<typeof board>>) =>
		Array.from(
			view
				.getByRole("textbox", { name: "Message input" })
				.querySelectorAll<HTMLElement>('[title^="[SPLATES "]'),
			(chip) => chip.title,
		);

	const posted = (path: string) =>
		testing.posted(path).map((post) => post.body);

	it("offers one Start menu in a todo's dialog, and no row of buttons", async () => {
		const view = await board([]);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Fix the upload" })),
		);
		const dialog = await waitFor(() => view.getByRole("dialog"));

		const start = within(dialog).getByRole("button", { name: "Start" });
		expect(start.getAttribute("aria-haspopup")).toBe("menu");
		expect(
			within(dialog).queryByRole("button", { name: /^Start with/ }),
		).toBeNull();
		expect(within(dialog).queryByRole("button", { name: "Queue" })).toBeNull();
		// Its agent is one of its details, not in the way of its words.
		expect(
			within(dialog).queryByRole("button", { name: "Assignee" }),
		).toBeNull();
	});

	it("opens a taken todo as its task, the dialog the task list opens", async () => {
		const view = await board([]);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Retry on 413" })),
		);
		const dialog = await waitFor(() => view.getByRole("dialog"));

		expect(within(dialog).getByRole("heading").textContent).toBe("alpha");
		expect(
			within(dialog).queryByRole("textbox", { name: "subject" }),
		).toBeNull();
	});

	it("shows only a spinner, not its agent's logo, on a taken todo whose agent works", async () => {
		const view = await board([
			conversation({ id: "c1", task: "alpha", status: "running" }),
		]);
		const card = within(
			view.getByRole("list", { name: "Uploads tasks" }),
		).getAllByRole("listitem")[1] as HTMLElement;
		const chip = within(card).getByRole("button", { name: "Open alpha" });

		expect(within(chip).getByRole("status").getAttribute("aria-label")).toBe(
			"working",
		);
		expect(within(chip).queryByRole("img")).toBeNull();
	});

	it("shows the conversation on a taken todo, and opens it, saying Resume once its agent stopped", async () => {
		const view = await board([
			conversation({ id: "c1", task: "alpha", status: "stopped" }),
		]);
		const card = within(
			view.getByRole("list", { name: "Uploads tasks" }),
		).getAllByRole("listitem")[1] as HTMLElement;

		await act(async () =>
			fireEvent.click(
				within(card).getByRole("button", { name: "Resume alpha" }),
			),
		);

		expect(location.hash).toBe("#conversations/c1");
	});

	it("shows a queued todo's held conversation waiting in line on its card and in its dialog, and opens it", async () => {
		const view = await board(
			[
				conversation({
					id: "c1",
					title: "#3 Fix the upload",
					status: "starting",
					queued: 3,
					queue: {
						position: 1,
						of: 1,
						since: "2026-10-19T12:00:00.000Z",
						reason: "no free slot",
					},
				}),
			],
			{
				todos: [
					todo({ id: 3, subject: "Fix the upload", lane: 1, stage: "queued" }),
				],
			},
		);
		const card = within(
			view.getByRole("list", { name: "Uploads tasks" }),
		).getAllByRole("listitem")[0] as HTMLElement;

		const chip = within(card).getByRole("button", {
			name: "Open #3 Fix the upload",
		});
		expect(
			within(chip).getByRole("img", { name: "1st in line for a slot" }),
		).toBeTruthy();
		expect(
			within(card).queryByRole("img", { name: /in line for an agent/ }),
		).toBeNull();

		await act(async () =>
			fireEvent.click(
				within(card).getByRole("button", { name: /^Fix the upload/ }),
			),
		);
		const dialog = await waitFor(() => view.getByRole("dialog"));
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "Open #3 Fix the upload" }),
			),
		);

		expect(location.hash).toBe("#conversations/c1");
	});

	it("puts a conversation already going on a task, its reference held as a chip ahead of its draft", async () => {
		localStorage.setItem("splates.draft.c2", "then stop");
		const view = await board([
			conversation({ id: "c2", title: "Tidy the docs" }),
		]);
		const dialog = await taskDialog(view);
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "Start a conversation" }),
			),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() =>
					view.getByRole("menuitem", { name: "In a conversation" }),
				),
			),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() =>
					view.getByRole("menuitem", { name: /Tidy the docs/ }),
				),
			),
		);

		expect(location.hash).toBe("#conversations/c2");
		expect(chips(view)).toEqual(["[SPLATES TASK alpha]"]);
		expect(composer(view)).toBe("[SPLATES TASK alpha]\n\nthen stop");
	});

	it("lists a task's conversations in its dialog, in place of starting another", async () => {
		const view = await board([
			conversation({ id: "c1", task: "alpha", status: "running" }),
		]);
		const dialog = await taskDialog(view);
		expect(
			within(dialog).getByRole("button", { name: "Open alpha" }),
		).toBeTruthy();
		expect(
			within(dialog).queryByRole("button", { name: "Start a conversation" }),
		).toBeNull();
	});

	it("starts a conversation in a task's tree from its dialog when none is on it", async () => {
		const view = await board([]);
		const dialog = await taskDialog(view);
		testing.reply = conversation({
			id: "c9",
			task: "alpha",
			status: "starting",
		});

		await choose(
			view,
			within(dialog).getByRole("button", { name: "Start a conversation" }),
			/Claude/,
		);
		expect(location.hash).toBe("#conversations/new/claude/alpha");
		const box = view.getByRole("textbox", { name: "Message input" });
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		expect(posted("/api/conversations")).toEqual([
			{ agent: "claude", task: "alpha", settings: {} },
		]);
		await waitFor(() =>
			expect(posted("/api/conversations/c9/prompt")).toEqual([
				{ text: "[SPLATES TASK alpha]" },
			]),
		);
	});

	it("starts a todo's assigned agent from its dialog, on its model, straight away, closing the dialog", async () => {
		const view = await board([], {
			todos: [
				todo({
					id: 3,
					subject: "Fix the upload",
					lane: 1,
					assignee: { agent: "claude", model: "haiku" },
				}),
			],
		});
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Fix the upload" })),
		);
		const dialog = await waitFor(() => view.getByRole("dialog"));
		await act(async () =>
			fireEvent.click(within(dialog).getByRole("tab", { name: "Details" })),
		);
		expect(
			within(dialog).getByRole("button", { name: "Assignee" }).textContent,
		).toContain("Claude · Haiku");

		testing.reply = conversation({ id: "c9", status: "starting" });
		await choose(
			view,
			within(dialog).getByRole("button", { name: "Start" }),
			/Claude · Haiku\s*assigned/,
		);

		await waitFor(() => expect(location.hash).toBe("#conversations/c9"));
		expect(posted("/api/conversations")).toEqual([
			{
				agent: "claude",
				task: null,
				settings: {},
				model: "haiku",
				assigned: true,
			},
		]);
		await waitFor(() =>
			expect(posted("/api/conversations/c9/prompt")).toEqual([
				{ text: "[SPLATES TASK #3]" },
			]),
		);

		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Board/ })),
		);
		expect(view.queryByRole("dialog")).toBeNull();
	});

	it("starts a todo's assigned agent in one tap from its card", async () => {
		const view = await board([], {
			todos: [
				todo({
					id: 3,
					subject: "Fix the upload",
					lane: 1,
					assignee: { agent: "claude", model: "haiku" },
				}),
				todo({ id: 5, subject: "Unassigned", lane: 1 }),
				todo({
					id: 6,
					subject: "Taken",
					lane: 1,
					takenBy: "alpha",
					assignee: { agent: "claude" },
				}),
			],
		});
		// Only the open todo with an agent on it offers one.
		expect(
			view
				.getAllByRole("button", { name: /^Start with / })
				.map((each) => each.getAttribute("aria-label")),
		).toEqual(["Start with Claude · Haiku"]);

		testing.reply = conversation({ id: "c9", status: "starting" });
		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "Start with Claude · Haiku" }),
			),
		);
		await waitFor(() => expect(location.hash).toBe("#conversations/c9"));
		expect(posted("/api/conversations")).toEqual([
			{
				agent: "claude",
				task: null,
				settings: {},
				model: "haiku",
				assigned: true,
			},
		]);
		await waitFor(() =>
			expect(posted("/api/conversations/c9/prompt")).toEqual([
				{ text: "[SPLATES TASK #3]" },
			]),
		);
	});

	it("puts an agent on a todo from its dialog, or any agent", async () => {
		const view = await board([], {
			todos: [todo({ id: 3, subject: "Fix the upload", lane: 1 })],
		});
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Fix the upload" })),
		);
		const dialog = await waitFor(() => view.getByRole("dialog"));
		await act(async () =>
			fireEvent.click(within(dialog).getByRole("tab", { name: "Details" })),
		);

		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: "Assignee" })),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("menuitemcheckbox", { name: /Codex/ })),
		);

		expect(posted("/api/todos/3/assignee")).toEqual([{ agent: "codex" }]);
	});
});
