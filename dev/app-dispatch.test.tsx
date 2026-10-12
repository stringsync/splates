import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationState } from "../conversations";
import type { Snapshot } from "../snapshot";
import {
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	Testing,
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
	},
	{ id: "codex", name: "Codex", settings: [] },
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
		await waitFor(() => view.getByRole("tab", { name: /Conversations/ }));
		return view;
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
		(
			view.getByRole("textbox", {
				name: "Message input",
			}) as HTMLTextAreaElement
		).value;

	const posted = (path: string) =>
		testing.posts
			.filter((post) => post.path === path)
			.map((post) => JSON.parse(String(post.body ?? "{}")));

	it("starts an open todo in a new conversation with the agent picked, its reference typed in and nothing sent", async () => {
		const view = await board([]);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Fix the upload" })),
		);
		const dialog = await waitFor(() => view.getByRole("dialog"));

		await choose(
			view,
			within(dialog).getByRole("button", { name: "Start" }),
			/Codex/,
		);

		expect(location.hash).toBe("#conversations/new/codex");
		expect(composer(view)).toBe("[ARBOR TODO #3]");
		expect(posted("/api/conversations")).toEqual([]);
	});

	it("shows the conversation on a taken todo, and opens it, saying Resume once its agent stopped", async () => {
		const view = await board([
			conversation({ id: "c1", task: "alpha", status: "stopped" }),
		]);
		const card = within(
			view.getByRole("list", { name: "Uploads todos" }),
		).getAllByRole("listitem")[1] as HTMLElement;

		await act(async () =>
			fireEvent.click(
				within(card).getByRole("button", { name: "Resume alpha" }),
			),
		);

		expect(location.hash).toBe("#conversations/c1");
	});

	it("puts a conversation already going on a lane, its reference typed ahead of its draft", async () => {
		localStorage.setItem("arbor.draft.c2", "then stop");
		const view = await board(
			[conversation({ id: "c2", title: "Tidy the docs" })],
			{
				todos: [todo({ id: 3, subject: "Fix the upload", lane: 1 })],
			},
		);
		const lane = view.getByRole("region", { name: "Uploads" });
		await act(async () =>
			fireEvent.click(within(lane).getByRole("button", { name: "Start lane" })),
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
		expect(composer(view)).toBe("[ARBOR LANE 1]\n\nthen stop");
	});

	it("lists a task's conversations in its dialog, and starts another in its tree", async () => {
		const view = await board([
			conversation({ id: "c1", task: "alpha", status: "running" }),
		]);
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
		const dialog = await waitFor(() => view.getByRole("dialog"));
		expect(
			within(dialog).getByRole("button", { name: "Open alpha" }),
		).toBeTruthy();
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
				{ text: "Run `arbor claim alpha` and carry on from its ARBOR.md." },
			]),
		);
	});

	it("starts the lanes ticked with no agent on them, each in a conversation of its own, sent at once", async () => {
		const view = await board([], {
			todos: [
				todo({ id: 3, subject: "Fix the upload", lane: 1 }),
				todo({ id: 5, subject: "Sign in", lane: 2 }),
				todo({ id: 6, subject: "Bill", lane: 3, takenBy: "alpha" }),
			],
			lanes: [
				{ id: 1, name: "Uploads" },
				{ id: 2, name: "Accounts" },
				{ id: 3, name: "Billing" },
			],
		});
		testing.reply = conversation({ id: "c7", status: "starting" });
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Start lanes" })),
		);
		const ticks = await waitFor(() => view.getAllByRole("menuitemcheckbox"));
		expect(ticks.map((each) => each.textContent)).toEqual([
			"Uploads",
			"Accounts",
		]);
		expect(
			view
				.getByRole("menuitem", { name: /Claude/ })
				.hasAttribute("data-disabled"),
		).toBe(true);

		for (const tick of ticks) {
			await act(async () => fireEvent.click(tick));
		}
		await act(async () =>
			fireEvent.click(view.getByRole("menuitem", { name: /Codex/ })),
		);

		expect(posted("/api/conversations")).toEqual([
			{ agent: "codex", task: null, settings: {} },
			{ agent: "codex", task: null, settings: {} },
		]);
		await waitFor(() =>
			expect(posted("/api/conversations/c7/prompt")).toEqual([
				{ text: "[ARBOR LANE 1]" },
				{ text: "[ARBOR LANE 2]" },
			]),
		);
		expect(location.hash).not.toContain("conversations");
	});

	it("offers a todo's assigned agent first, on its model, and assigns one from the dialog", async () => {
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
		expect(
			within(dialog).getByRole("button", { name: "Assignee" }).textContent,
		).toContain("Claude · Haiku");

		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: "Start" })),
		);
		const items = await waitFor(() => view.getAllByRole("menuitem"));
		expect(items[0]?.textContent).toBe("Claude · Haikuassigned");
		await act(async () => fireEvent.click(items[0] as HTMLElement));

		expect(location.hash).toBe("#conversations/new/claude?model=haiku");
		testing.reply = conversation({ id: "c9", status: "starting" });
		const box = view.getByRole("textbox", { name: "Message input" });
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
		expect(posted("/api/conversations")).toEqual([
			{ agent: "claude", task: null, settings: {}, model: "haiku" },
		]);
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
			fireEvent.click(within(dialog).getByRole("button", { name: "Assignee" })),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("menuitemcheckbox", { name: /Codex/ })),
		);

		expect(posted("/api/todos/3/assignee")).toEqual([{ agent: "codex" }]);
	});

	it("starts a lane with its assigned agent, the agent picked taking the rest", async () => {
		const view = await board([], {
			todos: [
				todo({ id: 3, subject: "Fix the upload", lane: 1 }),
				todo({ id: 5, subject: "Sign in", lane: 2 }),
			],
			lanes: [
				{
					id: 1,
					name: "Uploads",
					assignee: { agent: "claude", model: "opus" },
				},
				{ id: 2, name: "Accounts" },
			],
		});
		testing.reply = conversation({ id: "c7", status: "starting" });
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Start lanes" })),
		);
		const ticks = await waitFor(() => view.getAllByRole("menuitemcheckbox"));
		expect(ticks[0]?.textContent).toBe("UploadsClaude · Opus");
		for (const tick of ticks) {
			await act(async () => fireEvent.click(tick));
		}
		expect(
			view.getByText("Start 1 lane with no agent assigned with"),
		).toBeTruthy();
		await act(async () =>
			fireEvent.click(view.getByRole("menuitem", { name: /Codex/ })),
		);

		expect(posted("/api/conversations")).toEqual([
			{ agent: "claude", task: null, settings: {}, model: "opus" },
			{ agent: "codex", task: null, settings: {} },
		]);
	});
});
