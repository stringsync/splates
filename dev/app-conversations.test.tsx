import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { Checkpoint, ConversationState, Setting } from "../conversations";
import type { Snapshot } from "../snapshot";
import type { ProjectChoice } from "./api";
import type { AgentChoice } from "./conversation-feed";
import {
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	message,
	Testing,
	todo,
	tool,
	waitFor,
	within,
} from "./testing";
import { blockedReply } from "./unanswered";

/** Sizes the window, as a phone held upright or a laptop. */
const resize = (width: number, height: number) =>
	(
		window as unknown as {
			happyDOM: { setViewport(size: { width: number; height: number }): void };
		}
	).happyDOM.setViewport({ width, height });

const AGENTS: AgentChoice[] = [
	{ id: "claude", name: "Claude", settings: [] },
	{ id: "codex", name: "Codex", settings: [] },
];

describe("App's conversations", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	/** Opens the page with conversations on, holding `held`, on their tab. */
	const conversations = async (
		held: ConversationState[],
		open: string | null = held[0]?.id ?? null,
		overrides: Partial<Snapshot> = {},
		agents: AgentChoice[] = AGENTS,
	) => {
		testing.talk = { agents, conversations: held };
		const view = await testing.open({
			tasks: [details({ task: "alpha" })],
			...overrides,
		});
		const tab = await waitFor(() =>
			view.getByRole("tab", { name: /Conversations/ }),
		);
		await act(async () => fireEvent.click(tab));
		if (open !== null) {
			const nav = view.getByRole("navigation", { name: "conversations" });
			const item = within(nav)
				.getAllByRole("listitem")
				.flatMap((row) => within(row).getAllByRole("button"))
				.find((button) => button.textContent?.includes(nameIn(held, open)));
			if (item === undefined) {
				throw new Error(`no conversation ${open} listed`);
			}
			await act(async () => fireEvent.click(item));
		}
		return view;
	};

	/** Opens the new conversation screen with `agent`, from the sidebar. */
	const newWith = async (
		view: Awaited<ReturnType<typeof conversations>>,
		agent: string,
	) => {
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "New" })),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() =>
					view.getByRole("menuitem", { name: new RegExp(agent) }),
				),
			),
		);
	};
	/** Picks an option of a Select: Base UI picks on the pointer let go. */
	const pick = (option: HTMLElement) =>
		act(async () => {
			fireEvent.pointerDown(option, { pointerType: "mouse" });
			fireEvent.mouseDown(option);
			fireEvent.pointerUp(option, { pointerType: "mouse" });
			fireEvent.mouseUp(option);
			fireEvent.click(option);
		});

	const nameIn = (held: ConversationState[], id: string) => {
		const found = held.find((each) => each.id === id);
		const opening = found?.messages
			.filter((message) => message.role === "user")
			.flatMap((message) => message.parts)
			.flatMap((part) => (part.type === "text" ? [part.text.trim()] : []))
			.find((text) => text !== "")
			?.split("\n")[0];
		return (
			found?.name ?? found?.task ?? found?.title ?? opening ?? "Not started"
		);
	};

	const posted = (path: string) =>
		testing.posts
			.filter((post) => post.path === path)
			.map((post) => ({
				method: post.method,
				body: JSON.parse(String(post.body ?? "{}")),
			}));

	it("shows no Conversations when the server has none", async () => {
		const view = await testing.open();

		expect(view.queryByRole("tab", { name: /Conversations/ })).toBeNull();
	});

	it("lists conversations newest first, each by name with its task on hover, and archived ones apart", async () => {
		const view = await conversations(
			[
				conversation({
					id: "c1",
					task: "alpha",
					title: "Fix login",
					createdAt: "2026-10-11T10:01:00.000Z",
				}),
				conversation({
					id: "c2",
					task: null,
					title: "Look around",
					createdAt: "2026-10-11T10:02:00.000Z",
				}),
				conversation({ id: "c3", title: "Old", archived: true }),
			],
			null,
		);
		const nav = view.getByRole("navigation", { name: "conversations" });

		expect(
			within(nav)
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual(["Look around", "alpha"]);
		expect(within(nav).queryAllByRole("heading")).toEqual([]);
		expect(
			within(nav).getByRole("button", { name: "Claude alpha" }).title,
		).toBe("alpha");
		await act(async () =>
			fireEvent.click(within(nav).getByRole("button", { name: /Archived/ })),
		);
		const archived = view.getByRole("region", {
			name: "archived conversations",
		});
		expect(archived.textContent).toContain("Old");
		expect(location.hash).toBe("#conversations/archived");
	});

	it("shows the newest 50 archived conversations, and 50 more for each Show older", async () => {
		const view = await conversations(
			[
				conversation({ id: "live", title: "Live" }),
				...Array.from({ length: 120 }, (_, i) =>
					conversation({ id: `a${i}`, title: `Put away ${i}`, archived: true }),
				),
			],
			null,
		);
		const nav = view.getByRole("navigation", { name: "conversations" });
		await act(async () =>
			fireEvent.click(within(nav).getByRole("button", { name: /Archived/ })),
		);
		const archived = view.getByRole("region", {
			name: "archived conversations",
		});
		const listed = () => within(archived).getAllByRole("listitem");

		expect(listed()).toHaveLength(50);
		expect(listed()[0]?.textContent).toContain("Put away 0");
		await act(async () =>
			fireEvent.click(
				within(archived).getByRole("button", { name: "Show older (70)" }),
			),
		);
		expect(listed()).toHaveLength(100);
		await act(async () =>
			fireEvent.click(
				within(archived).getByRole("button", { name: "Show older (20)" }),
			),
		);
		expect(listed()).toHaveLength(120);
		expect(
			within(archived).queryByRole("button", { name: /Show older/ }),
		).toBeNull();
	});

	it("nests a part's conversations under the task it was handed out from", async () => {
		const view = await conversations(
			[
				conversation({
					id: "c1",
					task: "alpha",
					createdAt: "2026-10-11T10:01:00.000Z",
				}),
				conversation({
					id: "c2",
					task: null,
					title: "Look around",
					createdAt: "2026-10-11T10:02:00.000Z",
				}),
				conversation({
					id: "c3",
					agent: "codex",
					task: "alpha-api",
					createdAt: "2026-10-11T10:03:00.000Z",
				}),
			],
			null,
			{
				tasks: [
					details({ task: "alpha" }),
					details({ task: "alpha-api", base: "task/alpha" }),
				],
			},
		);
		const list = view.getByRole("list", { name: "conversation list" });

		expect(
			within(list)
				.getAllByRole("listitem")
				.filter((item) => item.parentElement === list)
				.map((item) => item.textContent),
		).toEqual(["Look around", "alphaalpha-api"]);
		expect(
			within(view.getByRole("list", { name: "parts of alpha" }))
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual(["alpha-api"]);
	});

	it("stands in for a missing name, muted, with what the person first said, else Not started", async () => {
		const view = await conversations(
			[
				conversation({
					id: "c1",
					task: null,
					messages: [
						message("user", "\n fix the login\nit loops"),
						message("agent", "On it"),
					],
					createdAt: "2026-10-11T10:01:00.000Z",
				}),
				conversation({
					id: "c2",
					task: null,
					createdAt: "2026-10-11T10:02:00.000Z",
				}),
				conversation({
					id: "c3",
					task: null,
					title: "Fix login",
					messages: [message("user", "fix the login")],
					createdAt: "2026-10-11T10:00:00.000Z",
				}),
			],
			null,
		);
		const nav = view.getByRole("navigation", { name: "conversations" });
		const names = within(nav)
			.getAllByRole("listitem")
			.map((item) => item.querySelector("span.truncate") as HTMLElement);

		expect(names.map((name) => name.textContent)).toEqual([
			"Not started",
			"fix the login",
			"Fix login",
			"alpha",
		]);
		expect(names.map((name) => name.classList.contains("italic"))).toEqual([
			true,
			true,
			false,
			false,
		]);
	});

	it("names the branch under an open conversation's title, the trunk's for the main tree", async () => {
		const view = await conversations([
			conversation({ id: "c1", task: "alpha", title: "Fix login" }),
			conversation({ id: "c2", title: "Look around" }),
		]);
		const branch = () =>
			view.getByRole("img", { name: "branch" }).parentElement?.textContent;

		expect(branch()).toBe("task/alpha");
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Claude Look around" })),
		);
		expect(branch()).toBe("main");
	});

	it("takes up a task no conversation runs in, or an open todo, from a main-tree conversation's branch", async () => {
		const view = await conversations(
			[
				conversation({ id: "c1", title: "Look around" }),
				conversation({ id: "c2", task: "alpha", title: "Fix login" }),
			],
			"c1",
			{
				tasks: [
					details({ task: "alpha" }),
					details({ task: "beta", status: "escalated" }),
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
					view.getByRole("button", { name: "Take up a task or todo" }),
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
		await act(async () =>
			fireEvent.click(
				await waitFor(() =>
					view.getByRole("menuitem", { name: /Retry the upload/ }),
				),
			),
		);
		expect(posted("/api/conversations/c1/prompt")).toEqual([
			{
				method: "POST",
				body: {
					text: "[ARBOR TASK beta]",
				},
			},
			{ method: "POST", body: { text: "[ARBOR TODO #12]" } },
		]);
	});

	it("offers its actions in a card in its upper right, its task's changes among them, closing them on Escape", async () => {
		const view = await conversations([
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

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Claude Look around" })),
		);
		const main = view.getByRole("navigation", { name: "actions" });
		expect(
			within(main)
				.getAllByRole("button")
				.map((button) => button.textContent),
		).toEqual(["TerminalCtrl+`", "Archive"]);
	});

	it("archives a stopped conversation from the list, with the agent's mark in place of its name", async () => {
		const view = await conversations(
			[
				conversation({
					id: "c1",
					task: "alpha",
					title: "Fix login",
					status: "stopped",
				}),
			],
			null,
		);
		const nav = view.getByRole("navigation", { name: "conversations" });

		expect(within(nav).getByRole("img", { name: "Claude" })).toBeTruthy();
		await act(async () =>
			fireEvent.click(
				within(nav).getByRole("button", { name: "Archive alpha" }),
			),
		);

		expect(posted("/api/conversations/c1/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
	});

	it("asks before archiving a conversation whose agent is still running", async () => {
		const view = await conversations(
			[
				conversation({
					id: "c1",
					task: "alpha",
					title: "Fix login",
					status: "running",
				}),
			],
			null,
		);
		const nav = view.getByRole("navigation", { name: "conversations" });
		const archive = () =>
			act(async () =>
				fireEvent.click(
					within(nav).getByRole("button", { name: "Archive alpha" }),
				),
			);

		await archive();
		const dialog = view.getByRole("dialog", { name: "Archive alpha?" });
		expect(dialog.textContent).toContain("still running");
		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" })),
		);
		expect(posted("/api/conversations/c1/archived")).toEqual([]);

		await archive();
		await act(async () =>
			fireEvent.click(
				within(view.getByRole("dialog", { name: "Archive alpha?" })).getByRole(
					"button",
					{ name: "Archive" },
				),
			),
		);
		expect(posted("/api/conversations/c1/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
	});

	/** A conversation of `slug`'s, as the projects route lists it. */
	const live = (
		id: string,
		name: string,
		checkpoint: Checkpoint | null = null,
	) => ({
		id,
		name,
		status: checkpoint === "done" ? "stopped" : "running",
		checkpoint,
	});
	const project = (
		slug: string,
		listed: ProjectChoice["conversations"],
		here = false,
	): ProjectChoice => ({
		slug,
		root: `/code/${slug}`,
		gone: false,
		here,
		conversations: listed,
	});

	it("checkpoints the projects picked in a dialog, this one picked to start, then what follows", async () => {
		testing.projects = [
			project("webappwiz", [live("c1", "Fix login")], true),
			project("shop", [live("s1", "Fix cart"), live("s2", "Fix tax")]),
			project("quiet", []),
		];
		const view = await conversations(
			[conversation({ id: "c1", title: "Fix login", status: "running" })],
			null,
		);
		const nav = view.getByRole("navigation", { name: "conversations" });

		await act(async () =>
			fireEvent.click(
				await waitFor(() =>
					within(nav).getByRole("button", { name: "Checkpoint" }),
				),
			),
		);
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
		expect(posted("/api/checkpoint")).toEqual([]);

		await act(async () => fireEvent.click(box("shop")));
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("radio", { name: /^Checkpoint and restart/ }),
			),
		);
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "Checkpoint 2 projects" }),
			),
		);

		expect(posted("/api/checkpoint")).toEqual([
			{
				method: "POST",
				body: { projects: ["webappwiz", "shop"], after: "restart" },
			},
		]);
	});

	it("shows Checkpoint while no project has an agent running, with nothing to pick", async () => {
		testing.projects = [project("webappwiz", [], true)];
		const view = await conversations(
			[conversation({ id: "c2", title: "Old one", status: "stopped" })],
			null,
		);

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Checkpoint" })),
		);

		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Checkpoint" }),
		);
		expect(within(dialog).getByText("No agent is running.")).toBeTruthy();
		expect(within(dialog).queryByRole("checkbox")).toBeNull();
	});

	it("says how each agent of a checkpoint under way gets on", async () => {
		testing.projects = [
			project("webappwiz", [live("c1", "Fix login")], true),
			project("shop", [
				live("s1", "One", "done"),
				live("s2", "Two", "asked"),
				live("s3", "Three", "unanswered"),
			]),
		];
		const view = await conversations(
			[conversation({ id: "c1", title: "Fix login", status: "running" })],
			null,
		);

		await act(async () =>
			fireEvent.click(
				await waitFor(() =>
					view.getByRole("button", { name: "Checkpointing 2 of 3" }),
				),
			),
		);

		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Checkpoint under way" }),
		);
		expect(within(dialog).queryByRole("checkbox")).toBeNull();
		expect(within(dialog).getByText("Checkpointed")).toBeTruthy();
		expect(within(dialog).getByText("Checkpointing")).toBeTruthy();
		expect(within(dialog).getByText("No response")).toBeTruthy();
		expect(within(dialog).queryByRole("button", { name: "Resume" })).toBeNull();
	});

	it("slides on to Done once the checkpoint ends, opening on its own, and resumes its agents", async () => {
		testing.projects = [
			project("webappwiz", [live("c1", "One", "asked")], true),
		];
		const view = await conversations(
			[conversation({ id: "c1", title: "One", status: "running" })],
			null,
		);
		await waitFor(() =>
			view.getByRole("button", { name: "Checkpointing 0 of 1" }),
		);
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

		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Checkpoint done" }),
		);
		expect(dialog.textContent).toContain("1 agent checkpointed and stopped.");
		expect(
			within(dialog).queryByRole("button", { name: "Retry missed" }),
		).toBeNull();
		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: "Resume" })),
		);
		expect(posted("/api/checkpoint/resume")).toEqual([
			{ method: "POST", body: {} },
		]);
	});

	it("retries those a checkpoint missed, restarts, or closes, leaving them stopped", async () => {
		testing.projects = [
			project(
				"webappwiz",
				[live("c1", "One", "done"), live("c2", "Two", "asked")],
				true,
			),
		];
		const view = await conversations(
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

		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Checkpoint done" }),
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
		expect(posted("/api/checkpoint")).toEqual([
			{
				method: "POST",
				body: { projects: ["webappwiz"], after: "stop", conversations: ["c2"] },
			},
		]);
		await click("Restart");
		expect(posted("/api/checkpoint/restart")).toEqual([
			{ method: "POST", body: {} },
		]);
		await click("Close");
		expect(posted("/api/conversations/checkpoint?project=webappwiz")).toEqual([
			{ method: "DELETE", body: {} },
		]);
	});

	it("keeps a done checkpoint on the button while looking at one of its agents", async () => {
		testing.projects = [
			project("webappwiz", [live("c1", "One", "asked")], true),
		];
		const view = await conversations(
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
		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Checkpoint done" }),
		);

		await act(async () =>
			fireEvent.click(within(dialog).getByRole("link", { name: /One/ })),
		);

		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
		expect(posted("/api/conversations/checkpoint?project=webappwiz")).toEqual(
			[],
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Checkpoint done" })),
		);
		await waitFor(() => view.getByRole("dialog", { name: "Checkpoint done" }));
	});

	describe("back from a restart", () => {
		/** Opens the page on `held`, then drops the stream and brings it back. */
		const restart = async (held: ConversationState[]) => {
			await conversations(held, null);
			const reload = spyOn(location, "reload").mockImplementation(() => {});
			await act(async () => testing.talkStream?.onerror?.());
			await act(async () => testing.talkStream?.onerror?.());
			testing.talk = { agents: AGENTS, conversations: held };
			await act(async () => testing.talkStream?.onopen?.());
			return reload;
		};

		it("reloads the page once each agent a checkpoint stopped has resumed", async () => {
			const stopped = (id: string) =>
				conversation({ id, status: "stopped", checkpoint: "done" });
			const reload = await restart([stopped("c1"), stopped("c2")]);

			await testing.say(conversation({ id: "c1", status: "running" }));
			expect(reload).not.toHaveBeenCalled();
			await testing.say(conversation({ id: "c2", status: "running" }));

			expect(reload).toHaveBeenCalledTimes(1);
			reload.mockRestore();
		});

		it("stays while an agent fails to resume", async () => {
			const reload = await restart([
				conversation({ id: "c1", status: "stopped", checkpoint: "done" }),
				conversation({ id: "c2", status: "stopped", checkpoint: "done" }),
			]);

			await testing.say(conversation({ id: "c1", status: "running" }));
			await testing.say(
				conversation({
					id: "c2",
					status: "failed",
					error: "agent exited",
					checkpoint: "done",
				}),
			);

			expect(reload).not.toHaveBeenCalled();
			reload.mockRestore();
		});

		it("stays when no checkpoint had stopped an agent", async () => {
			const reload = await restart([
				conversation({ id: "c1", status: "running" }),
			]);

			await testing.say(conversation({ id: "c1", status: "idle" }));

			expect(reload).not.toHaveBeenCalled();
			reload.mockRestore();
		});
	});

	it("renames a conversation from its menu", async () => {
		const view = await conversations(
			[conversation({ id: "c1", task: "alpha", title: "Fix login" })],
			null,
		);

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "More for alpha" })),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("menuitem", { name: "Rename" })),
			),
		);
		const box = await waitFor(() =>
			view.getByRole("textbox", { name: "Rename alpha" }),
		);
		await act(async () =>
			fireEvent.change(box, { target: { value: "Login redirect" } }),
		);
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		expect(posted("/api/conversations/c1/name")).toEqual([
			{ method: "PUT", body: { name: "Login redirect" } },
		]);
	});

	it("marks a conversation read once opened, and one not open unread from its menu", async () => {
		const view = await conversations(
			[
				conversation({ id: "c1", title: "Fix login", unread: true }),
				conversation({ id: "c2", title: "Fix footer" }),
			],
			"c1",
		);

		await waitFor(() =>
			expect(posted("/api/conversations/c1/unread")).toEqual([
				{ method: "PUT", body: { unread: false } },
			]),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "More for Fix login" })),
		);
		expect(view.queryByRole("menuitem", { name: "Mark as unread" })).toBeNull();
		await act(async () =>
			fireEvent.keyDown(document.activeElement ?? document.body, {
				key: "Escape",
			}),
		);
		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "More for Fix footer" }),
			),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() =>
					view.getByRole("menuitem", { name: "Mark as unread" }),
				),
			),
		);

		expect(posted("/api/conversations/c2/unread")).toEqual([
			{ method: "PUT", body: { unread: true } },
		]);
	});

	it("renames on a double click, in the list and on the open conversation's title", async () => {
		const view = await conversations([
			conversation({ id: "c1", task: "alpha", title: "Fix login" }),
		]);
		const nav = view.getByRole("navigation", { name: "conversations" });

		await act(async () =>
			fireEvent.doubleClick(
				within(nav).getByRole("button", { name: "Claude alpha" }),
			),
		);
		const inList = await waitFor(() =>
			within(nav).getByRole("textbox", { name: "Rename alpha" }),
		);
		await act(async () => fireEvent.keyDown(inList, { key: "Escape" }));
		expect(
			within(nav).queryByRole("textbox", { name: "Rename alpha" }),
		).toBeNull();

		const thread = view.getByRole("region", { name: "alpha" });
		await act(async () =>
			fireEvent.doubleClick(
				within(thread).getByRole("heading", { name: "alpha" }),
			),
		);
		const box = within(thread).getByRole("textbox", {
			name: "Rename alpha",
		});
		await act(async () =>
			fireEvent.change(box, { target: { value: "Login redirect" } }),
		);
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		expect(posted("/api/conversations/c1/name")).toEqual([
			{ method: "PUT", body: { name: "Login redirect" } },
		]);
	});

	it("on a phone, shows the list or one conversation, with a way back", async () => {
		resize(390, 844);
		try {
			const view = await conversations(
				[conversation({ id: "c1", task: "alpha", title: "Fix login" })],
				null,
			);
			const nav = view.getByRole("navigation", { name: "conversations" });
			await act(async () =>
				fireEvent.click(
					within(nav).getByRole("button", { name: "Claude alpha" }),
				),
			);

			expect(
				view.queryByRole("navigation", { name: "conversations" }),
			).toBeNull();
			expect(view.queryByRole("tablist")).toBeNull();
			await act(async () =>
				fireEvent.click(
					view.getByRole("button", { name: "Back to conversations" }),
				),
			);
			expect(
				view.getByRole("navigation", { name: "conversations" }),
			).toBeTruthy();
			expect(view.queryByRole("region", { name: "alpha" })).toBeNull();
		} finally {
			resize(1024, 768);
		}
	});

	it("with none open, offers the latest idle conversations to pick back up, none working, waiting, or merged", async () => {
		const view = await conversations(
			[
				conversation({ id: "c1", task: "alpha", title: "Fix login" }),
				conversation({
					id: "c7",
					task: null,
					title: "Landed",
					messages: [
						message("agent", "## ✅ Merged header onto main\n\nIt wraps."),
					],
				}),
				conversation({
					id: "c8",
					task: null,
					title: "Carried on",
					messages: [
						message("agent", "## ✅ Merged header onto main\n\nIt wraps."),
						message("user", "now the footer"),
					],
				}),
				conversation({ id: "c4", title: "Busy", status: "running" }),
				conversation({ id: "c5", task: null, title: "Look into it" }),
				conversation({
					id: "c6",
					task: null,
					lastTask: "beta",
					title: "Landed it",
				}),
				conversation({
					id: "c2",
					task: null,
					title: "Look around",
					status: "running",
					ask: {
						type: "permission",
						id: "t1",
						at: "2026-10-11T10:00:00.000Z",
						title: "rm -rf build",
						options: [{ id: "yes", name: "Allow", kind: "allow_once" }],
					},
				}),
				conversation({ id: "c3", title: "Old", archived: true }),
			],
			null,
		);
		const recent = view.getByRole("region", { name: "recent conversations" });

		expect(
			within(recent)
				.getAllByRole("button")
				.map((each) => each.textContent),
		).toEqual([
			"alpha",
			"Carried onmain tree",
			"Look into itmain tree",
			"beta",
		]);
		expect(within(recent).queryByRole("status")).toBeNull();
		await act(async () =>
			fireEvent.click(within(recent).getByRole("button", { name: /alpha/ })),
		);
		expect(location.hash).toBe("#conversations/c1");
	});

	it("starts a conversation from the home composer, in the main tree with the agent picked from New and its settings, and says the message", async () => {
		const view = await conversations(
			[
				conversation({ id: "c1", title: "Latest" }),
				conversation({
					id: "c0",
					agent: "codex",
					title: "Earlier",
					// Archived, and still what Codex's settings are known from.
					archived: true,
					settings: [
						{
							id: "model",
							name: "Model",
							type: "select",
							category: "model",
							current: "big",
							options: [
								{ value: "big", name: "Big", description: null },
								{ value: "small", name: "Small", description: null },
							],
						},
					],
				}),
			],
			null,
		);
		testing.reply = conversation({
			id: "c9",
			agent: "codex",
			task: null,
			status: "starting",
		});
		// The newest conversation's agent first, and Claude's sessions have
		// offered nothing yet.
		expect(
			within(
				view.getByText("Start a conversation with")
					.parentElement as HTMLElement,
			).getByLabelText("Claude"),
		).toBeTruthy();
		expect(view.queryByRole("combobox", { name: "model" })).toBeNull();

		await newWith(view, "Codex");
		expect(location.hash).toBe("#conversations/new/codex");
		// Where Codex's last conversation left it.
		expect(view.getByRole("combobox", { name: "model" }).textContent).toContain(
			"Big",
		);
		await act(async () =>
			fireEvent.click(view.getByRole("combobox", { name: "model" })),
		);
		await pick(
			await waitFor(() => view.getByRole("option", { name: "Small" })),
		);
		const box = view.getByRole("textbox", { name: "Message input" });
		await act(async () =>
			fireEvent.change(box, { target: { value: "fix the login" } }),
		);
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		expect(posted("/api/conversations")).toEqual([
			{
				method: "POST",
				body: { agent: "codex", task: null, settings: { model: "small" } },
			},
		]);
		await waitFor(() =>
			expect(posted("/api/conversations/c9/prompt")).toEqual([
				{ method: "POST", body: { text: "fix the login" } },
			]),
		);
		expect(location.hash).toBe("#conversations/c9");
		expect(view.getByRole("region", { name: "fix the login" })).toBeTruthy();
	});

	it("starts an agent's first conversation in a project with the settings its sessions left elsewhere, and says when none are known", async () => {
		const model: Setting = {
			id: "model",
			name: "Model",
			type: "select",
			category: "model",
			current: "big",
			options: [
				{ value: "big", name: "Big", description: null },
				{ value: "small", name: "Small", description: null },
			],
		};
		const view = await conversations([], null, {}, [
			{ id: "claude", name: "Claude", settings: [] },
			{ id: "codex", name: "Codex", settings: [model] },
		]);
		testing.reply = conversation({ id: "c9", agent: "codex", task: null });

		expect(view.queryByRole("combobox", { name: "model" })).toBeNull();
		expect(view.getByText("Settings appear once Claude starts")).toBeTruthy();

		await newWith(view, "Codex");
		expect(view.queryByText(/Settings appear once/)).toBeNull();
		expect(view.getByRole("combobox", { name: "model" }).textContent).toContain(
			"Big",
		);
		const box = view.getByRole("textbox", { name: "Message input" });
		await act(async () =>
			fireEvent.change(box, { target: { value: "fix the login" } }),
		);
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		// As shown, though never touched.
		expect(posted("/api/conversations")).toEqual([
			{
				method: "POST",
				body: { agent: "codex", task: null, settings: { model: "big" } },
			},
		]);
	});

	it("shows the first message in the new conversation's thread and row while its agent starts, then as the server has it", async () => {
		const view = await conversations([], null);
		testing.reply = conversation({ id: "c9", status: "starting" });
		const box = view.getByRole("textbox", { name: "Message input" });
		await act(async () =>
			fireEvent.change(box, { target: { value: "fix the login" } }),
		);

		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		const thread = await waitFor(() =>
			view.getByRole("region", { name: "fix the login" }),
		);
		// Its title, and the message.
		expect(within(thread).getAllByText("fix the login")).toHaveLength(2);
		expect(within(thread).getByText("starting")).toBeTruthy();
		expect(
			within(view.getByRole("list", { name: "conversation list" })).getByText(
				"fix the login",
			),
		).toBeTruthy();

		await testing.say(
			conversation({
				id: "c9",
				status: "running",
				messages: [message("user", "fix the login")],
			}),
		);

		await waitFor(() =>
			expect(within(thread).getByText("running")).toBeTruthy(),
		);
		expect(within(thread).getAllByText("fix the login")).toHaveLength(2);
	});

	it("shows the images sent with the first message in the new conversation's thread while its agent starts, then as the server keeps them", async () => {
		const view = await conversations([], null);
		testing.reply = conversation({ id: "c9", status: "starting" });
		const box = view.getByRole("textbox", { name: "Message input" });
		const shot = new File(["png bytes"], "shot.png", { type: "image/png" });
		await act(async () =>
			fireEvent.paste(box, { clipboardData: { files: [shot] } }),
		);

		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		const thread = await waitFor(() =>
			view.getByRole("region", { name: "Not started" }),
		);
		await waitFor(() =>
			expect(
				within(thread).getByRole("button", { name: "Preview shot.png" }),
			).toBeTruthy(),
		);

		await testing.say(
			conversation({
				id: "c9",
				status: "running",
				messages: [
					{
						...message("user", ""),
						parts: [{ type: "image", name: "ab12.png", mimeType: "image/png" }],
					},
				],
			}),
		);

		await waitFor(() =>
			expect(
				within(thread).getByRole("button", { name: "Preview ab12.png" }),
			).toBeTruthy(),
		);
		expect(
			within(thread).queryByRole("button", { name: "Preview shot.png" }),
		).toBeNull();
	});

	it("shows a message to a stopped conversation in its thread while its agent resumes, then as the server has it", async () => {
		const said = [message("user", "fix the login"), message("agent", "Done.")];
		const view = await conversations([
			conversation({ title: "Login", status: "stopped", messages: said }),
		]);
		const thread = view.getByRole("region", { name: "Login" });
		const box = view.getByRole("textbox", { name: "Message input" });
		await act(async () =>
			fireEvent.change(box, { target: { value: "and the logout" } }),
		);

		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		await waitFor(() =>
			expect(within(thread).getAllByText("and the logout")).toHaveLength(1),
		);
		expect(thread.textContent).toContain("Done.");

		await testing.say(
			conversation({
				title: "Login",
				status: "running",
				messages: [...said, message("user", "and the logout")],
			}),
		);

		await waitFor(() =>
			expect(within(thread).getByText("running")).toBeTruthy(),
		);
		expect(within(thread).getAllByText("and the logout")).toHaveLength(1);
	});

	it("shows each message to a stopped conversation at once while its agent resumes, those after the first as queued until the server has them", async () => {
		const said = [message("user", "fix the login"), message("agent", "Done.")];
		const view = await conversations([
			conversation({ title: "Login", status: "stopped", messages: said }),
		]);
		const thread = view.getByRole("region", { name: "Login" });
		const box = view.getByRole("textbox", { name: "Message input" });

		for (const text of ["and the logout", "and the signup"]) {
			await act(async () => fireEvent.change(box, { target: { value: text } }));
			await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
		}

		await waitFor(() =>
			expect(within(thread).getAllByText("and the logout")).toHaveLength(1),
		);
		const queued = within(thread).getByRole("region", {
			name: "queued messages",
		});
		expect(within(queued).getByText("and the signup")).toBeTruthy();
		// The server has nothing of it to take back yet.
		const discard = within(queued).getByRole("button", {
			name: "Discard and the signup",
		}) as HTMLButtonElement;
		expect(discard.disabled).toBe(true);

		await testing.say(
			conversation({
				title: "Login",
				status: "running",
				messages: [
					...said,
					message("user", "and the logout"),
					{ ...message("user", "and the signup"), queued: true },
				],
			}),
		);

		await waitFor(() => expect(discard.disabled).toBe(false));
		expect(within(thread).getAllByText("and the logout")).toHaveLength(1);
		expect(within(thread).getAllByText("and the signup")).toHaveLength(1);
	});

	it("takes a message to a stopped conversation back out of its thread when the server refuses it", async () => {
		const view = await conversations([
			conversation({ title: "Login", status: "stopped" }),
		]);
		const thread = view.getByRole("region", { name: "Login" });
		const box = view.getByRole("textbox", {
			name: "Message input",
		}) as HTMLTextAreaElement;
		testing.refuseWrites = { reason: "usage", message: "cannot resume" };
		await act(async () =>
			fireEvent.change(box, { target: { value: "and the logout" } }),
		);

		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		await waitFor(() => expect(box.value).toBe("and the logout"));
		expect(thread.querySelectorAll('[data-role="user"]')).toHaveLength(0);
		// Said above the composer it was sent from, not in a toast.
		expect(within(thread).getByRole("alert").textContent).toBe(
			"Not sent: cannot resume",
		);
	});

	it("opens the new conversation screen with the agent picked from the sidebar's menu", async () => {
		const view = await conversations([
			conversation({ id: "c1", task: "alpha", title: "Fix login" }),
		]);
		expect(view.queryByRole("region", { name: "new conversation" })).toBeNull();

		await newWith(view, "Codex");

		expect(location.hash).toBe("#conversations/new/codex");
		expect(
			within(
				view.getByText("Start a conversation with")
					.parentElement as HTMLElement,
			).getByLabelText("Codex"),
		).toBeTruthy();
	});

	it("greets with the agent of the newest conversation when none is picked", async () => {
		const view = await conversations(
			[conversation({ id: "c1", agent: "codex", title: "Latest" })],
			null,
		);

		expect(
			within(
				view.getByText("Start a conversation with")
					.parentElement as HTMLElement,
			).getByLabelText("Codex"),
		).toBeTruthy();
	});

	it("shows what was said as the server streams it", async () => {
		const view = await conversations([
			conversation({ title: "Read the note" }),
		]);

		await testing.say(
			conversation({
				title: "Read the note",
				status: "running",
				messages: [
					message("user", "what does it say?"),
					message(
						"agent",
						tool({ command: "cat note.txt", status: "in_progress" }),
						"It says **hi**.",
					),
				],
			}),
		);

		const thread = view.getByRole("region", { name: "Read the note" });
		await waitFor(() =>
			expect(thread.textContent).toContain("what does it say?"),
		);
		await waitFor(() =>
			expect(within(thread).getByText("hi").tagName).toBe("STRONG"),
		);
		expect(thread.textContent).toContain("Working");
		expect(within(thread).getByText("running")).toBeTruthy();
	});

	it("says Working under a reply while its text streams", async () => {
		const view = await conversations([
			conversation({ title: "Read the note" }),
		]);

		await testing.say(
			conversation({
				title: "Read the note",
				status: "running",
				messages: [
					message("user", "what does it say?"),
					message("agent", "It says"),
				],
			}),
		);

		const thread = view.getByRole("region", { name: "Read the note" });
		await waitFor(() => expect(thread.textContent).toContain("It says"));
		expect(within(thread).getByText("Working").getAttribute("role")).toBe(
			"status",
		);
	});

	it("copies what the person said from a button on their message, which says it copied", async () => {
		const view = await conversations([
			conversation({ title: "Read the note" }),
		]);
		const copied: string[] = [];
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: async (text: string) => void copied.push(text) },
		});

		await testing.say(
			conversation({
				title: "Read the note",
				messages: [
					message("user", "what does it say?"),
					message("agent", "It says hi."),
				],
			}),
		);

		const thread = view.getByRole("region", { name: "Read the note" });
		const copy = await within(thread).findByRole("button", { name: "Copy" });
		await act(async () => fireEvent.click(copy));
		expect(copied).toEqual(["what does it say?"]);
		await waitFor(() => expect(copy.getAttribute("data-copied")).toBe("true"));
	});

	it("opens a link the agent wrote in a new tab, and a footnote in place", async () => {
		const view = await conversations([
			conversation({ title: "Read the note" }),
		]);

		await testing.say(
			conversation({
				title: "Read the note",
				messages: [
					message("user", "where is it?"),
					message(
						"agent",
						"See [the docs](https://example.com) and [the note](#note).",
					),
				],
			}),
		);

		const thread = view.getByRole("region", { name: "Read the note" });
		const docs = await within(thread).findByRole("link", { name: "the docs" });
		expect(docs.getAttribute("target")).toBe("_blank");
		expect(docs.getAttribute("rel")).toBe("noreferrer noopener");
		const note = within(thread).getByRole("link", { name: "the note" });
		expect(note.getAttribute("target")).toBeNull();
	});

	it("keeps the reply in the place it held before the agent said anything", async () => {
		const view = await conversations([
			conversation({ title: "Read the note" }),
		]);
		const asked = message("user", "what does it say?");
		await testing.say(
			conversation({
				title: "Read the note",
				status: "running",
				messages: [asked],
			}),
		);
		const thread = view.getByRole("region", { name: "Read the note" });
		const reply = () =>
			thread.querySelector('[data-slot="aui_assistant-message-root"]');
		await waitFor(() => expect(reply()).not.toBeNull());
		const held = reply();

		await testing.say(
			conversation({
				title: "Read the note",
				status: "running",
				messages: [asked, message("agent", "It says hi.")],
			}),
		);

		await waitFor(() => expect(thread.textContent).toContain("It says hi."));
		// The same element, so it neither fades in again nor moves.
		expect(held?.isConnected).toBe(true);
	});

	it("sends on Enter, keeps a new line on Shift+Enter, and stops a turn on Escape", async () => {
		const view = await conversations([conversation()]);
		const box = view.getByRole("textbox", {
			name: "Message input",
		}) as HTMLTextAreaElement;

		await act(async () =>
			fireEvent.change(box, { target: { value: "hello" } }),
		);
		await act(async () =>
			fireEvent.keyDown(box, { key: "Enter", shiftKey: true }),
		);
		expect(posted("/api/conversations/c1/prompt")).toEqual([]);
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
		expect(posted("/api/conversations/c1/prompt")).toEqual([
			{ method: "POST", body: { text: "hello" } },
		]);

		await testing.say(conversation({ status: "running" }));
		await act(async () => fireEvent.keyDown(box, { key: "Escape" }));
		expect(
			posted("/api/conversations/c1/cancel").map((post) => post.method),
		).toEqual(["POST"]);
	});

	it("sends an image pasted into the composer, and shows the images the person sent on their message", async () => {
		const view = await conversations([
			conversation({
				title: "Look",
				messages: [
					{
						...message("user", "this one"),
						parts: [
							{ type: "image", name: "ab12.png", mimeType: "image/png" },
							{ type: "text", text: "this one" },
						],
					},
				],
			}),
		]);
		const thread = view.getByRole("region", { name: "Look" });
		// In the message's box, ahead of its words, as the composer holds it.
		await waitFor(() =>
			expect(
				within(thread)
					.getByRole("button", { name: "Preview ab12.png" })
					.closest(".aui-user-message-content")
					?.textContent?.endsWith("this one"),
			).toBe(true),
		);
		await act(async () =>
			fireEvent.click(
				within(thread).getByRole("button", { name: "Preview ab12.png" }),
			),
		);
		const lightbox = await waitFor(() =>
			view.getByRole("dialog", { name: "ab12.png" }),
		);
		expect(lightbox.querySelector("img")).not.toBeNull();
		await act(async () =>
			fireEvent.click(within(lightbox).getByRole("button", { name: "close" })),
		);
		const box = view.getByRole("textbox", { name: "Message input" });

		const shot = new File(["png bytes"], "shot.png", { type: "image/png" });
		await act(async () =>
			fireEvent.paste(box, { clipboardData: { files: [shot] } }),
		);
		await act(async () =>
			fireEvent.change(box, { target: { value: "and this" } }),
		);
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		await waitFor(() =>
			expect(posted("/api/conversations/c1/prompt")).toEqual([
				{
					method: "POST",
					body: {
						text: "and this",
						images: [{ mimeType: "image/png", data: btoa("png bytes") }],
					},
				},
			]),
		);
	});

	describe("question cards", () => {
		const report = [
			"## ⚠️ Escalated header: waiting on two calls",
			"",
			"The header wraps now.",
			"",
			"1. Which pages need it?",
			"   - [a] Todos",
			"   - [b] Tasks",
			"2. How should a stale todo be shown?",
			"   - (a) A muted card",
			"   - (b) A badge",
			"3. Ready to merge?",
		].join("\n");
		const asking = (status: ConversationState["status"] = "idle") =>
			conversation({
				title: "Header",
				status,
				messages: [message("user", "fix the header"), message("agent", report)],
			});
		const box = (view: Awaited<ReturnType<typeof conversations>>) =>
			view.getByRole("textbox", {
				name: "Message input",
			}) as HTMLTextAreaElement;

		it("shows each question as a card, the text around them as written", async () => {
			const view = await conversations([asking()]);

			const cards = await waitFor(() =>
				view.getByRole("list", { name: "questions" }),
			);
			expect(
				within(cards)
					.getAllByRole("listitem")
					.map((card) => card.getAttribute("aria-label")),
			).toEqual(["question 1", "question 2", "question 3"]);
			expect(view.getByText("The header wraps now.")).toBeTruthy();
			expect(view.queryByText("- (a) A muted card")).toBeNull();
		});

		it("asks an escalation's questions in its card, headed as the escalation", async () => {
			const view = await conversations([asking()]);

			const escalated = await waitFor(() =>
				view.getByRole("region", { name: "escalated header" }),
			);
			expect(escalated.textContent).toContain("Escalated");
			expect(escalated.textContent).toContain("waiting on two calls");
			expect(escalated.textContent).toContain("The header wraps now.");
			expect(
				within(escalated).getByRole("list", { name: "questions" }),
			).toBeTruthy();
			expect(view.getAllByRole("region", { name: /escalated/ })).toHaveLength(
				1,
			);
			expect(
				view.queryByRole("region", { name: "questions for you" }),
			).toBeNull();
		});

		it("asks questions outside an escalation in a card of their own", async () => {
			const view = await conversations([
				conversation({
					messages: [
						message("user", "fix the header"),
						message(
							"agent",
							"Working on it.\n\n1. Which pages need it?\n2. Should it wrap?",
						),
					],
				}),
			]);

			const asked = await waitFor(() =>
				view.getByRole("region", { name: "questions for you" }),
			);
			expect(
				within(asked).getByRole("list", { name: "questions" }),
			).toBeTruthy();
			expect(view.queryByRole("region", { name: /escalated/ })).toBeNull();
		});

		const card = (
			view: Awaited<ReturnType<typeof conversations>>,
			question: string,
		) => view.getByRole("listitem", { name: `question ${question}` });

		it("renders markdown in a question's subject and choices", async () => {
			const view = await conversations([
				conversation({
					title: "Header",
					messages: [
						message("user", "fix the header"),
						message(
							"agent",
							[
								"1. Should `Header` wrap?",
								"   - (a) **Always**",
								"   - (b) Only below `md`",
							].join("\n"),
						),
					],
				}),
			]);

			const asked = await waitFor(() => card(view, "1"));
			expect(
				[...asked.querySelectorAll("code")].map((code) => code.textContent),
			).toEqual(["Header", "md"]);
			expect(asked.querySelector("strong")?.textContent).toBe("Always");
			expect(asked.textContent).not.toContain("`");
		});

		it("shows a screenshot indented under a choice with that choice", async () => {
			const view = await conversations([
				conversation({
					title: "Actions",
					messages: [
						message("user", "restyle the actions"),
						message(
							"agent",
							[
								"1. Which style should the actions take?",
								"   - (a) A rail",
								"     ![rail](/abs/rail.png)",
								"   - (b) A panel",
								"     ![panel](/abs/panel.png)",
							].join("\n"),
						),
					],
				}),
			]);

			const asked = await waitFor(() => card(view, "1"));
			const frame = (name: string) =>
				within(asked).getByRole("button", { name: new RegExp(name) })
					.parentElement as HTMLElement;
			// Under the choice, as its alt text where the file will not load.
			expect(frame("A rail").lastElementChild?.textContent).toContain("rail");
			expect(frame("A panel").lastElementChild?.textContent).toContain("panel");
			// The screenshots are no choices of their own.
			expect(
				within(asked)
					.getAllByRole("button", { pressed: false })
					.map((each) => each.textContent),
			).toEqual(["aA rail", "bA panel"]);
		});

		it("keeps the answers in the card, never the composer, and sends them from it with anything else", async () => {
			const view = await conversations([asking()]);
			await waitFor(() => card(view, "2"));
			const choice = async (question: string, name: string) =>
				act(async () =>
					fireEvent.click(
						within(card(view, question)).getByRole("button", {
							name: new RegExp(name),
						}),
					),
				);
			const send = view.getByRole("button", {
				name: "Send",
			}) as HTMLButtonElement;
			expect(send.disabled).toBe(true);

			await choice("2", "A badge");
			await choice("1", "Tasks");
			await choice("1", "Todos");
			await choice("2", "A muted card");
			expect(
				within(card(view, "2"))
					.getByRole("button", { name: /A muted card/ })
					.getAttribute("aria-pressed"),
			).toBe("true");
			// Answered, it keeps its number.
			expect(card(view, "2").textContent).toStartWith("2 answered");
			const note = (question: string) =>
				within(card(view, question)).getByRole(
					"textbox",
				) as HTMLTextAreaElement;
			await act(async () =>
				fireEvent.change(note("2"), { target: { value: "only on phones" } }),
			);
			await act(async () =>
				fireEvent.change(note("3"), {
					target: { value: "after a\nphone check" },
				}),
			);
			expect(note("2").value).toBe("only on phones");
			expect(view.getByText("3 of 3 answered")).toBeTruthy();
			await act(async () =>
				fireEvent.change(note("3"), { target: { value: "" } }),
			);
			expect(view.getByText("2 of 3 answered")).toBeTruthy();
			await act(async () =>
				fireEvent.change(view.getByRole("textbox", { name: "Anything else" }), {
					target: { value: "Also the footer." },
				}),
			);
			expect(box(view).value).toBe("");
			expect(
				localStorage.getItem("arbor.draft.c1:questions:1:Which pages need it?"),
			).toBe("1. a, b\n2. a: only on phones\n\nAlso the footer.");
			expect(posted("/api/conversations/c1/prompt")).toEqual([]);

			await act(async () => fireEvent.click(send));

			expect(posted("/api/conversations/c1/prompt")).toEqual([
				{
					method: "POST",
					body: {
						text: "1. a, b\n2. a: only on phones\n\nAlso the footer.",
					},
				},
			]);
		});

		it("answers by keyboard alone: letters pick, Enter goes on, and sends from anything else", async () => {
			const view = await conversations([asking()]);
			const first = await waitFor(() =>
				within(card(view, "1")).getByRole("button", { name: /Todos/ }),
			);
			// Ready to answer as soon as it shows.
			await waitFor(() => expect(document.activeElement === first).toBe(true));
			const key = async (key: string, options = {}) =>
				act(async () =>
					fireEvent.keyDown(document.activeElement as Element, {
						key,
						...options,
					}),
				);

			await key("b");
			await key("a");
			expect(
				within(card(view, "1"))
					.getAllByRole("button")
					.map((each) => each.getAttribute("aria-pressed")),
			).toEqual(["true", "true"]);
			expect(document.activeElement === first).toBe(true);
			await key("Enter");
			expect(document.activeElement?.textContent).toContain("A muted card");
			await key("ArrowDown");
			expect(document.activeElement?.textContent).toContain("A badge");
			await key("b");
			await key("Enter");
			expect(
				document.activeElement === within(card(view, "3")).getByRole("textbox"),
			).toBe(true);
			await act(async () =>
				fireEvent.change(document.activeElement as Element, {
					target: { value: "soon" },
				}),
			);
			await key("Enter");
			const more = view.getByRole("textbox", { name: "Anything else" });
			expect(document.activeElement === more).toBe(true);
			await act(async () =>
				fireEvent.change(more, { target: { value: "Thanks" } }),
			);
			await key("Enter", { shiftKey: true });
			expect(posted("/api/conversations/c1/prompt")).toEqual([]);
			await key("Enter");

			expect(posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "1. a, b\n2. b\n3. soon\n\nThanks" } },
			]);
		});

		it("scrolls the whole first question into view as the card arrives", async () => {
			const scrolled: Element[] = [];
			const scroll = spyOn(
				HTMLElement.prototype,
				"scrollIntoView",
			).mockImplementation(function (this: HTMLElement) {
				scrolled.push(this);
			});
			try {
				const view = await conversations([asking()]);
				const first = await waitFor(() =>
					within(card(view, "1")).getByRole("button", { name: /Todos/ }),
				);
				await waitFor(() =>
					expect(document.activeElement === first).toBe(true),
				);
				expect(scrolled).toEqual([card(view, "1")]);
			} finally {
				scroll.mockRestore();
			}
		});

		it("scrolls the whole next question into view on Enter, clear of the composer", async () => {
			const view = await conversations([asking()]);
			const first = await waitFor(() =>
				within(card(view, "1")).getByRole("button", { name: /Todos/ }),
			);
			await waitFor(() => expect(document.activeElement === first).toBe(true));
			const scrolled: Element[] = [];
			const scroll = spyOn(
				HTMLElement.prototype,
				"scrollIntoView",
			).mockImplementation(function (this: HTMLElement) {
				scrolled.push(this);
			});
			try {
				await act(async () => fireEvent.keyDown(first, { key: "Enter" }));
				await act(async () =>
					fireEvent.keyDown(document.activeElement as Element, {
						key: "Enter",
					}),
				);
			} finally {
				scroll.mockRestore();
			}

			expect(scrolled).toEqual([card(view, "2"), card(view, "3")]);
			const thread = view.container.ownerDocument.querySelector(
				'[data-slot="aui_thread-viewport"]',
			) as HTMLElement;
			expect(thread.style.scrollPaddingBottom).toMatch(/^\d+px$/);
		});

		it("sends with ⌘Enter from any question", async () => {
			const view = await conversations([asking()]);
			const note = await waitFor(
				() =>
					within(card(view, "3")).getByRole("textbox") as HTMLTextAreaElement,
			);
			await act(async () =>
				fireEvent.change(note, { target: { value: "after a check" } }),
			);
			await act(async () =>
				fireEvent.keyDown(note, { key: "Enter", metaKey: true }),
			);

			expect(posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "3. after a check" } },
			]);
		});

		it("keeps a note that starts like a choice as typed, picking nothing", async () => {
			const view = await conversations([asking()]);
			const second = await waitFor(() => card(view, "2"));
			const note = within(second).getByRole("textbox") as HTMLTextAreaElement;

			for (const typed of ["a", "a ", "a lot"]) {
				await act(async () =>
					fireEvent.change(note, { target: { value: typed } }),
				);
				expect(note.value).toBe(typed);
			}
			expect(
				within(second)
					.getByRole("button", { name: /A muted card/ })
					.getAttribute("aria-pressed"),
			).toBe("false");
		});

		it("labels how each question picks, and marks the agent's pick", async () => {
			const view = await conversations([
				conversation({
					title: "Header",
					messages: [
						message("user", "fix the header"),
						message(
							"agent",
							[
								"1. How should a stale todo be shown?",
								"   - (a) A muted card (chosen)",
								"   - (b) A badge",
							].join("\n"),
						),
					],
				}),
			]);
			const first = await waitFor(() => card(view, "1"));

			expect(within(first).getByText("Pick one")).toBeTruthy();
			expect(
				within(first).getByRole("button", { name: /A muted card/ }).textContent,
			).toContain("Recommended");
			expect(within(first).queryByText(/\(chosen\)/)).toBeNull();
			expect(
				within(card(view, "1")).queryByText("Select all that apply"),
			).toBeNull();
		});

		it("puts an order question's choices in order by its buttons and Alt with the arrows, sending the letters", async () => {
			const view = await conversations([
				conversation({
					title: "Settings",
					messages: [
						message("user", "add settings pages"),
						message(
							"agent",
							[
								"1. In what order should the pages land?",
								"   - a. Profile",
								"   - b. Billing",
								"   - c. Notifications",
							].join("\n"),
						),
					],
				}),
			]);
			const first = await waitFor(() => card(view, "1"));
			const order = () =>
				within(first)
					.getAllByRole("listitem")
					.map(
						(row) =>
							row.textContent?.match(/Profile|Billing|Notifications/)?.[0],
					);

			expect(
				within(first).getByText("Put in order, first at the top"),
			).toBeTruthy();
			await act(async () =>
				fireEvent.click(
					within(first).getByRole("button", { name: "Move c up" }),
				),
			);
			expect(order()).toEqual(["Profile", "Notifications", "Billing"]);
			const top = within(first).getAllByRole("listitem")[0] as HTMLElement;
			await act(async () => top.focus());
			await act(async () =>
				fireEvent.keyDown(top, { key: "ArrowDown", altKey: true }),
			);
			expect(order()).toEqual(["Notifications", "Profile", "Billing"]);
			await act(async () =>
				fireEvent.keyDown(top, { key: "Enter", metaKey: true }),
			);

			expect(posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "1. c, a, b" } },
			]);
		});

		it("answers an order question with the order as it stands", async () => {
			const view = await conversations([
				conversation({
					title: "Settings",
					messages: [
						message("user", "add settings pages"),
						message(
							"agent",
							"1. In what order?\n   - a. Profile\n   - b. Billing",
						),
					],
				}),
			]);
			const first = await waitFor(() => card(view, "1"));
			await act(async () =>
				fireEvent.click(
					within(first).getByRole("button", { name: "Keep this order" }),
				),
			);

			expect(
				within(first).getByRole("button", { name: "Clear order" }),
			).toBeTruthy();
			expect(view.getByText("1 of 1 answered")).toBeTruthy();
		});

		it("folds questions once replied to, opening on the answers sent, never asking them again", async () => {
			const view = await conversations([
				conversation({
					title: "Header",
					messages: [
						message("user", "fix the header"),
						message("agent", report),
						message(
							"user",
							"1. a, b\n2. b: only on phones\n\nAlso the footer.",
						),
						message("agent", "Done."),
					],
				}),
			]);
			const panel = await waitFor(() =>
				view.getByRole("region", { name: "escalated header" }),
			);
			const fold = within(panel).getByRole("button", {
				name: /Escalated/,
			});
			expect(fold.getAttribute("aria-expanded")).toBe("false");
			expect(fold.textContent).toContain("2 of 3 answered");
			expect(view.queryByRole("list", { name: "questions" })).toBeNull();

			await act(async () => fireEvent.click(fold));

			const second = within(panel).getByRole("listitem", {
				name: "question 2",
			});
			const badge = within(second).getByRole("button", {
				name: /A badge/,
			}) as HTMLButtonElement;
			expect(badge.getAttribute("aria-pressed")).toBe("true");
			expect(badge.disabled).toBe(true);
			expect(within(second).getByText("only on phones")).toBeTruthy();
			expect(within(panel).queryByRole("textbox")).toBeNull();
			expect(within(panel).getByText("Also the footer.")).toBeTruthy();
			expect(box(view).value).toBe("");
		});

		it("waits for the agent to finish writing before showing cards", async () => {
			const view = await conversations([asking("running")]);
			await waitFor(() =>
				expect(view.getByText(/The header wraps now/)).toBeTruthy(),
			);
			expect(view.queryByRole("list", { name: "questions" })).toBeNull();

			await testing.say(asking("idle"));

			await waitFor(() =>
				expect(view.getByRole("list", { name: "questions" })).toBeTruthy(),
			);
		});
	});

	describe("work row", () => {
		const second = (secs: number) =>
			new Date(Date.parse("2026-10-11T10:00:00Z") + secs * 1000).toISOString();
		const turn = (
			parts: Parameters<typeof message>[1][],
			{
				status = "idle" as ConversationState["status"],
				plan = null as
					| null
					| { text: string; status: "pending" | "in_progress" | "completed" }[],
			} = {},
		) =>
			conversation({
				title: "Tests",
				status,
				messages: [
					{
						...message("user", "run the tests"),
						at: second(0),
						until: second(0),
					},
					{
						...message("agent", ...parts),
						plan,
						at: second(1),
						until: second(65),
					},
				],
			});
		const opened = async (state: ConversationState) => {
			const view = await conversations([state]);
			return await waitFor(() =>
				view.getByRole("region", { name: state.title ?? "" }),
			);
		};

		it("folds what the agent did into one line, and shows only its reply", async () => {
			const thread = await opened(
				turn([
					{ type: "thought", text: "Which tests?", at: second(1) },
					"Let me run them.",
					tool({ id: "r1", kind: "read", paths: ["/repo/a.ts"] }),
					tool({ id: "r2", kind: "read", paths: ["/repo/b.ts"] }),
					tool({
						id: "x1",
						command: "bun test",
						status: "failed",
						at: second(2),
						until: second(30),
					}),
					tool({
						id: "e1",
						kind: "edit",
						paths: ["/repo/src/a.ts"],
						edits: [{ path: "/repo/src/a.ts", old: "one", new: "two" }],
					}),
					tool({
						id: "x2",
						command: "bun test",
						at: second(31),
						until: second(60),
					}),
					"All tests pass.",
				]),
			);

			await waitFor(() =>
				expect(thread.textContent).toContain(
					"Worked 1m 5s · 2 commands (1 failed) · edited 1 file · read 2 files",
				),
			);
			expect(thread.textContent).toContain("All tests pass.");
			const timeline = within(thread).getByRole("list", { name: "timeline" });
			expect((timeline.closest("details") as HTMLDetailsElement).open).toBe(
				false,
			);
			expect(within(timeline).getByText("Thought for 1s")).toBeTruthy();
			expect(within(timeline).getByText("Let me run them.")).toBeTruthy();
			expect(within(timeline).getByText("Read 2 files")).toBeTruthy();
		});

		it("warns of a command that did to git what it should not have, opening to the command", async () => {
			const thread = await opened(
				turn([
					tool({ id: "x1", command: "git status" }),
					tool({
						id: "x2",
						command: "git stash && cd /repo && touch stray.txt",
						flags: [
							{ type: "stashed", count: 1 },
							{ type: "outside", paths: ["stray.txt"] },
						],
					}),
					"Done.",
				]),
			);

			const warnings = await waitFor(() =>
				within(thread).getByRole("list", { name: "warnings" }),
			);
			expect(
				within(warnings).getAllByRole("listitem")[0]?.textContent,
			).toContain(
				"Stashed changes and left them there · Changed 1 file in the main tree",
			);
			expect(warnings.textContent).toContain(
				"$ git stash && cd /repo && touch stray.txt",
			);
			expect(
				within(warnings).getByRole("list", {
					name: "files changed in the main tree",
				}).textContent,
			).toBe("stray.txt");
			expect(warnings.textContent).not.toContain("git status");
		});

		it("shows how each permission the agent asked was answered, above its call", async () => {
			const at = "2026-10-11T12:00:00.000Z";
			const thread = await opened(
				turn([
					tool({
						id: "x1",
						command: "rm -rf build",
						decision: {
							option: { name: "Allow", kind: "allow_once" },
							at,
						},
					}),
					tool({
						id: "x2",
						command: "git push",
						status: "failed",
						decision: {
							option: { name: "Reject", kind: "reject_once" },
							at,
						},
					}),
					tool({ id: "x3", command: "deploy", decision: { option: null, at } }),
					"Done.",
				]),
			);

			const timeline = await waitFor(() =>
				within(thread).getByRole("list", { name: "timeline" }),
			);
			expect(
				within(timeline)
					.getAllByRole("listitem")
					.map((each) => each.textContent),
			).toEqual([
				"Allowed for this sessionrm -rf build",
				expect.stringContaining("rm -rf build"),
				"Deniedgit push",
				expect.stringContaining("git push"),
				"Dismisseddeploy",
				expect.stringContaining("deploy"),
			]);
		});

		it("shows the last thing the agent said, even with tool calls after it", async () => {
			const thread = await opened(
				turn([
					"Let me look.",
					tool({ id: "r1", kind: "read", paths: ["/repo/a.ts"] }),
					"No, I'm not waiting on you.",
					tool({ id: "x1", command: "bun test" }),
				]),
			);

			await waitFor(() =>
				expect(thread.textContent).toContain("No, I'm not waiting on you."),
			);
			const timeline = within(thread).getByRole("list", { name: "timeline" });
			expect(timeline.textContent).not.toContain("No, I'm not waiting on you.");
			expect(within(timeline).getByText("Let me look.")).toBeTruthy();
			expect(within(timeline).getByText("bun test")).toBeTruthy();
		});

		it("marks a command the agent never finished as stopped once its turn is over", async () => {
			const thread = await opened(
				turn([
					tool({ id: "x1", command: "bun test" }),
					tool({ id: "x2", command: "bun run demo", status: "in_progress" }),
					"Done.",
				]),
			);

			const timeline = await waitFor(() =>
				within(thread).getByRole("list", { name: "timeline" }),
			);
			expect(within(timeline).getByLabelText("passed")).toBeTruthy();
			expect(within(timeline).getByLabelText("stopped")).toBeTruthy();
			expect(within(timeline).queryByLabelText("running")).toBeNull();
			expect(within(timeline).getByText("No output")).toBeTruthy();
		});

		it("counts a command run again in a row, and opens it to its output", async () => {
			const thread = await opened(
				turn([
					tool({ id: "x1", command: "bun test", status: "failed" }),
					tool({ id: "x2", command: "bun test", status: "failed" }),
					tool({
						id: "x3",
						command: "bun test",
						status: "failed",
						output: "\u001b[31m1 fail\u001b[39m",
					}),
					"Still failing.",
				]),
			);

			const row = await waitFor(() => within(thread).getByText("×3"));
			const command = row.closest("details") as HTMLDetailsElement;
			expect(within(command).getByLabelText("failed")).toBeTruthy();
			expect(within(command).getByLabelText("output").textContent).toBe(
				"1 fail",
			);
		});

		it("lists the files edited from the top of their tree, each opening to its edits", async () => {
			const thread = await opened(
				turn([
					tool({
						id: "e1",
						kind: "edit",
						paths: ["/repo/src/a.ts"],
						edits: [{ path: "/repo/src/a.ts", old: "one", new: "two" }],
					}),
					tool({
						id: "e2",
						kind: "edit",
						paths: ["/repo/src/a.ts"],
						edits: [{ path: "/repo/src/a.ts", old: "two", new: "three" }],
					}),
					tool({
						id: "e3",
						kind: "edit",
						paths: ["/repo-arbor/gone/lib/b.ts"],
						edits: [
							{ path: "/repo-arbor/gone/lib/b.ts", old: null, new: "new" },
						],
					}),
					tool({
						id: "e4",
						kind: "edit",
						paths: ["/tmp/c.ts"],
						edits: [{ path: "/tmp/c.ts", old: null, new: "new" }],
					}),
					"Done.",
				]),
			);

			const files = await waitFor(() =>
				within(thread).getByRole("list", { name: "edited files" }),
			);
			expect(
				within(files)
					.getAllByRole("button")
					.map((file) => [file.title, file.textContent]),
			).toEqual([
				["/repo/src/a.ts", "a.tssrc×2"],
				["/repo-arbor/gone/lib/b.ts", "b.tslib"],
				["/tmp/c.ts", "c.ts/tmp"],
			]);
			await act(async () =>
				fireEvent.click(within(files).getByTitle("/repo/src/a.ts")),
			);
			expect(
				within(within(thread).getByLabelText("edits to /repo/src/a.ts"))
					.getAllByLabelText("edit to /repo/src/a.ts")
					.map((edit) => edit.textContent),
			).toEqual(["src/a.ts+1 −1−one+two", "src/a.ts+1 −1−two+three"]);
		});

		it("says what it is on while it works, with its plan", async () => {
			const thread = await opened(
				turn(
					[
						tool({
							id: "x1",
							command: "bun test",
							status: "in_progress",
							at: second(20),
						}),
					],
					{
						status: "running",
						plan: [
							{ text: "Run the tests", status: "in_progress" },
							{ text: "Fix what fails", status: "pending" },
						],
					},
				),
			);

			await waitFor(() =>
				expect(thread.textContent).toMatch(/Working .+ · bun test · /),
			);
			expect(
				within(thread).getByRole("list", { name: "plan" }).textContent,
			).toBe("Run the testsFix what fails");
		});

		it("opens while the agent works with nothing said, folding once it replies", async () => {
			const working = turn([tool({ id: "x1", command: "bun test" })], {
				status: "running",
			});
			const thread = await opened(working);
			const details = () =>
				within(thread)
					.getByRole("list", { name: "timeline" })
					.closest("details") as HTMLDetailsElement;
			await waitFor(() => expect(details().open).toBe(true));

			await testing.say(
				turn([tool({ id: "x1", command: "bun test" }), "Tests pass."], {
					status: "running",
				}),
			);
			await waitFor(() => expect(thread.textContent).toContain("Tests pass."));
			expect(details().open).toBe(false);
		});

		it("keeps what the agent said before its latest call in the timeline while it works", async () => {
			const thread = await opened(
				turn(
					[
						"Let me look.",
						tool({ id: "r1", kind: "read", paths: ["/repo/a.ts"] }),
						{ type: "thought", text: "Which tests?", at: second(1) },
					],
					{ status: "running" },
				),
			);

			const timeline = await waitFor(() =>
				within(thread).getByRole("list", { name: "timeline" }),
			);
			expect(within(timeline).getByText("Let me look.")).toBeTruthy();
			expect(within(thread).getAllByText("Let me look.")).toHaveLength(1);
		});

		it("folds the row once, so one opened again stays open as the agent narrates", async () => {
			const thread = await opened(
				turn([tool({ id: "x1", command: "bun test" }), "Checking."], {
					status: "running",
				}),
			);
			const details = () =>
				within(thread)
					.getByRole("list", { name: "timeline" })
					.closest("details") as HTMLDetailsElement;
			await waitFor(() => expect(thread.textContent).toContain("Checking."));
			expect(details().open).toBe(false);
			await act(async () => {
				details().open = true;
				details().dispatchEvent(new Event("toggle"));
			});

			await testing.say(
				turn(
					[
						tool({ id: "x1", command: "bun test" }),
						"Checking.",
						tool({ id: "x2", command: "bun run demo" }),
					],
					{ status: "running" },
				),
			);
			await waitFor(() => expect(thread.textContent).toContain("bun run demo"));
			await testing.say(
				turn(
					[
						tool({ id: "x1", command: "bun test" }),
						"Checking.",
						tool({ id: "x2", command: "bun run demo" }),
						"Still checking.",
					],
					{ status: "running" },
				),
			);
			await waitFor(() =>
				expect(thread.textContent).toContain("Still checking."),
			);
			expect(details().open).toBe(true);
		});

		it("stops saying it is thinking once it replies", async () => {
			const thread = await opened(
				turn(
					[
						{ type: "thought", text: "Which tests?", at: second(1) },
						"Tests pass.",
					],
					{ status: "running" },
				),
			);

			await waitFor(() => expect(thread.textContent).toContain("Tests pass."));
			expect(thread.textContent).not.toContain("Thinking");
		});

		it("folds a subagent's calls into its row", async () => {
			const thread = await opened(
				turn([
					tool({ id: "a1", kind: "think", title: "Find the callers" }),
					tool({ id: "g1", kind: "search", title: "grep fold", parent: "a1" }),
					tool({ id: "g2", kind: "read", title: "Read a.ts", parent: "a1" }),
					"Two callers.",
				]),
			);

			await waitFor(() => expect(thread.textContent).toContain("1 subagent"));
			const timeline = within(thread).getByRole("list", { name: "timeline" });
			expect(timeline.textContent).toContain("Find the callers· 2 tool calls");
			expect(timeline.textContent).not.toContain("Read 1 file");
		});
	});

	describe("review panel", () => {
		const reviewing = conversation({
			title: "Header",
			messages: [
				message(
					"agent",
					[
						"## 🔍 Ready to merge header onto main",
						"",
						"The header wraps on phones.",
						"",
						"Open the page at 390px wide.",
						"",
						'Reply "merge", or say what to change.',
					].join("\n"),
				),
			],
		});
		const box = (view: Awaited<ReturnType<typeof conversations>>) =>
			view.getByRole("textbox", {
				name: "Message input",
			}) as HTMLTextAreaElement;

		it("shows a review apart from questions, merging from the card", async () => {
			const view = await conversations([reviewing]);
			const panel = await waitFor(() =>
				view.getByRole("region", { name: "review header" }),
			);
			expect(
				within(panel).getByText("The header wraps on phones."),
			).toBeTruthy();
			expect(view.queryByText(/Reply "merge"/)).toBeNull();
			expect(view.queryByRole("list", { name: "questions" })).toBeNull();

			await act(async () =>
				fireEvent.click(within(panel).getByRole("button", { name: "Merge" })),
			);

			expect(box(view).value).toBe("");
			expect(posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "merge" } },
			]);
		});

		it("says what to change from the card by keyboard, kept as a draft until sent", async () => {
			const view = await conversations([reviewing]);
			const panel = await waitFor(() =>
				view.getByRole("region", { name: "review header" }),
			);
			const changes = within(panel).getByRole("textbox", {
				name: "Changes to header",
			}) as HTMLTextAreaElement;
			// Ready to answer as soon as it shows.
			await waitFor(() =>
				expect(document.activeElement === changes).toBe(true),
			);
			const merge = within(panel).getByRole("button", {
				name: "Merge",
			}) as HTMLButtonElement;
			expect(merge.disabled).toBe(false);

			await act(async () =>
				fireEvent.change(changes, {
					target: { value: "merge the header first" },
				}),
			);
			expect(changes.value).toBe("merge the header first");
			// Merging would leave the changes unsaid.
			expect(merge.disabled).toBe(true);
			expect(box(view).value).toBe("");
			expect(localStorage.getItem("arbor.draft.c1:review:0")).toBe(
				"merge the header first",
			);
			await act(async () =>
				fireEvent.keyDown(changes, { key: "Enter", shiftKey: true }),
			);
			expect(posted("/api/conversations/c1/prompt")).toEqual([]);
			await act(async () => fireEvent.keyDown(changes, { key: "Enter" }));

			expect(posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "merge the header first" } },
			]);
		});

		it("folds once the person has replied, opening on the reply that was sent, whatever is typed after", async () => {
			const view = await conversations([
				conversation({
					...reviewing,
					messages: [
						...reviewing.messages,
						message("user", "merge"),
						message("agent", "Merged."),
					],
				}),
			]);
			const panel = await waitFor(() =>
				view.getByRole("region", { name: "review header" }),
			);
			const fold = within(panel).getByRole("button", {
				name: /Ready to merge/,
			});
			expect(fold.getAttribute("aria-expanded")).toBe("false");
			expect(fold.textContent).toContain("Merge approved");
			expect(panel.textContent).not.toContain("The header wraps on phones.");

			await act(async () =>
				fireEvent.change(box(view), { target: { value: "merge" } }),
			);
			await act(async () => fireEvent.click(fold));

			expect(panel.textContent).toContain("The header wraps on phones.");
			expect(
				within(panel).queryByRole("button", { name: /^Merge/ }),
			).toBeNull();
			expect(within(panel).queryByRole("textbox")).toBeNull();
		});
	});

	describe("report cards", () => {
		it("shows how each task ended, or what it waits on, as a card", async () => {
			await conversations([
				conversation({
					title: "Reports",
					messages: [
						message(
							"agent",
							[
								"## ✅ Merged header onto main",
								"",
								"The header wraps now.",
								"",
								"## 🛑 Removed footer: superseded by a fix on main",
								"",
								"It set out to move the footer.",
								"",
								"## ⚠️ Escalated sidebar: needs a call on the width",
								"",
								"The sidebar folds on phones.",
							].join("\n"),
						),
					],
				}),
			]);
			const view = document.body;

			const merged = await waitFor(() =>
				within(view).getByRole("region", { name: "merged header" }),
			);
			expect(merged.textContent).toContain("Merged");
			expect(merged.textContent).toContain("main");
			expect(merged.textContent).toContain("The header wraps now.");
			const removed = within(view).getByRole("region", {
				name: "removed footer",
			});
			expect(removed.textContent).toContain("superseded by a fix on main");
			expect(removed.textContent).toContain("It set out to move the footer.");
			const escalated = within(view).getByRole("region", {
				name: "escalated sidebar",
			});
			expect(escalated.textContent).toContain("needs a call on the width");
			expect(view.textContent).not.toContain("## ✅");
		});

		/** Records each element scrolled into view while `run` runs, in `scrolled`. */
		const scrollingIntoView = async (
			run: (scrolled: Element[]) => Promise<void>,
		) => {
			const scrolled: Element[] = [];
			const scroll = spyOn(
				HTMLElement.prototype,
				"scrollIntoView",
			).mockImplementation(function (this: HTMLElement) {
				scrolled.push(this);
			});
			try {
				await run(scrolled);
			} finally {
				scroll.mockRestore();
			}
			return scrolled;
		};

		it("opens a conversation at its last turn's last report, clear of the person's message", async () => {
			let header: HTMLElement | undefined;
			const scrolled = await scrollingIntoView(async (seen) => {
				await conversations([
					conversation({
						messages: [
							message("user", "fix the footer"),
							message("agent", "## ✅ Merged footer onto main\n\nIt moved."),
							message("user", "fix the header"),
							message(
								"agent",
								[
									"## 🛑 Removed sidebar: superseded by a fix on main",
									"",
									"## ✅ Merged header onto main",
									"",
									"It wraps.",
								].join("\n"),
							),
						],
					}),
				]);
				header = await waitFor(() =>
					within(document.body).getByRole("region", { name: "merged header" }),
				);
				await waitFor(() => expect(seen.at(-1)).toBe(header));
			});

			expect(new Set<Element | undefined>(scrolled)).toEqual(new Set([header]));
			expect(header?.style.scrollMarginTop).toMatch(/^\d+(\.\d+)?px$/);
		});

		it("opens a conversation that talked on after a report at the bottom", async () => {
			const scrolled = await scrollingIntoView(async () => {
				await conversations([
					conversation({
						messages: [
							message("user", "fix the footer"),
							message("agent", "## ✅ Merged footer onto main\n\nIt moved."),
							message("user", "thanks"),
							message("agent", "Any time."),
						],
					}),
				]);
				await waitFor(() =>
					within(document.body).getByRole("region", { name: "merged footer" }),
				);
				await act(() => new Promise((done) => requestAnimationFrame(done)));
			});

			expect(scrolled).toEqual([]);
		});

		it("offers to archive the conversation from each report of a task that is over, then starts the next", async () => {
			const view = await conversations([
				conversation({
					messages: [
						message(
							"agent",
							"## ✅ Merged header onto main\n\nThe header wraps now.",
						),
						message("user", "now the footer"),
						message(
							"agent",
							[
								"## ⚠️ Escalated footer: needs a call on the color",
								"",
								"The footer is gray.",
								"",
								"## 🛑 Removed sidebar: superseded by a fix on main",
								"",
								"It set out to fold the sidebar.",
							].join("\n"),
						),
					],
				}),
			]);
			const archive = (name: string) =>
				within(view.getByRole("region", { name })).queryByRole("button", {
					name: "Archive",
				});

			const removed = await waitFor(() =>
				within(view.getByRole("region", { name: "removed sidebar" })).getByRole(
					"button",
					{ name: "Archive" },
				),
			);
			expect(archive("merged header")).not.toBeNull();
			expect(archive("escalated footer")).toBeNull();

			await act(async () => fireEvent.click(removed));

			expect(posted("/api/conversations/c1/archived")).toEqual([
				{ method: "PUT", body: { archived: true } },
			]);
			await waitFor(() => expect(location.hash).toBe("#conversations/new"));
			expect(view.getByText("Start a conversation with")).toBeTruthy();
		});
	});

	describe("todo cards", () => {
		const proposing = conversation({
			title: "Next",
			messages: [
				message(
					"agent",
					[
						"### 📝 Retry the upload [#12]",
						"",
						"It fails on a 413. It touches the retry loop.",
						"",
						"### 📝 Show the size limit [#14]",
						"",
						"Says how big a file may be.",
						"",
						"### 📝 Tidy the logs [#15]",
						"",
						"Already done.",
					].join("\n"),
				),
			],
		});

		const board = {
			todos: [
				todo({ id: 12, subject: "Retry the upload on a 413", lane: 3 }),
				todo({ id: 14, subject: "Show the size limit", takenBy: "limits" }),
			],
			lanes: [{ id: 3, name: "Uploads" }],
		};

		it("shows a proposed todo as the board has it, with Start sending its reference at once", async () => {
			const view = await conversations([proposing], undefined, board);
			const open = await waitFor(() =>
				view.getByRole("region", { name: "todo 12" }),
			);
			// Live: the subject as the board has it now, and its lane.
			expect(open.textContent).toContain("Retry the upload on a 413");
			expect(open.textContent).toContain("Uploads");
			expect(open.textContent).toContain("It fails on a 413.");
			const taken = view.getByRole("region", { name: "todo 14" });
			expect(taken.textContent).toContain("limits");
			expect(within(taken).queryByRole("button", { name: /Start/ })).toBeNull();
			const gone = view.getByRole("region", { name: "todo 15" });
			expect(gone.textContent).toContain("archived");
			expect(within(gone).queryByRole("button")).toBeNull();
			const box = view.getByRole("textbox", {
				name: "Message input",
			}) as HTMLTextAreaElement;
			await act(async () =>
				fireEvent.change(box, { target: { value: "half a thought" } }),
			);

			await act(async () =>
				fireEvent.click(within(open).getByRole("button", { name: "Start" })),
			);

			expect(posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "[ARBOR TODO #12]" } },
			]);
			expect(box.value).toBe("half a thought");
		});

		it("opens a new conversation with a proposed todo's reference typed in, ahead of its draft, and this conversation's agent picked", async () => {
			const view = await conversations(
				[conversation({ ...proposing, agent: "codex" })],
				undefined,
				board,
			);
			const open = await waitFor(() =>
				view.getByRole("region", { name: "todo 12" }),
			);
			const taken = view.getByRole("region", { name: "todo 14" });
			expect(
				within(taken).queryByRole("button", {
					name: "Start in a new conversation",
				}),
			).toBeNull();
			localStorage.setItem("arbor.draft.new:", "and keep it small");

			await act(async () =>
				fireEvent.click(
					within(open).getByRole("button", {
						name: "Start in a new conversation",
					}),
				),
			);

			expect(location.hash).toBe("#conversations/new/codex");
			expect(
				within(
					view.getByText("Start a conversation with")
						.parentElement as HTMLElement,
				).getByLabelText("Codex"),
			).toBeTruthy();
			expect(
				(
					view.getByRole("textbox", {
						name: "Message input",
					}) as HTMLTextAreaElement
				).value,
			).toBe("and keep it small");
			expect(view.getByTitle("[ARBOR TODO #12]")).toBeTruthy();
			expect(posted("/api/conversations")).toEqual([]);
			expect(posted("/api/conversations/c1/prompt")).toEqual([]);
		});

		it("keeps a todo as proposed once the person has replied, and says whether it was started", async () => {
			const view = await conversations(
				[
					conversation({
						...proposing,
						messages: [
							...proposing.messages,
							message("user", "[ARBOR TODO #12]"),
						],
					}),
				],
				undefined,
				board,
			);
			const started = await waitFor(() =>
				view.getByRole("region", { name: "todo 12" }),
			);

			expect(started.textContent).toContain("Retry the upload");
			// As proposed, not as the board has it now.
			expect(started.textContent).not.toContain("Uploads");
			expect(started.textContent).toContain("Started");
			expect(
				within(started).queryByRole("button", { name: /Start/ }),
			).toBeNull();
			const other = view.getByRole("region", { name: "todo 15" });
			expect(other.textContent).not.toContain("archived");
			expect(other.textContent).not.toContain("Started");
		});

		it("opens a proposed todo from its subject, over the conversation", async () => {
			const view = await conversations([proposing], undefined, board);
			const open = await waitFor(() =>
				view.getByRole("region", { name: "todo 12" }),
			);

			await act(async () =>
				fireEvent.click(
					within(open).getByRole("button", {
						name: "Retry the upload on a 413",
					}),
				),
			);

			const dialog = await waitFor(() =>
				view.getByRole("dialog", { name: /Todo 12/ }),
			);
			expect(
				(
					within(dialog).getByRole("textbox", {
						name: "subject",
					}) as HTMLInputElement
				).value,
			).toBe("Retry the upload on a 413");
			// Over the conversation, which stays where it was.
			expect(location.hash).toStartWith("#conversations/");
		});

		it("opens a todo mentioned in a message, and shows one that is gone as archived", async () => {
			const view = await conversations(
				[
					conversation({
						title: "Mentions",
						messages: [
							message("user", "[ARBOR TODO #14] and #15"),
							message("agent", "Took #12, but not `#14`. #15 merged."),
						],
					}),
				],
				undefined,
				board,
			);
			const twelve = await waitFor(() =>
				view.getByRole("button", { name: "#12" }),
			);
			expect(twelve.title).toBe("Retry the upload on a 413");
			// In code, it is only what was typed.
			expect(view.getByText("#14", { selector: "code" })).toBeTruthy();
			// Gone from the list, in both the person's words and the agent's.
			expect(
				view.getAllByTitle("#15 is archived: merged or removed"),
			).toHaveLength(2);

			await act(async () =>
				fireEvent.click(view.getByRole("button", { name: "#14" })),
			);
			await waitFor(() =>
				expect(view.getByRole("dialog", { name: /Todo 14/ })).toBeTruthy(),
			);
			await act(async () => fireEvent.click(twelve));
			await waitFor(() =>
				expect(view.getByRole("dialog", { name: /Todo 12/ })).toBeTruthy(),
			);
		});
	});

	describe("drafts", () => {
		const held = [
			conversation({ id: "c1", title: "Fix login" }),
			conversation({ id: "c2", title: "Tidy tests" }),
		];
		/** Opens the conversation listed by `name`, as a click in the sidebar does. */
		const go = async (
			view: Awaited<ReturnType<typeof conversations>>,
			name: string,
		) => {
			const nav = view.getByRole("navigation", { name: "conversations" });
			const item = within(nav)
				.getAllByRole("button")
				.find((button) => button.textContent?.includes(name));
			if (item === undefined) {
				throw new Error(`no ${name} listed`);
			}
			await act(async () => fireEvent.click(item));
		};
		const box = (view: Awaited<ReturnType<typeof conversations>>) =>
			view.getByRole("textbox", {
				name: "Message input",
			}) as HTMLTextAreaElement;
		const type = (
			view: Awaited<ReturnType<typeof conversations>>,
			text: string,
		) =>
			act(async () => fireEvent.change(box(view), { target: { value: text } }));

		it("keeps what was typed in each conversation, and a new one, while switching", async () => {
			const view = await conversations(held, "c1");
			await type(view, "half a thought");

			await go(view, "Tidy tests");
			await waitFor(() => expect(box(view).value).toBe(""));
			await type(view, "another");
			await newWith(view, "Claude");
			await waitFor(() => expect(box(view).value).toBe(""));
			await type(view, "a fresh start");

			await go(view, "Fix login");
			await waitFor(() => expect(box(view).value).toBe("half a thought"));
			await go(view, "Tidy tests");
			await waitFor(() => expect(box(view).value).toBe("another"));
			await newWith(view, "Claude");
			await waitFor(() => expect(box(view).value).toBe("a fresh start"));
		});

		it("keeps a draft across a reload, and drops it once sent", async () => {
			const view = await conversations(held, "c1");
			await type(view, "before the reload");
			cleanup();

			const again = await conversations(held, "c1");
			await waitFor(() => expect(box(again).value).toBe("before the reload"));
			await act(async () => fireEvent.keyDown(box(again), { key: "Enter" }));
			expect(posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "before the reload" } },
			]);
			await go(again, "Tidy tests");
			await go(again, "Fix login");
			await waitFor(() => expect(box(again).value).toBe(""));
		});

		it("holds a directive typed at the start as a chip, and sends it ahead of the words", async () => {
			const view = await conversations(held, "c1");
			await type(view, "[ARBOR TODO #12] and keep it small");

			await waitFor(() => expect(box(view).value).toBe("and keep it small"));
			expect(view.getByTitle("[ARBOR TODO #12]")).toBeTruthy();
			expect(localStorage.getItem("arbor.draft.c1")).toBe(
				"[ARBOR TODO #12]\n\nand keep it small",
			);

			await act(async () => fireEvent.keyDown(box(view), { key: "Enter" }));
			expect(posted("/api/conversations/c1/prompt")).toEqual([
				{
					method: "POST",
					body: { text: "[ARBOR TODO #12]\n\nand keep it small" },
				},
			]);
			await waitFor(() =>
				expect(view.queryByTitle("[ARBOR TODO #12]")).toBeNull(),
			);
			expect(localStorage.getItem("arbor.draft.c1") ?? "").toBe("");
		});

		it("sends a directive kept in a draft with nothing typed", async () => {
			localStorage.setItem("arbor.draft.c1", "[ARBOR TASK alpha]");
			const view = await conversations(held, "c1");
			await waitFor(() =>
				expect(view.getByTitle("[ARBOR TASK alpha]").textContent).toBe(
					"Taskalpha",
				),
			);
			expect(box(view).value).toBe("");

			await act(async () => fireEvent.keyDown(box(view), { key: "Enter" }));
			expect(posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "[ARBOR TASK alpha]" } },
			]);
		});

		it("drops a directive from the draft when its chip is removed", async () => {
			const view = await conversations(held, "c1");
			await type(view, "[ARBOR LANE 2]");
			await type(view, "then stop");

			await act(async () =>
				fireEvent.click(
					view.getByRole("button", { name: "Remove [ARBOR LANE 2]" }),
				),
			);

			expect(view.queryByTitle("[ARBOR LANE 2]")).toBeNull();
			expect(box(view).value).toBe("then stop");
			expect(localStorage.getItem("arbor.draft.c1")).toBe("then stop");
		});

		it("puts a message back in the composer when the server refuses it", async () => {
			const view = await conversations(held, "c1");
			testing.refuseWrites = { reason: "usage", message: "not now" };
			await type(view, "try this");

			await act(async () => fireEvent.keyDown(box(view), { key: "Enter" }));

			await waitFor(() => expect(box(view).value).toBe("try this"));
		});

		it("sends while the agent works, offering Send over Stop once something is typed", async () => {
			const view = await conversations(
				[conversation({ id: "c1", title: "Fix login", status: "running" })],
				"c1",
			);
			expect(
				view.getByRole("button", { name: "Stop generating" }),
			).toBeTruthy();

			await type(view, "use the second note");

			expect(
				view.queryByRole("button", { name: "Stop generating" }),
			).toBeNull();
			await act(async () => fireEvent.keyDown(box(view), { key: "Enter" }));
			await waitFor(() =>
				expect(posted("/api/conversations/c1/prompt")).toEqual([
					{ method: "POST", body: { text: "use the second note" } },
				]),
			);
			// Sent mid-turn, it stops nothing.
			expect(posted("/api/conversations/c1/send-now")).toEqual([]);
		});

		it("holds a queued message above the composer, out of the thread, to send now or take back with Up", async () => {
			const view = await conversations(
				[
					conversation({
						id: "c1",
						title: "Fix login",
						status: "running",
						messages: [
							message("user", "go"),
							message("agent", { type: "text", text: "On it." }),
							{ ...message("user", "the second note"), queued: true },
						],
					}),
				],
				"c1",
			);

			const queued = view.getByRole("region", { name: "queued messages" });
			expect(
				within(queued)
					.getAllByRole("listitem")
					.map((each) => each.textContent),
			).toEqual(["the second note"]);
			expect(view.getAllByText(/the second note/)).toHaveLength(1);

			await act(async () =>
				fireEvent.click(
					within(queued).getByRole("button", { name: /Send now/ }),
				),
			);
			expect(posted("/api/conversations/c1/send-now")).toHaveLength(1);
			// Enter with nothing typed, as in Zed, which the button says until
			// something is typed.
			const send = within(queued).getByRole("button", { name: /Send now/ });
			expect(send.textContent).toBe("Send now↵");
			await type(view, "more");
			expect(send.textContent).toBe("Send now");
			// With something typed, Enter queues it and sends nothing now.
			await act(async () => fireEvent.keyDown(box(view), { key: "Enter" }));
			await waitFor(() =>
				expect(posted("/api/conversations/c1/prompt")).toEqual([
					{ method: "POST", body: { text: "more" } },
				]),
			);
			expect(posted("/api/conversations/c1/send-now")).toHaveLength(1);
			await waitFor(() => expect(box(view).value).toBe(""));
			await act(async () => fireEvent.keyDown(box(view), { key: "Enter" }));
			expect(posted("/api/conversations/c1/send-now")).toHaveLength(2);
			testing.reply = { text: "the second note", images: [] };
			await act(async () => fireEvent.keyDown(box(view), { key: "ArrowUp" }));
			expect(posted("/api/conversations/c1/unqueue")).toEqual([
				{ method: "POST", body: { index: 0 } },
			]);
			await waitFor(() => expect(box(view).value).toBe("the second note"));
		});

		it("throws a queued message away, leaving the composer as it was", async () => {
			const view = await conversations(
				[
					conversation({
						id: "c1",
						title: "Fix login",
						status: "running",
						messages: [
							message("user", "go"),
							{ ...message("user", "the first note"), queued: true },
							{ ...message("user", "the second note"), queued: true },
						],
					}),
				],
				"c1",
			);
			await type(view, "still typing");

			const queued = view.getByRole("region", { name: "queued messages" });
			testing.reply = { text: "the second note", images: [] };
			await act(async () =>
				fireEvent.click(
					within(queued).getByRole("button", {
						name: "Discard the second note",
					}),
				),
			);

			expect(posted("/api/conversations/c1/unqueue")).toEqual([
				{ method: "POST", body: { index: 1 } },
			]);
			expect(box(view).value).toBe("still typing");
		});

		it("keeps what was typed into a question's box while away", async () => {
			const asking = conversation({
				id: "c1",
				title: "Fix login",
				status: "running",
				ask: {
					type: "question",
					id: "q1",
					at: "2026-10-11T10:00:00.000Z",
					message: "Which note?",
					fields: [
						{ key: "note", title: "Note", description: null, choices: null },
					],
				},
			});
			const view = await conversations(
				[asking, held[1] as ConversationState],
				"c1",
			);
			await act(async () =>
				fireEvent.change(view.getByRole("textbox", { name: "Note" }), {
					target: { value: "the second one" },
				}),
			);

			await go(view, "Tidy tests");
			await go(view, "Fix login");

			expect(
				(view.getByRole("textbox", { name: "Note" }) as HTMLInputElement).value,
			).toBe("the second one");
		});
	});

	it("scrolls the thread at once, even when asked to glide", async () => {
		const view = await conversations([
			conversation({ id: "c1", title: "Fix login" }),
		]);
		const thread = view.container.ownerDocument.querySelector(
			'[data-slot="aui_thread-viewport"]',
		) as HTMLElement;
		const scrolled: unknown[] = [];
		const scroll = spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(
			(options?: unknown) => {
				scrolled.push(options);
			},
		);
		try {
			thread.scrollTo({ top: 40, behavior: "smooth" });
		} finally {
			scroll.mockRestore();
		}

		expect(scrolled).toEqual([{ top: 40, behavior: "instant" }]);
	});

	it("answers a permission with a digit: 1 denies, 2 allows once, 3 always", async () => {
		await conversations([
			conversation({
				status: "running",
				ask: {
					type: "permission",
					id: "t1",
					at: "2026-10-11T10:00:00.000Z",
					title: "rm -rf build",
					options: [
						{ id: "yes", name: "Allow", kind: "allow_once" },
						{ id: "no", name: "Reject", kind: "reject_once" },
					],
				},
			}),
		]);

		await act(async () => fireEvent.keyDown(document.body, { key: "1" }));

		expect(posted("/api/conversations/c1/answer")).toEqual([
			{
				method: "POST",
				body: { ask: "t1", answer: { type: "permission", option: "no" } },
			},
		]);
	});

	it("answers a question form with the choices picked", async () => {
		const view = await conversations([
			conversation({
				status: "running",
				ask: {
					type: "question",
					id: "q1",
					at: "2026-10-11T10:00:00.000Z",
					message: "Uppercase the note?",
					fields: [
						{
							key: "question_0",
							title: "Uppercase",
							description: null,
							choices: [
								{ value: "yes", title: "Yes", description: null },
								{ value: "no", title: "No", description: null },
							],
						},
						{
							key: "question_0_custom",
							title: "Other",
							description: "Your own answer",
							choices: null,
						},
					],
				},
			}),
		]);
		const form = view.getByRole("form", { name: "question" });

		await act(async () =>
			fireEvent.change(within(form).getByRole("textbox", { name: "Other" }), {
				target: { value: "only the first line" },
			}),
		);
		await act(async () =>
			fireEvent.click(within(form).getByRole("button", { name: /No/ })),
		);

		expect(posted("/api/conversations/c1/answer")).toEqual([
			{
				method: "POST",
				body: {
					ask: "q1",
					answer: {
						type: "question",
						values: {
							question_0: "no",
							question_0_custom: "only the first line",
						},
					},
				},
			},
		]);
	});

	it("switches a setting, and archives the idle conversation at once, with no shell up", async () => {
		const view = await conversations([
			conversation({
				settings: [
					{
						id: "model",
						name: "Model",
						type: "select",
						category: "model",
						current: "big",
						options: [
							{ value: "big", name: "Big", description: null },
							{ value: "small", name: "Small", description: null },
						],
					},
				],
			}),
		]);

		await act(async () =>
			fireEvent.click(view.getByRole("combobox", { name: "model" })),
		);
		await pick(
			await waitFor(() => view.getByRole("option", { name: "Small" })),
		);
		await act(async () =>
			fireEvent.click(
				within(view.getByRole("navigation", { name: "actions" })).getByRole(
					"button",
					{ name: "Archive" },
				),
			),
		);

		expect(view.queryByRole("dialog")).toBeNull();
		expect(posted("/api/conversations/c1/setting")).toEqual([
			{ method: "PUT", body: { id: "model", value: "small" } },
		]);
		expect(posted("/api/conversations/c1/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
	});

	it("shows an effort picker by its value alone", async () => {
		const view = await conversations([
			conversation({
				settings: [
					{
						id: "effort",
						name: "Effort",
						type: "select",
						category: "thought_level",
						current: "high",
						options: [
							{ value: "low", name: "Low", description: null },
							{ value: "high", name: "High", description: null },
						],
					},
				],
			}),
		]);

		const effort = view.getByRole("combobox", { name: "effort" });
		await waitFor(() => expect(effort.textContent).toContain("High"));
		expect(effort.textContent).not.toContain("Effort");
	});

	it("switches an on/off setting with a switch", async () => {
		const view = await conversations([
			conversation({
				settings: [
					{
						id: "fast",
						name: "Fast mode",
						type: "boolean",
						category: "model_config",
						current: "off",
						options: [
							{ value: "on", name: "On", description: null },
							{ value: "off", name: "Off", description: null },
						],
					},
				],
			}),
		]);

		const fast = view.getByRole("switch", { name: "Fast mode" });
		expect(fast.getAttribute("aria-checked")).toBe("false");
		await act(async () => fireEvent.click(fast));

		expect(posted("/api/conversations/c1/setting")).toEqual([
			{ method: "PUT", body: { id: "fast", value: "on" } },
		]);
	});

	it("offers each agent's own settings on the home, a pick for one never reaching the other", async () => {
		const model = (current: string, names: string[]) => ({
			id: "model",
			name: "Model",
			type: "select" as const,
			category: "model",
			current,
			options: names.map((name) => ({
				value: name.toLowerCase(),
				name,
				description: null,
			})),
		});
		const view = await conversations(
			[
				conversation({
					id: "c1",
					settings: [model("opus", ["Opus", "Sonnet"])],
				}),
				conversation({
					id: "c2",
					agent: "codex",
					title: "Other",
					settings: [model("luna", ["Luna", "Sol"])],
				}),
			],
			null,
		);
		await act(async () =>
			fireEvent.click(view.getByRole("combobox", { name: "model" })),
		);
		await pick(
			await waitFor(() => view.getByRole("option", { name: "Sonnet" })),
		);

		await newWith(view, "Codex");

		await waitFor(() =>
			expect(
				view.getByRole("combobox", { name: "model" }).textContent,
			).toContain("Luna"),
		);
	});

	it("shows an archived conversation shut, to unarchive", async () => {
		const view = await conversations([], null);
		await testing.say(conversation({ status: "stopped", archived: true }));
		await act(async () => {
			location.hash = "#conversations/c1";
			window.dispatchEvent(new HashChangeEvent("hashchange"));
		});

		expect(
			(
				view.getByRole("textbox", {
					name: "Message input",
				}) as HTMLTextAreaElement
			).disabled,
		).toBe(true);
		await act(async () =>
			fireEvent.click(
				within(view.getByRole("navigation", { name: "actions" })).getByRole(
					"button",
					{ name: "Unarchive" },
				),
			),
		);
		expect(posted("/api/conversations/c1/archived")).toEqual([
			{ method: "PUT", body: { archived: false } },
		]);
	});

	it("shows why a conversation failed, and takes a prompt to resume it", async () => {
		const view = await conversations([
			conversation({ status: "failed", error: "Claude exited with code 1" }),
		]);

		expect(view.getByRole("alert").textContent).toBe(
			"Claude exited with code 1",
		);
		expect(
			(
				view.getByRole("textbox", {
					name: "Message input",
				}) as HTMLTextAreaElement
			).disabled,
		).toBe(false);
	});

	describe("the sidebar's marks", () => {
		const ask = {
			type: "permission" as const,
			id: "t1",
			at: "2026-10-11T10:00:00.000Z",
			title: "rm -rf build",
			options: [{ id: "yes", name: "Allow", kind: "allow_once" as const }],
		};

		/** Opens the page on Conversations, holding `held`, with `tasks` live. */
		const sidebar = async (
			held: ConversationState[],
			tasks = [details({ task: "alpha" })],
		) => {
			testing.talk = { agents: AGENTS, conversations: held };
			const view = await testing.open({ tasks });
			await act(async () =>
				fireEvent.click(
					await waitFor(() => view.getByRole("tab", { name: /Conversations/ })),
				),
			);
			return view;
		};

		/** Started a minute apart, the first last, so the list shows them in order. */
		const newestFirst = (held: ConversationState[]) =>
			held.map((each, at) => ({
				...each,
				createdAt: new Date(Date.UTC(2026, 9, 11, 10, 59 - at)).toISOString(),
			}));

		const PLAN = `# a task

## Goal

Cap upload retries

## Done

- [x] find the retry loop

## Next

- [ ] cap retries
- [ ] tell the user

## Blocked

- [ ] 1. How many retries?
`;

		/** The actions' first button: what the agent waits on you for. */
		const questionsButton = (view: Awaited<ReturnType<typeof sidebar>>) =>
			within(view.getByRole("navigation", { name: "actions" })).getAllByRole(
				"button",
			)[0] as HTMLElement;

		const rows = (view: Awaited<ReturnType<typeof sidebar>>) =>
			within(view.getByRole("navigation", { name: "conversations" }))
				.getAllByRole("listitem")
				.map((row) => [
					row.textContent,
					within(row).queryByRole("status")?.getAttribute("aria-label") ?? null,
				]);

		it("marks each agent waiting on you or working, and an idle one not at all", async () => {
			const view = await sidebar(
				newestFirst([
					conversation({ id: "c1", title: "Asks", status: "running", ask }),
					conversation({ id: "c2", title: "Runs", status: "running" }),
					conversation({ id: "c3", title: "Rests" }),
					conversation({ id: "c4", title: "Broke", status: "failed" }),
					conversation({ id: "c5", task: "alpha", title: "Plans" }),
				]),
			);

			expect(rows(view)).toEqual([
				["Asks", "waiting on you"],
				["Runs", "working"],
				["Rests", null],
				["Broke", "waiting on you"],
				["alpha", null],
			]);
		});

		it("marks a conversation whose task merged with the merge icon until the person carries on, one that escalated as waiting on you, and one removed not at all", async () => {
			const view = await sidebar(
				newestFirst([
					conversation({
						id: "c1",
						title: "Landed",
						messages: [
							message("agent", "## ✅ Merged header onto main\n\nIt wraps."),
						],
					}),
					conversation({
						id: "c2",
						title: "Dropped",
						messages: [
							message(
								"agent",
								"## 🛑 Removed footer: superseded\n\nIt moved the footer.",
							),
						],
					}),
					conversation({
						id: "c3",
						title: "Carried on",
						messages: [
							message("agent", "## ✅ Merged header onto main\n\nIt wraps."),
							message("user", "now the footer"),
						],
					}),
					conversation({
						id: "c4",
						task: "alpha",
						title: "Stuck",
						messages: [
							message(
								"agent",
								"## ⚠️ Escalated sidebar: needs a call\n\nIt folds.",
							),
						],
					}),
				]),
				[
					details({
						task: "alpha",
						status: "escalated",
						escalation: "needs a call",
						escalatedAt: "2026-10-11T10:00:00.000Z",
					}),
				],
			);
			const marks = Object.fromEntries(
				within(view.getByRole("navigation", { name: "conversations" }))
					.getAllByRole("listitem")
					.map((row) => [
						row.textContent,
						(
							within(row).queryByRole("img", { name: "merged" }) ??
							within(row).queryByRole("status")
						)?.getAttribute("aria-label") ?? null,
					]),
			);

			expect(marks).toEqual({
				Landed: "merged",
				Dropped: null,
				"Carried on": null,
				alpha: "waiting on you",
			});
		});

		it("marks an agent that answered unseen with a blue dot, though not over a merge, waiting on you, or working", async () => {
			const view = await sidebar(
				newestFirst([
					conversation({ id: "c1", title: "Answered", unread: true }),
					conversation({
						id: "c2",
						title: "Landed",
						unread: true,
						messages: [
							message("agent", "## ✅ Merged header onto main\n\nIt wraps."),
						],
					}),
					conversation({
						id: "c3",
						title: "Broke",
						status: "failed",
						unread: true,
					}),
					conversation({
						id: "c4",
						title: "Runs",
						status: "running",
						unread: true,
					}),
				]),
				[],
			);

			expect(rows(view)).toEqual([
				["Answered", "unread"],
				["Landed", null],
				["Broke", "waiting on you"],
				["Runs", "working"],
			]);
			expect(view.getByRole("img", { name: "merged" })).toBeDefined();
		});

		it("lists a task whose agent runs outside the page as working elsewhere, waiting once it escalates, and opens it alone with its questions, not its plan", async () => {
			const view = await sidebar(
				[conversation({ id: "c1", task: "alpha", title: "Fix login" })],
				[
					details({ task: "alpha" }),
					details({ task: "beta", createdAt: "2026-10-11T09:58:00.000Z" }),
					details({
						task: "gamma",
						status: "escalated",
						escalation: "needs a call",
						escalatedAt: "2026-10-11T10:00:00.000Z",
						plan: PLAN,
					}),
				],
			);

			expect(rows(view)).toEqual([
				["alpha", null],
				["beta", "working elsewhere"],
				["gamma", "waiting on you"],
			]);
			await act(async () =>
				fireEvent.click(view.getByRole("button", { name: /gamma/ })),
			);
			expect(location.hash).toBe("#conversations/task/gamma");
			const alone = view.getByRole("region", { name: "gamma" });
			// Not its ARBOR.md, which the task line opens: what the page knows of the agent.
			expect(alone.textContent).not.toContain("Cap upload retries");
			expect(alone.textContent).toContain("Escalated: needs a call");
			expect(alone.textContent).toContain("Its agent runs outside the page");
			expect(
				within(alone).getByRole("list", { name: "questions" }).textContent,
			).toContain("How many retries?");
			// Its agent cannot be messaged: the cards copy their reply.
			const copied: string[] = [];
			Object.defineProperty(navigator, "clipboard", {
				configurable: true,
				value: { writeText: async (text: string) => void copied.push(text) },
			});
			await act(async () =>
				fireEvent.change(
					within(alone).getByRole("textbox", { name: "Answer to 1" }),
					{ target: { value: "three" } },
				),
			);
			await act(async () =>
				fireEvent.click(
					within(alone).getByRole("button", { name: "Copy reply" }),
				),
			);
			// Numbered as in its Blocked, which may not be how it last asked them.
			expect(copied).toEqual([blockedReply("1. three")]);
			// The only one waiting, Alt+N goes to its open question where it is.
			await act(async () =>
				fireEvent.keyDown(document.body, { code: "KeyN", altKey: true }),
			);
			expect(document.activeElement).toBe(
				within(alone).getByRole("textbox", { name: "Answer to 1" }),
			);
			expect(
				within(alone).getByRole("button", { name: "Copied" }),
			).toBeTruthy();
			await act(async () =>
				fireEvent.click(
					within(alone).getByRole("button", { name: "About gamma" }),
				),
			);
			const dialog = await waitFor(() =>
				view.getByRole("dialog", { name: "gamma" }),
			);
			expect(dialog.textContent).toContain("Cap upload retries");
		});

		it("brings a session in from a task whose agent runs outside the page, and opens it", async () => {
			testing.sessions = [
				{
					agent: "claude",
					session: "cli-1",
					title: "Fix the upload",
					updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
				},
			];
			const view = await sidebar([], [details({ task: "beta" })]);
			await act(async () =>
				fireEvent.click(view.getByRole("button", { name: /beta/ })),
			);
			const sessions = await waitFor(() =>
				within(view.getByRole("region", { name: "beta" })).getByRole("region", {
					name: "sessions",
				}),
			);
			await waitFor(() =>
				expect(sessions.textContent).toContain("Fix the upload"),
			);
			expect(sessions.textContent).toContain("5m ago");
			testing.reply = conversation({
				id: "c9",
				task: "beta",
				title: "Fix the upload",
				status: "starting",
			});

			await act(async () =>
				fireEvent.click(
					within(sessions).getByRole("button", { name: "Bring in" }),
				),
			);

			await waitFor(() => expect(location.hash).toBe("#conversations/c9"));
			expect(testing.posts.at(-1)).toMatchObject({
				path: "/api/conversations/sessions",
				method: "POST",
			});
			expect(JSON.parse(String(testing.posts.at(-1)?.body))).toEqual({
				agent: "claude",
				session: "cli-1",
				title: "Fix the upload",
				task: "beta",
			});
			// Its thread, named for its task, as one started here is.
			await waitFor(() =>
				expect(
					view.getByRole("region", { name: "beta" }).textContent,
				).toContain("starting"),
			);
		});

		it("says when no session in a task's tree can be brought in", async () => {
			const view = await sidebar([], [details({ task: "beta" })]);
			await act(async () =>
				fireEvent.click(view.getByRole("button", { name: /beta/ })),
			);

			await waitFor(() =>
				expect(
					view.getByRole("region", { name: "sessions" }).textContent,
				).toContain("None the page could bring in."),
			);
		});

		it("heads a conversation with its branch and progress, which open its task", async () => {
			const view = await sidebar(
				[
					conversation({
						id: "c1",
						task: "alpha",
						title: "Fix login",
						status: "running",
					}),
				],
				[details({ task: "alpha", plan: PLAN })],
			);
			await act(async () =>
				fireEvent.click(view.getByRole("button", { name: "Claude alpha" })),
			);
			const about = view.getByRole("button", { name: "About alpha" });

			expect(about.textContent).toBe("task/alpha· 1/3");
			await act(async () => fireEvent.click(about));
			const dialog = await waitFor(() =>
				view.getByRole("dialog", { name: "alpha" }),
			);
			expect(dialog.textContent).toContain("Cap upload retries");
		});

		it("says among a conversation's actions whether it has open questions, answering them in a dialog while no card in the thread asks them", async () => {
			const view = await sidebar(
				[
					conversation({ id: "c1", task: "alpha", status: "running" }),
					conversation({ id: "c2", task: null, title: "Look around" }),
				],
				[details({ task: "alpha", plan: PLAN })],
			);
			await act(async () =>
				fireEvent.click(
					view.getByRole("button", { name: "Claude Look around" }),
				),
			);
			expect(
				view.getByRole("region", { name: "Look around" }).textContent,
			).toContain("No open questions");
			await act(async () =>
				fireEvent.click(view.getByRole("button", { name: "Claude alpha" })),
			);
			expect(
				within(view.getByRole("navigation", { name: "actions" })).getByRole(
					"button",
					{ name: /1 open question/ },
				).textContent,
			).toBe("1 open question");
			// At work on a guess, it has asked them only in its plan: no card
			// crowds the conversation.
			expect(
				view.queryByRole("region", { name: "questions for you" }),
			).toBeNull();
			await act(async () => fireEvent.click(questionsButton(view)));
			const dialog = await waitFor(() =>
				view.getByRole("dialog", { name: "Open questions" }),
			);
			const answer = within(dialog).getByRole("textbox", {
				name: "Answer to 1",
			});
			await waitFor(() => expect(document.activeElement).toBe(answer));
			await act(async () =>
				fireEvent.change(answer, { target: { value: "three" } }),
			);
			await act(async () =>
				fireEvent.click(within(dialog).getByRole("button", { name: "Send" })),
			);
			expect(posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: blockedReply("1. three") } },
			]);
			await waitFor(() =>
				expect(
					view.queryByRole("dialog", { name: "Open questions" }),
				).toBeNull(),
			);
		});

		it("goes round the agents with open questions by keyboard alone: Alt+N, answer, ⌘Enter, Alt+N", async () => {
			const plan = (question: string) =>
				PLAN.replace(
					"- [ ] 1. How many retries?",
					`- [ ] 3. ${question}\n  - (a) Yes\n  - (b) No`,
				);
			const working = conversation({
				id: "c1",
				task: "alpha",
				status: "running",
				messages: [message("user", "cap the retries")],
			});
			const view = await sidebar(
				newestFirst([
					conversation({ id: "c0", title: "Idle" }),
					working,
					conversation({
						id: "c2",
						task: "beta",
						messages: [message("user", "fix the header")],
					}),
				]),
				[
					details({ task: "alpha", plan: plan("Cap at three?") }),
					details({ task: "beta", plan: plan("Wrap on phones?") }),
				],
			);
			const altN = () =>
				act(async () =>
					fireEvent.keyDown(document.body, { altKey: true, code: "KeyN" }),
				);
			const answer = async (key: string) => {
				// In a dialog, as no card in the thread asks them, focused on
				// arrival, ready for a letter.
				const first = await waitFor(() => {
					const focused = document.activeElement as HTMLElement;
					expect(
						view
							.getByRole("dialog", { name: "Open questions" })
							.contains(focused),
					).toBe(true);
					expect(focused.dataset.stop).toBe("3");
					return focused;
				});
				await act(async () => fireEvent.keyDown(first, { key }));
				await act(async () =>
					fireEvent.keyDown(first, { key: "Enter", metaKey: true }),
				);
			};

			// Asking as it works.
			await altN();
			expect(location.hash).toBe("#conversations/c1");
			await answer("a");
			expect(posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: blockedReply("3. a") } },
			]);
			await testing.say({
				...working,
				messages: [...working.messages, message("user", blockedReply("3. a"))],
			});
			await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());

			// Stopped on you.
			await altN();
			expect(location.hash).toBe("#conversations/c2");
			await answer("b");
			expect(posted("/api/conversations/c2/prompt")).toEqual([
				{ method: "POST", body: { text: blockedReply("3. b") } },
			]);
			// Its turn over, with the answer yet to be written down.
			await testing.say(
				conversation({
					id: "c2",
					task: "beta",
					messages: [
						message("user", "fix the header"),
						message("user", blockedReply("3. b")),
						message("agent", "Noted."),
					],
				}),
			);

			// Both answers wait on their agents to write them down: none again.
			await act(async () =>
				fireEvent.click(view.getByRole("button", { name: "Claude Idle" })),
			);
			await altN();
			expect(location.hash).toBe("#conversations/c0");
		});

		it("asks in a dialog only the open questions a reply to a card left unanswered, and none a card still asks", async () => {
			const blocked = `${PLAN}- [ ] 2. Should it wrap?\n`;
			const asked = message(
				"agent",
				"1. How many retries?\n2. Should it wrap?",
			);
			const view = await sidebar(
				[
					conversation({
						id: "c1",
						task: "alpha",
						title: "Asked",
						messages: [message("user", "cap retries"), asked],
					}),
				],
				[details({ task: "alpha", plan: blocked })],
			);
			await act(async () =>
				fireEvent.click(view.getByRole("button", { name: "Claude alpha" })),
			);
			// The card the thread ends on asks them all: its action goes there.
			await act(async () => fireEvent.click(questionsButton(view)));
			expect(view.queryByRole("dialog", { name: "Open questions" })).toBeNull();
			expect(
				view
					.getByRole("region", { name: "questions for you" })
					.contains(document.activeElement),
			).toBe(true);

			await testing.say(
				conversation({
					id: "c1",
					task: "alpha",
					title: "Asked",
					status: "running",
					messages: [
						message("user", "cap retries"),
						asked,
						message("user", "1. three"),
						message("agent", "Capping them."),
					],
				}),
			);

			await waitFor(() => view.getByText("Capping them."));
			// The one answered waits on the agent, not on you.
			expect(
				within(view.getByRole("navigation", { name: "actions" })).getByRole(
					"button",
					{ name: /1 open question/ },
				),
			).toBeTruthy();
			await act(async () => fireEvent.click(questionsButton(view)));
			const dialog = await waitFor(() =>
				view.getByRole("dialog", { name: "Open questions" }),
			);
			expect(
				within(dialog)
					.getAllByRole("listitem")
					.map((card) => card.getAttribute("aria-label")),
			).toEqual(["question 2"]);
		});

		it("asks in a dialog the open questions of an escalation that did not list them", async () => {
			const view = await sidebar(
				[
					conversation({
						id: "c1",
						task: "alpha",
						title: "Stuck",
						messages: [
							message(
								"agent",
								"## ⚠️ Escalated alpha: needs a call\n\nIt caps.",
							),
						],
					}),
				],
				[
					details({
						task: "alpha",
						status: "escalated",
						escalation: "needs a call",
						escalatedAt: "2026-10-11T10:00:00.000Z",
						plan: PLAN,
					}),
				],
			);
			await act(async () =>
				fireEvent.click(view.getByRole("button", { name: "Claude alpha" })),
			);
			await act(async () =>
				fireEvent.click(
					within(view.getByRole("navigation", { name: "actions" })).getByRole(
						"button",
						{ name: /1 open question/ },
					),
				),
			);

			expect(
				(
					await waitFor(() =>
						view.getByRole("dialog", { name: "Open questions" }),
					)
				).textContent,
			).toContain("How many retries?");
		});

		it("counts the agents waiting on you on the tab and in the title", async () => {
			const view = await sidebar(
				[conversation({ id: "c1", title: "Asks", status: "running", ask })],
				[details({ task: "beta", status: "escalated" })],
			);

			expect(view.getByRole("tab", { name: /Conversations/ }).textContent).toBe(
				"Conversations2",
			);
			expect(document.title).toBe("(2) webappwiz");
		});

		it("moves between rows with the arrow keys, and opens the next one waiting with Alt+N", async () => {
			const view = await sidebar(
				newestFirst([
					conversation({ id: "c1", title: "Runs", status: "running" }),
					conversation({ id: "c2", title: "Asks", status: "running", ask }),
					conversation({ id: "c3", title: "Broke", status: "failed" }),
				]),
			);
			const nav = view.getByRole("navigation", { name: "conversations" });
			const runs = within(nav).getByRole("button", {
				name: "Claude Runs",
			});
			runs.focus();

			await act(async () => fireEvent.keyDown(runs, { key: "ArrowDown" }));
			expect(document.activeElement?.textContent).toBe("Asks");
			await act(async () =>
				fireEvent.keyDown(document.body, { altKey: true, code: "KeyN" }),
			);
			expect(location.hash).toBe("#conversations/c2");
			await act(async () =>
				fireEvent.keyDown(document.body, { altKey: true, code: "KeyN" }),
			);
			expect(location.hash).toBe("#conversations/c3");
			await act(async () =>
				fireEvent.keyDown(document.body, { altKey: true, code: "KeyN" }),
			);
			expect(location.hash).toBe("#conversations/c2");
		});

		it("shows each key while ⌥⌘ is held, and opens a row with ⌥⌘ and its digit", async () => {
			const view = await sidebar(
				newestFirst([
					conversation({ id: "c1", title: "First" }),
					conversation({ id: "c2", title: "Second" }),
				]),
				[details({ task: "beta", status: "escalated" })],
			);
			const nav = view.getByRole("navigation", { name: "conversations" });
			const keys = () =>
				[...nav.querySelectorAll("kbd")].map((each) => each.textContent);
			expect(keys()).toEqual([]);

			await act(async () =>
				fireEvent.keyDown(window, { key: "Alt", altKey: true, metaKey: true }),
			);
			expect(keys()).toEqual(["N", "0", "1", "2"]);
			await act(async () =>
				fireEvent.keyDown(document.body, {
					code: "Digit1",
					altKey: true,
					metaKey: true,
				}),
			);
			expect(location.hash).toBe("#conversations/c2");
			await act(async () =>
				fireEvent.keyDown(document.body, {
					code: "Digit2",
					altKey: true,
					ctrlKey: true,
				}),
			);
			expect(location.hash).toBe("#conversations/task/beta");

			await act(async () =>
				fireEvent.keyUp(window, { key: "Alt", metaKey: true }),
			);
			expect(keys()).toEqual([]);
		});

		it("opens Todos with ⌥⌘T and Conversations with ⌥⌘C, showing each key on its tab while ⌥⌘ is held", async () => {
			const view = await sidebar(
				newestFirst([conversation({ id: "c1", title: "First" })]),
			);
			const tab = (name: RegExp) => view.getByRole("tab", { name });
			const key = (name: RegExp) =>
				tab(name).querySelector("kbd")?.textContent ?? null;
			expect(key(/Todos/)).toBeNull();

			await act(async () =>
				fireEvent.keyDown(window, { key: "Alt", altKey: true, metaKey: true }),
			);
			expect(key(/Todos/)).toBe("T");
			expect(key(/Conversations/)).toBe("C");
			expect(key(/Tasks/)).toBeNull();

			await act(async () =>
				fireEvent.keyDown(document.body, {
					code: "KeyT",
					altKey: true,
					metaKey: true,
				}),
			);
			expect(tab(/Todos/).getAttribute("aria-selected")).toBe("true");
			await act(async () =>
				fireEvent.keyDown(document.body, {
					code: "KeyC",
					altKey: true,
					ctrlKey: true,
				}),
			);
			expect(tab(/Conversations/).getAttribute("aria-selected")).toBe("true");

			await act(async () =>
				fireEvent.keyUp(window, { key: "Alt", metaKey: true }),
			);
			expect(key(/Todos/)).toBeNull();
		});

		it("starts a new conversation with ⌥⌘N, with the agent and model the last one started with", async () => {
			const view = await sidebar(
				newestFirst([
					conversation({
						id: "c1",
						agent: "codex",
						title: "Latest",
						settings: [
							{
								id: "model",
								name: "Model",
								type: "select",
								category: "model",
								current: "small",
								options: [
									{ value: "big", name: "Big", description: null },
									{ value: "small", name: "Small", description: null },
								],
							},
						],
					}),
					conversation({ id: "c2", title: "Earlier", status: "running", ask }),
				]),
			);

			await act(async () =>
				fireEvent.keyDown(document.body, {
					altKey: true,
					metaKey: true,
					code: "KeyN",
				}),
			);
			expect(location.hash).toBe("#conversations/new");
			expect(
				within(
					view.getByText("Start a conversation with")
						.parentElement as HTMLElement,
				).getByLabelText("Codex"),
			).toBeTruthy();
			expect(
				view.getByRole("combobox", { name: "model" }).textContent,
			).toContain("Small");
		});

		it("shows ⌥⌘N in the New menu beside the agent it starts", async () => {
			const view = await sidebar(
				newestFirst([
					conversation({ id: "c1", agent: "codex", title: "Latest" }),
					conversation({ id: "c2", title: "Earlier" }),
				]),
			);

			await act(async () =>
				fireEvent.click(view.getByRole("button", { name: "New" })),
			);
			const item = (name: string) =>
				waitFor(() => view.getByRole("menuitem", { name: new RegExp(name) }));
			expect((await item("Codex")).textContent).toContain("⌥⌘N");
			expect((await item("Claude")).textContent).not.toContain("⌥⌘N");
		});
	});
});
