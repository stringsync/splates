import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";
import type { Limit, Setting } from "../conversations";
import {
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	live,
	menuItem,
	message,
	newWith,
	pick,
	pressArchive,
	project,
	resize,
	Testing,
	textIn,
	todo,
	tool,
	typeIn,
	waitFor,
	within,
} from "./testing";

describe("App's conversations", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});
	it("shows no Conversations when the server has none", async () => {
		const view = await testing.open();

		expect(view.queryByRole("tab", { name: /Conversations/ })).toBeNull();
	});

	it("lists conversations newest first, each by name with its task on hover, and archived ones apart", async () => {
		const view = await testing.openConversations(
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

	it("drops an archived conversation once the server deletes it", async () => {
		const view = await testing.openConversations(
			[
				conversation({ id: "live", title: "Live" }),
				conversation({ id: "a1", title: "Put away", archived: true }),
				conversation({ id: "a2", title: "Older", archived: true }),
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

		await testing.remove("a2");

		expect(within(archived).getAllByRole("listitem")).toHaveLength(1);
		expect(archived.textContent).toContain("Put away");
		expect(archived.textContent).not.toContain("Older");
	});

	it("nests a part's conversations under the task it was handed out from", async () => {
		const view = await testing.openConversations(
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

	it("keeps a part's conversation under its caller's once both merged", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					task: null,
					lastTask: "alpha",
					lastBase: "main",
					createdAt: "2026-10-11T10:01:00.000Z",
				}),
				conversation({
					id: "c2",
					agent: "codex",
					task: null,
					lastTask: "alpha-api",
					lastBase: "task/alpha",
					createdAt: "2026-10-11T10:03:00.000Z",
				}),
			],
			null,
			{ tasks: [] },
		);

		expect(
			within(view.getByRole("list", { name: "parts of alpha" }))
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual(["alpha-api"]);
	});

	it("stands in for a missing name, muted, with what the person first said, else Not started", async () => {
		const view = await testing.openConversations(
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
		const view = await testing.openConversations([
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
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Claude Look around" })),
		);
		expect(view.queryByRole("button", { name: /of context used/ })).toBeNull();
	});

	it("takes up a task no conversation runs in, or an open todo, from a main-tree conversation's branch", async () => {
		const view = await testing.openConversations(
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
		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{
				method: "POST",
				body: {
					text: "[ARBOR TASK beta]",
				},
			},
			{ method: "POST", body: { text: "[ARBOR TODO #12]" } },
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

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Claude Look around" })),
		);
		const main = view.getByRole("navigation", { name: "actions" });
		expect(
			within(main)
				.getAllByRole("button")
				.map((button) => button.textContent),
		).toEqual(["Terminal⌃`", "Archive⌥⌘⌫"]);
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
				name: /Terminal|Archive|Systems|Background/,
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

	it("lists the systems its task touches as chips in a card under the actions, each opening to its globs", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", task: "alpha", title: "Fix login" })],
			"c1",
			{
				tasks: [
					details({
						task: "alpha",
						systems: [
							{
								name: "auth",
								globs: ["src/auth/**"],
								ignore: ["src/auth/**/*.test.ts"],
							},
							{ name: "sessions", globs: ["src/sessions/**"] },
						],
					}),
				],
			},
		);

		const card = view.getByRole("region", { name: "systems" });
		expect(
			within(card)
				.getAllByRole("button")
				.map((chip) => chip.textContent),
		).toEqual(["auth", "sessions"]);
		expect(view.queryByRole("list", { name: "auth globs" })).toBeNull();
		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: "auth" })),
		);
		expect(
			view
				.getByRole("list", { name: "auth globs" })
				.querySelectorAll("li")
				.values()
				.map((item) => item.textContent)
				.toArray(),
		).toEqual(["src/auth/**", "!src/auth/**/*.test.ts"]);
	});

	it("shows no systems card for a task that touches none", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", task: "alpha", title: "Fix login" }),
		]);

		expect(view.queryByRole("region", { name: "systems" })).toBeNull();
	});

	it("lists the commands it left in the background in a menu from the actions card, each saying how it stands", async () => {
		const view = await testing.openConversations([
			conversation({
				id: "c1",
				title: "Serve it",
				background: [
					{
						id: "b1",
						name: "Start the dev server",
						command: "bun dev",
						state: "running",
						output: "/tmp/b1.output",
					},
					{
						id: "b2",
						name: "Run the tests",
						command: null,
						state: "failed",
						output: null,
					},
				],
			}),
		]);

		const row = within(
			view.getByRole("navigation", { name: "actions" }),
		).getByRole("button", { name: "Background commands" });
		expect(row.textContent).toBe("Background1 running");
		await act(async () => fireEvent.click(row));
		const menu = await waitFor(() => view.getByRole("menu"));
		expect(
			within(menu)
				.getAllByRole("menuitem")
				.map((item) => [item.title, item.textContent]),
		).toEqual([
			["bun dev", "Start the dev serverRunning"],
			["Run the tests", "Run the testsFailed"],
		]);

		await testing.say(conversation({ id: "c1", title: "Serve it" }));
		expect(
			view.queryByRole("button", { name: "Background commands" }),
		).toBeNull();
	});

	it("opens a command's output beside the page, from the card's menu or the narrow one, with a Stop while it runs", async () => {
		testing.outputs = { b1: "listening on 3000" };
		const running = {
			id: "b1",
			name: "Start the dev server",
			command: "bun dev",
			state: "running" as const,
			output: "/tmp/b1.output",
		};
		const view = await testing.openConversations([
			conversation({ id: "c1", title: "Serve it", background: [running] }),
		]);

		await act(async () =>
			fireEvent.click(
				within(view.getByRole("navigation", { name: "actions" })).getByRole(
					"button",
					{ name: "Background commands" },
				),
			),
		);
		await act(async () =>
			fireEvent.click(
				within(await waitFor(() => view.getByRole("menu"))).getByRole(
					"menuitem",
					{ name: /Start the dev server/ },
				),
			),
		);
		const pane = view.getByRole("complementary", {
			name: "background command",
		});
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

		await act(async () =>
			fireEvent.click(
				// The narrow one, in the thread's header ahead of the card.
				view.getAllByRole("button", {
					name: "Background commands",
				})[0] as HTMLElement,
			),
		);
		const menu = await waitFor(() => view.getByRole("menu"));
		await act(async () =>
			fireEvent.click(
				within(menu).getByRole("menuitem", { name: /Start the dev server/ }),
			),
		);
		expect(
			view.getByRole("complementary", { name: "background command" }),
		).toBeTruthy();
	});

	it("archives a stopped conversation from the list, with the agent's mark in place of its name", async () => {
		const view = await testing.openConversations(
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

		expect(testing.posted("/api/conversations/c1/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
	});

	it("asks before archiving a conversation whose agent is still running", async () => {
		const view = await testing.openConversations(
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
		expect(testing.posted("/api/conversations/c1/archived")).toEqual([]);

		await archive();
		await act(async () =>
			fireEvent.click(
				within(view.getByRole("dialog", { name: "Archive alpha?" })).getByRole(
					"button",
					{ name: "Archive" },
				),
			),
		);
		expect(testing.posted("/api/conversations/c1/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
	});

	it("archives the open conversation on ⌥⌘⌫, going on to the next agent waiting on you", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", title: "Done", status: "stopped" }),
			conversation({ id: "c2", title: "Broke", status: "failed" }),
		]);
		expect(location.hash).toBe("#conversations/c1");

		// Backspace alone, or ⌥⌫ that deletes a word, archives nothing.
		await act(async () =>
			fireEvent.keyDown(document.body, { code: "Backspace", altKey: true }),
		);
		expect(testing.posted("/api/conversations/c1/archived")).toEqual([]);
		await pressArchive();

		expect(testing.posted("/api/conversations/c1/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
		await waitFor(() => expect(location.hash).toBe("#conversations/c2"));
		expect(view.getByRole("heading", { name: "Broke" })).toBeTruthy();
	});

	it("goes on to the next agent waiting on you from the actions' Archive, and from the open row's in the list", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", title: "Done", status: "stopped" }),
			conversation({ id: "c2", title: "Broke", status: "failed" }),
			conversation({ id: "c3", title: "Asks", status: "failed" }),
		]);
		expect(location.hash).toBe("#conversations/c1");

		await act(async () =>
			fireEvent.click(
				within(view.getByRole("navigation", { name: "actions" })).getByRole(
					"button",
					{ name: /^Archive/ },
				),
			),
		);
		await waitFor(() => expect(location.hash).toBe("#conversations/c2"));

		await act(async () =>
			fireEvent.click(
				within(
					view.getByRole("navigation", { name: "conversations" }),
				).getByRole("button", { name: "Archive Broke" }),
			),
		);
		expect(testing.posted("/api/conversations/c2/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
		await waitFor(() => expect(location.hash).toBe("#conversations/c3"));
	});

	it("stays on the open conversation when the list archives another", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", title: "Done", status: "stopped" }),
			conversation({ id: "c2", title: "Broke", status: "failed" }),
		]);
		expect(location.hash).toBe("#conversations/c1");

		await act(async () =>
			fireEvent.click(
				within(
					view.getByRole("navigation", { name: "conversations" }),
				).getByRole("button", { name: "Archive Broke" }),
			),
		);

		expect(testing.posted("/api/conversations/c2/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
		expect(location.hash).toBe("#conversations/c1");
	});

	it("archives the open conversation on ⌥⌘⌫ to a new one with none waiting, asking first while its agent runs", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", title: "Fix login", status: "running" }),
		]);

		await pressArchive();
		const dialog = view.getByRole("dialog", { name: "Archive Fix login?" });
		expect(testing.posted("/api/conversations/c1/archived")).toEqual([]);
		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: "Archive" })),
		);

		expect(testing.posted("/api/conversations/c1/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
		await waitFor(() => expect(location.hash).toBe("#conversations/new"));
	});

	it("archives on ⌥⌘⌫ to a new conversation past merged and unread ones, which only ⌥⌘M opens", async () => {
		await testing.openConversations([
			conversation({ id: "c1", title: "Done", status: "stopped" }),
			conversation({
				id: "c2",
				title: "Merged",
				status: "stopped",
				messages: [
					message("agent", "## ✅ Merged header onto main\n\nIt wraps."),
				],
			}),
			conversation({
				id: "c3",
				title: "Unread",
				status: "stopped",
				unread: true,
			}),
		]);
		expect(location.hash).toBe("#conversations/c1");

		await pressArchive();
		await waitFor(() => expect(location.hash).toBe("#conversations/new"));
	});

	it("leaves an archived conversation archived on ⌥⌘⌫", async () => {
		await testing.openConversations([], null);
		await testing.say(conversation({ status: "stopped", archived: true }));
		await act(async () => {
			location.hash = "#conversations/c1";
			window.dispatchEvent(new HashChangeEvent("hashchange"));
		});

		await pressArchive();

		expect(testing.posted("/api/conversations/c1/archived")).toEqual([]);
		expect(location.hash).toBe("#conversations/c1");
	});

	it("says atop an archived conversation, and in its composer, that sending unarchives it", async () => {
		const view = await testing.openConversations([], null);
		await testing.say(conversation({ status: "stopped", archived: true }));
		await act(async () => {
			location.hash = "#conversations/c1";
			window.dispatchEvent(new HashChangeEvent("hashchange"));
		});

		const box = await view.findByRole("textbox", { name: "Message input" });
		expect(box.getAttribute("aria-placeholder")).toBe(
			"Send a message to unarchive and continue",
		);
		expect(
			view.getByText("This conversation is archived.").closest("[role=status]"),
		).not.toBeNull();
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

	it("restarts from a done checkpoint, saying so until arbor dev is back", async () => {
		testing.projects = [
			project("webappwiz", [live("c1", "One", "done")], true),
		];
		const view = await testing.openConversations(
			[conversation({ id: "c1", status: "stopped", checkpoint: "done" })],
			null,
		);
		await act(async () =>
			fireEvent.click(await menuItem(view, "Checkpoint done")),
		);
		const done = await waitFor(() =>
			view.getByRole("dialog", { name: "Checkpoint" }),
		);

		await act(async () =>
			fireEvent.click(within(done).getByRole("button", { name: "Restart" })),
		);

		expect(testing.posted("/api/checkpoint/restart")).toEqual([
			{ method: "POST", body: {} },
		]);
		const restarting = await waitFor(() =>
			view.getByRole("dialog", { name: "Restart" }),
		);
		expect(
			within(restarting).queryByRole("button", { name: "Resume" }),
		).toBeNull();
		// Closing it leaves the restart to go on, rather than forgetting it.
		await act(async () =>
			fireEvent.click(
				within(restarting)
					.getAllByRole("button", { name: "Close" })
					.at(-1) as Element,
			),
		);
		expect(
			testing.posted("/api/conversations/checkpoint?project=webappwiz"),
		).toEqual([]);
		await menuItem(view, "Restarting arbor dev");
	});

	it("says arbor dev is restarting once a checkpoint asked to restart is done, then offers to resume its agents", async () => {
		testing.projects = [
			project("webappwiz", [live("c1", "One", "asked")], true),
		];
		testing.restarting = { resume: false };
		const view = await testing.openConversations(
			[conversation({ id: "c1", status: "running" })],
			null,
		);
		await menuItem(view, "Checkpoint under way");

		testing.projects = [
			project("webappwiz", [live("c1", "One", "done")], true),
		];
		await testing.say(
			conversation({ id: "c1", status: "stopped", checkpoint: "done" }),
		);
		await act(async () =>
			fireEvent.click(await menuItem(view, "Restarting arbor dev")),
		);
		const restarting = await waitFor(() =>
			view.getByRole("dialog", { name: "Restart" }),
		);
		expect(restarting.textContent).toContain(
			"arbor dev is restarting, then you pick what comes next.",
		);
		for (const name of ["Restart", "Resume"]) {
			expect(within(restarting).queryByRole("button", { name })).toBeNull();
		}

		// Back, as another run, its agents waiting to be resumed.
		await act(async () => testing.talkStream?.onerror?.());
		testing.restarting = null;
		testing.restarted = "waiting";
		testing.run = "run-2";
		await act(async () => testing.talkStream?.onopen?.());
		await testing.say(
			conversation({ id: "c1", status: "stopped", checkpoint: "done" }),
		);

		// Restart shows a while longer, then says it is back.
		const restarted = view.getByRole("dialog", { name: "Restart" });
		await waitFor(() =>
			expect(restarted.textContent).toContain(
				"Now on arbor 0.0.1. 1 agent checkpointed and waiting to resume.",
			),
		);
		for (const name of ["Restart", "Retry missed"]) {
			expect(within(restarted).queryByRole("button", { name })).toBeNull();
		}
		await act(async () =>
			fireEvent.click(
				within(restarted).getByRole("button", { name: "Resume" }),
			),
		);
		expect(testing.posted("/api/checkpoint/resume")).toEqual([
			{ method: "POST", body: {} },
		]);

		// Each one resumed says so, still as after the restart.
		testing.restarted = null;
		testing.projects = [project("webappwiz", [live("c1", "One")], true)];
		await testing.say(conversation({ id: "c1", status: "running" }));
		const resumed = await waitFor(() =>
			view.getByRole("dialog", { name: "Resume" }),
		);
		await waitFor(() =>
			expect(resumed.textContent).toContain(
				"Now on arbor 0.0.1. 1 agent resumed.",
			),
		);
		expect(within(resumed).getByRole("img", { name: "Resumed" })).toBeTruthy();
		expect(
			within(resumed).getByRole("button", { name: "Reload page" }),
		).toBeTruthy();
	});

	it("restarts and resumes, showing each agent carry on, though the page never saw the last answer", async () => {
		testing.projects = [
			project("webappwiz", [live("c1", "One", "asked")], true),
		];
		testing.restarting = { resume: true };
		const view = await testing.openConversations(
			[conversation({ id: "c1", status: "running" })],
			null,
		);
		await act(async () =>
			fireEvent.click(await menuItem(view, "Checkpoint under way")),
		);
		const going = await waitFor(() =>
			view.getByRole("dialog", { name: "Checkpoint" }),
		);
		expect(going.textContent).toContain(
			"Each agent is bringing its ARBOR.md up to date, then arbor dev restarts and each resumes.",
		);

		testing.goAway();

		const restarting = await waitFor(
			() => view.getByRole("dialog", { name: "Restart" }),
			{ timeout: 3000 },
		);
		expect(restarting.textContent).toContain(
			"arbor dev is restarting, then each agent resumes.",
		);
		expect(
			within(restarting).queryByRole("img", { name: "Checkpointing" }),
		).toBeNull();
		testing.restarting = null;
		testing.restarted = "resuming";
		testing.run = "run-2";
		testing.projects = [
			project("webappwiz", [live("c1", "One", "done")], true),
		];
		testing.comeBack();
		const restarted = await waitFor(
			() => view.getByRole("dialog", { name: "Resume" }),
			{ timeout: 3000 },
		);
		expect(restarted.textContent).toContain(
			"Now on arbor 0.0.1. 0 of 1 agent resumed so far.",
		);
		expect(
			within(restarted).getByRole("img", { name: "Resuming" }),
		).toBeTruthy();

		testing.restarted = null;
		testing.projects = [project("webappwiz", [live("c1", "One")], true)];
		await testing.say(conversation({ id: "c1", status: "running" }));
		await waitFor(
			() =>
				expect(restarted.textContent).toContain(
					"Now on arbor 0.0.1. 1 agent resumed.",
				),
			{ timeout: 3000 },
		);
		expect(view.getByRole("dialog", { name: "Resume" })).toBe(restarted);
		expect(
			within(restarted).getByRole("img", { name: "Resumed" }),
		).toBeTruthy();
	});

	it("shows Restart for a while, though arbor dev came back before the page saw it go", async () => {
		testing.projects = [
			project("webappwiz", [live("c1", "One", "asked")], true),
		];
		testing.restarting = { resume: true };
		const view = await testing.openConversations(
			[conversation({ id: "c1", status: "running" })],
			null,
		);
		await act(async () =>
			fireEvent.click(await menuItem(view, "Checkpoint under way")),
		);
		await waitFor(() => view.getByRole("dialog", { name: "Checkpoint" }));

		// Back as another run between two asks, its agents already resuming.
		testing.restarting = null;
		testing.restarted = "resuming";
		testing.run = "run-2";
		testing.projects = [
			project("webappwiz", [live("c1", "One", "done")], true),
		];
		const restarting = await waitFor(() =>
			view.getByRole("dialog", { name: "Restart" }),
		);
		expect(restarting.textContent).toContain(
			"arbor dev is restarting, then each agent resumes.",
		);
		await waitFor(() => view.getByRole("dialog", { name: "Resume" }));
	});

	it("renames a conversation from its menu", async () => {
		const view = await testing.openConversations(
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

		expect(testing.posted("/api/conversations/c1/name")).toEqual([
			{ method: "PUT", body: { name: "Login redirect" } },
		]);
	});

	it("marks a conversation read once opened, and one not open unread from its menu", async () => {
		const view = await testing.openConversations(
			[
				conversation({ id: "c1", title: "Fix login", unread: true }),
				conversation({ id: "c2", title: "Fix footer" }),
			],
			"c1",
		);

		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/unread")).toEqual([
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

		expect(testing.posted("/api/conversations/c2/unread")).toEqual([
			{ method: "PUT", body: { unread: true } },
		]);
	});

	it("renames on a double click, in the list and on the open conversation's title", async () => {
		const view = await testing.openConversations([
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

		expect(testing.posted("/api/conversations/c1/name")).toEqual([
			{ method: "PUT", body: { name: "Login redirect" } },
		]);
	});

	it("on a phone, shows the list or one conversation, with a way back", async () => {
		resize(390, 844);
		try {
			const view = await testing.openConversations(
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
		const view = await testing.openConversations(
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
		).toEqual(["alpha", "Carried onmain", "Look into itmain", "beta"]);
		expect(within(recent).queryByRole("status")).toBeNull();
		await act(async () =>
			fireEvent.click(within(recent).getByRole("button", { name: /alpha/ })),
		);
		expect(location.hash).toBe("#conversations/c1");
	});

	it("starts a conversation from the home composer, in the main tree with the agent picked from New and its settings, and says the message", async () => {
		const view = await testing.openConversations(
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
		await typeIn(box, "fix the login");
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		expect(testing.posted("/api/conversations")).toEqual([
			{
				method: "POST",
				body: { agent: "codex", task: null, settings: { model: "small" } },
			},
		]);
		await waitFor(() =>
			expect(testing.posted("/api/conversations/c9/prompt")).toEqual([
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
		const view = await testing.openConversations([], null, {}, [
			{ id: "claude", name: "Claude", settings: [], limits: [] },
			{ id: "codex", name: "Codex", settings: [model], limits: [] },
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
		await typeIn(box, "fix the login");
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		// As shown, though never touched.
		expect(testing.posted("/api/conversations")).toEqual([
			{
				method: "POST",
				body: { agent: "codex", task: null, settings: { model: "big" } },
			},
		]);
	});

	it("shows how much of the plan is used and when each window resets, the newest said, yellow from 80% and red from 90%, for each agent that says", async () => {
		const hours = (count: number) =>
			new Date(Date.now() + count * 3_600_000).toISOString();
		const limit = (window: string, used: number, at: string): Limit => ({
			window,
			used,
			resets: hours(window === "five_hour" ? 2 : 50),
			at,
		});
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					usage: {
						context: null,
						input: 0,
						cached: 0,
						output: 0,
						cost: null,
						limits: [limit("five_hour", 0.95, "2026-10-11T11:00:00.000Z")],
					},
				}),
			],
			null,
			{},
			[
				{
					id: "claude",
					name: "Claude",
					settings: [],
					limits: [
						limit("five_hour", 0.5, "2026-10-11T10:00:00.000Z"),
						limit("seven_day", 0.82, "2026-10-11T10:00:00.000Z"),
						limit(
							"seven_day_overage_included",
							0.1,
							"2026-10-11T10:00:00.000Z",
						),
					],
				},
				{
					id: "codex",
					name: "Codex",
					settings: [],
					limits: [limit("43200_minutes", 0.07, "2026-10-11T10:00:00.000Z")],
				},
				{ id: "gemini", name: "Gemini", settings: [], limits: [] },
			],
		);

		const limits = view.getByRole("region", { name: "plan limits" });
		const row = (name: string) => within(limits).getByLabelText(name);
		expect(row("5-hour").textContent).toEndWith(", in 2h 0m");
		expect(within(row("5-hour")).getByText("95%").className).toContain(
			"text-destructive",
		);
		expect(row("Weekly").textContent).toEndWith(", in 2d 2h");
		expect(within(row("Weekly")).getByText("82%").className).toContain(
			"text-warning",
		);
		// Extra usage, which claude.ai's usage settings leave out, is left out.
		expect(
			within(limits).queryByLabelText("seven_day_overage_included"),
		).toBeNull();

		// Codex's windows go by their length, Claude's not among them.
		await newWith(view, "Codex");
		const codex = view.getByRole("region", { name: "plan limits" });
		expect(within(codex).getByLabelText("30-day").textContent).toContain("7%");
		expect(within(codex).queryByLabelText("5-hour")).toBeNull();

		await newWith(view, "Gemini");
		expect(view.queryByRole("region", { name: "plan limits" })).toBeNull();
	});

	it("offers the tree's files for an @ in the composer, over the composer, each its name before its folder, and writes the one picked", async () => {
		testing.tree = ["README.md", "src/", "src/components/", "src/index.ts"];
		const view = await testing.openConversations([]);
		const box = view.getByRole("textbox", {
			name: "Message input",
		});

		await typeIn(box, "see @comp");
		const list = await waitFor(() => view.getByRole("listbox"));
		// The name first, so a long path loses its folder rather than its name.
		expect(
			within(list)
				.getAllByRole("option")
				.map((option) =>
					[...option.querySelectorAll("span")].map((span) => span.textContent),
				),
		).toEqual([["components/", "src/"]]);
		// Out of the flow, held to a box of the composer's own, so it floats
		// over the thread rather than pushing the composer down or anchoring
		// to the thread's scroller, off the top of the page.
		expect(list.classList.contains("absolute")).toBe(true);
		expect(list.parentElement?.classList.contains("relative")).toBe(true);
		expect(list.parentElement?.contains(box)).toBe(true);

		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		expect(textIn(box)).toBe("see @src/components/ ");
		expect(testing.posted("/api/conversations")).toEqual([]);
	});

	it("shows no list over the composer for an @ no file matches, as right after a file's chip, and sends on Enter", async () => {
		testing.tree = ["README.md", "src/", "src/index.ts"];
		const view = await testing.openConversations([], null);
		testing.reply = conversation({ id: "c9", status: "starting" });
		const box = view.getByRole("textbox", {
			name: "Message input",
		});

		await typeIn(box, "see @src/index.ts");

		expect(view.queryByLabelText("mentions")).toBeNull();
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
		await waitFor(() =>
			expect(testing.posted("/api/conversations")).toHaveLength(1),
		);
	});

	it("shows the first message in the new conversation's thread and row while its agent starts, then as the server has it", async () => {
		const view = await testing.openConversations([], null);
		testing.reply = conversation({ id: "c9", status: "starting" });
		const box = view.getByRole("textbox", { name: "Message input" });
		await typeIn(box, "fix the login");

		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		const thread = await waitFor(() =>
			view.getByRole("region", { name: "fix the login" }),
		);
		// Its title, and the message.
		expect(within(thread).getAllByText("fix the login")).toHaveLength(2);
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
			expect(
				within(thread).getByRole("button", { name: "Stop generating" }),
			).toBeTruthy(),
		);
		expect(within(thread).getAllByText("fix the login")).toHaveLength(2);
	});

	it("shows the images sent with the first message in the new conversation's thread while its agent starts, then as the server keeps them", async () => {
		const view = await testing.openConversations([], null);
		testing.reply = conversation({ id: "c9", status: "starting" });
		const box = view.getByRole("textbox", { name: "Message input" });
		const shot = new File(["png bytes"], "shot.png", { type: "image/png" });
		await act(async () =>
			fireEvent.paste(box, { clipboardData: { files: [shot] } }),
		);

		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		const thread = await waitFor(() =>
			view.getByRole("region", { name: "[Image 1]" }),
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
		const view = await testing.openConversations([
			conversation({ title: "Login", status: "stopped", messages: said }),
		]);
		const thread = view.getByRole("region", { name: "Login" });
		const box = view.getByRole("textbox", { name: "Message input" });
		await typeIn(box, "and the logout");

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
			expect(
				within(thread).getByRole("button", { name: "Stop generating" }),
			).toBeTruthy(),
		);
		expect(within(thread).getAllByText("and the logout")).toHaveLength(1);
	});

	it("shows each message to a stopped conversation at once while its agent resumes, those after the first as queued until the server has them", async () => {
		const said = [message("user", "fix the login"), message("agent", "Done.")];
		const view = await testing.openConversations([
			conversation({ title: "Login", status: "stopped", messages: said }),
		]);
		const thread = view.getByRole("region", { name: "Login" });
		const box = view.getByRole("textbox", { name: "Message input" });

		for (const text of ["and the logout", "and the signup"]) {
			await typeIn(box, text);
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

	it("marks a message the agent took into its running turn as steered", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Login",
				status: "running",
				messages: [
					message("user", "fix the login"),
					message("agent", "On it."),
					{ ...message("user", "and the logout"), steered: true },
				],
			}),
		]);
		const thread = view.getByRole("region", { name: "Login" });

		const marks = await within(thread).findAllByText(
			"Steered into the running turn",
		);
		expect(marks).toHaveLength(1);
		expect(marks[0]?.closest('[data-role="user"]')?.textContent).toContain(
			"and the logout",
		);
	});

	it("shows each system, file and directory a message names as a chip, the agent's too", async () => {
		testing.systems = [
			{ name: "playback", aliases: ["player"], globs: ["src/audio/**"] },
		];
		testing.tree = ["src/", "src/index.ts"];
		const view = await testing.openConversations([
			conversation({
				title: "Login",
				messages: [
					message("user", "fix #player in @src/index.ts, not @src/gone.ts"),
					message("agent", "The stutter is in #playback, under @src/."),
				],
			}),
		]);
		const thread = view.getByRole("region", { name: "Login" });

		const file = await waitFor(() =>
			within(thread).getByTitle("/repo/src/index.ts"),
		);
		expect(file.textContent).toBe("index.ts");
		expect(file.getAttribute("href")).toBe("zed://file/repo/src/index.ts");
		const [system, replied] = within(thread).getAllByRole("button", {
			name: "playback",
		});
		expect(replied).toBeTruthy();
		await act(async () => fireEvent.click(system as HTMLElement));
		expect(
			(await view.findByRole("list", { name: "playback globs" })).textContent,
		).toBe("src/audio/**");
		expect(within(thread).getByText(/not @src\/gone\.ts/)).toBeTruthy();
		const folder = within(thread).getByTitle("/repo/src/");
		expect(folder.textContent).toBe("src/");
	});

	it("takes a message to a stopped conversation back out of its thread when the server refuses it", async () => {
		const view = await testing.openConversations([
			conversation({ title: "Login", status: "stopped" }),
		]);
		const thread = view.getByRole("region", { name: "Login" });
		const box = view.getByRole("textbox", {
			name: "Message input",
		});
		testing.refuseWrites = { reason: "usage", message: "cannot resume" };
		await typeIn(box, "and the logout");

		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		await waitFor(() => expect(textIn(box)).toBe("and the logout"));
		expect(thread.querySelectorAll('[data-role="user"]')).toHaveLength(0);
		// Said above the composer it was sent from, not in a toast.
		expect(within(thread).getByRole("alert").textContent).toBe(
			"Not sent: cannot resume",
		);
	});

	it("opens the new conversation screen with the agent picked from the sidebar's menu", async () => {
		const view = await testing.openConversations([
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
		const view = await testing.openConversations(
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
		const view = await testing.openConversations([
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
	});

	it("shows the work row the agent's work will fill, saying only Working, while it has yet to do anything", async () => {
		const view = await testing.openConversations([
			conversation({ title: "Read the note" }),
		]);

		await testing.say(
			conversation({
				title: "Read the note",
				status: "running",
				messages: [message("user", "what does it say?")],
			}),
		);

		const thread = view.getByRole("region", { name: "Read the note" });
		await waitFor(() =>
			expect(thread.querySelector('[data-slot="work"]')?.textContent).toBe(
				"Working",
			),
		);
		expect(
			thread.querySelector('[data-slot="aui_assistant-message-indicator"]'),
		).toBeNull();
	});

	it("says Working under a reply while its text streams", async () => {
		const view = await testing.openConversations([
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
		const view = await testing.openConversations([
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
		const view = await testing.openConversations([
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
		const view = await testing.openConversations([
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
		const view = await testing.openConversations([conversation()]);
		const box = view.getByRole("textbox", {
			name: "Message input",
		});

		await typeIn(box, "hello");
		await act(async () =>
			fireEvent.keyDown(box, { key: "Enter", shiftKey: true }),
		);
		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([]);
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{ method: "POST", body: { text: "hello" } },
		]);

		await testing.say(conversation({ status: "running" }));
		await act(async () => fireEvent.keyDown(box, { key: "Escape" }));
		expect(
			testing.posted("/api/conversations/c1/cancel").map((post) => post.method),
		).toEqual(["POST"]);
	});

	it("ends a turn the person stopped with a line that says so", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Stopped",
				messages: [
					message("user", "go"),
					{
						...message("agent", "Starting on it."),
						stopped: "2026-10-12T10:00:00.000Z",
					},
					message("user", "again"),
					message("agent", "Done."),
				],
			}),
		]);
		const thread = view.getByRole("region", { name: "Stopped" });

		await waitFor(() =>
			expect(thread.querySelectorAll('[data-slot="stopped"]')).toHaveLength(1),
		);
		expect(thread.querySelector('[data-slot="stopped"]')?.textContent).toBe(
			"Stopped by you",
		);
	});

	it("shows the person's message as markdown, each line break as typed", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Reply",
				messages: [
					message(
						"user",
						"> **How should it land?**\n\nAs one commit:\n\n- squash\n- `merge`\n\nfirst line\nsecond line",
					),
				],
			}),
		]);
		const thread = view.getByRole("region", { name: "Reply" });
		const box = await waitFor(() => {
			const found = thread.querySelector(".aui-user-message-content");
			expect(found?.querySelector("blockquote strong")?.textContent).toBe(
				"How should it land?",
			);
			return found as HTMLElement;
		});
		expect(
			[...box.querySelectorAll("li")].map((item) => item.textContent),
		).toEqual(["squash", "merge"]);
		expect(box.querySelector("li code")?.textContent).toBe("merge");
		const last = [...box.querySelectorAll("p")].at(-1);
		expect(last?.querySelector("br")).not.toBeNull();
		expect(last?.textContent?.split(/\s+/)).toEqual([
			"first",
			"line",
			"second",
			"line",
		]);
	});

	it("sends an image pasted into the composer, and shows the images the person sent on their message", async () => {
		const view = await testing.openConversations([
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
		await typeIn(box, "and this");
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "and this", file: [shot] } },
			]),
		);
	});

	it("attaches any file with ⌥⌘;, plays a recording the person sent, and links any other file", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Look",
				messages: [
					{
						...message("user", "these"),
						parts: [
							{
								type: "file",
								name: "ab12.mp4",
								title: "bug.mp4",
								mimeType: "video/mp4",
							},
							{
								type: "file",
								name: "cd34.pdf",
								title: "spec.pdf",
								mimeType: "application/pdf",
							},
							{ type: "text", text: "these" },
						],
					},
				],
			}),
		]);
		const thread = view.getByRole("region", { name: "Look" });
		await act(async () =>
			fireEvent.click(
				await waitFor(() =>
					within(thread).getByRole("button", { name: "Preview bug.mp4" }),
				),
			),
		);
		const lightbox = await waitFor(() =>
			view.getByRole("dialog", { name: "bug.mp4" }),
		);
		expect(lightbox.querySelector("video")).not.toBeNull();
		await act(async () =>
			fireEvent.click(within(lightbox).getByRole("button", { name: "close" })),
		);
		expect(
			within(thread)
				.getByRole("link", { name: "spec.pdf" })
				.getAttribute("href"),
		).toContain("/api/conversations/c1/attachments/cd34.pdf");

		const picked: HTMLInputElement[] = [];
		const click = spyOn(HTMLInputElement.prototype, "click").mockImplementation(
			function (this: HTMLInputElement) {
				picked.push(this);
			},
		);
		await act(async () =>
			fireEvent.keyDown(document.body, {
				key: "…",
				code: "Semicolon",
				altKey: true,
				metaKey: true,
			}),
		);
		click.mockRestore();
		const input = picked[0];
		expect(input?.type).toBe("file");
		expect(input?.accept).toBe("");
		const clip = new File(["mp4 bytes"], "clip.mp4", { type: "video/mp4" });
		await act(async () => {
			Object.defineProperty(input, "files", { value: [clip] });
			input?.dispatchEvent(new Event("change"));
		});
		const box = view.getByRole("textbox", { name: "Message input" });
		await waitFor(() =>
			expect(
				view.getByRole("button", { name: "Preview clip.mp4" }),
			).toBeTruthy(),
		);
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "[File 1]", file: [clip] } },
			]),
		);
	});

	it("names each file attached, under its tile and in a chip at the caret, images apart from other files, renumbering the rest of its kind when one goes", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", title: "Look" }),
		]);
		const box = view.getByRole("textbox", { name: "Message input" });
		const png = (name: string) => new File([name], name, { type: "image/png" });
		const [first, csv, second, json, third] = [
			png("a.png"),
			new File(["x,y"], "notes.csv", { type: "text/csv" }),
			png("b.png"),
			new File(["{}"], "data.json", { type: "application/json" }),
			png("c.png"),
		];
		await typeIn(box, "compare");
		for (const file of [first, csv, second, json, third]) {
			await act(async () =>
				fireEvent.paste(box, { clipboardData: { files: [file] } }),
			);
		}

		await waitFor(() =>
			expect(textIn(box)).toBe(
				"compare [Image 1] [File 1] [Image 2] [File 2] [Image 3] ",
			),
		);
		const tiles = view.container.ownerDocument.querySelector(
			".aui-composer-attachments",
		) as HTMLElement;
		const names = () =>
			[...tiles.querySelectorAll(".aui-attachment-tile-name")].map(
				(name) => name.textContent,
			);
		expect(names()).toEqual([
			"Image 1",
			"File 1",
			"Image 2",
			"File 2",
			"Image 3",
		]);

		await act(async () =>
			fireEvent.click(
				within(tiles).getByRole("button", { name: "Remove notes.csv" }),
			),
		);
		await waitFor(() =>
			expect(names()).toEqual(["Image 1", "Image 2", "File 1", "Image 3"]),
		);
		expect(textIn(box)).toBe("compare [Image 1] [Image 2] [File 1] [Image 3] ");
		await act(async () =>
			fireEvent.click(
				within(tiles).getByRole("button", { name: "Remove a.png" }),
			),
		);

		await waitFor(() =>
			expect(textIn(box)).toBe("compare [Image 1] [File 1] [Image 2] "),
		);
		await waitFor(() =>
			expect(names()).toEqual(["Image 1", "File 1", "Image 2"]),
		);
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{
					method: "POST",
					body: {
						text: "compare [Image 1] [File 1] [Image 2]",
						file: [second, json, third],
					},
				},
			]),
		);
	});

	it("draws the images a sent message names as chips that open them", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Look",
				messages: [
					{
						...message("user", "see [Image 1]"),
						parts: [
							{ type: "image", name: "ab12.png", mimeType: "image/png" },
							{ type: "text", text: "see [Image 1]" },
						],
					},
				],
			}),
		]);
		const thread = view.getByRole("region", { name: "Look" });

		const chip = await waitFor(() =>
			within(thread).getByRole("button", { name: "Image 1" }),
		);
		await act(async () => fireEvent.click(chip));

		await waitFor(() =>
			expect(view.getByRole("dialog", { name: "ab12.png" })).toBeTruthy(),
		);
	});

	it("draws the other files a sent message names as chips on the tiles they open", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Look",
				messages: [
					{
						...message("user", "see [File 1]"),
						parts: [
							{
								type: "file",
								name: "cd34.csv",
								title: "notes.csv",
								mimeType: "text/csv",
							},
							{ type: "text", text: "see [File 1]" },
						],
					},
				],
			}),
		]);
		const thread = view.getByRole("region", { name: "Look" });

		const chip = await waitFor(() =>
			within(thread).getByRole("button", { name: "File 1" }),
		);
		const tile = thread.querySelector('[data-attachment="File 1"]');
		expect(tile?.getAttribute("title")).toBe("notes.csv");
		const opened = mock();
		tile?.addEventListener("click", (event) => {
			event.preventDefault();
			opened();
		});
		await act(async () => fireEvent.click(chip));

		expect(opened).toHaveBeenCalledTimes(1);
	});

	it("scrolls the thread at once, even when asked to glide", async () => {
		const view = await testing.openConversations([
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
		await testing.openConversations([
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

		expect(testing.posted("/api/conversations/c1/answer")).toEqual([
			{
				method: "POST",
				body: { ask: "t1", answer: { type: "permission", option: "no" } },
			},
		]);
	});

	it("sets the command a permission asks to run as code", async () => {
		const command = "git status && bin/wiz dev fix 2>&1 | tail -15";
		const view = await testing.openConversations([
			conversation({
				status: "running",
				messages: [
					message("agent", tool({ id: "t1", title: command, command })),
				],
				ask: {
					type: "permission",
					id: "t1",
					at: "2026-10-11T10:00:00.000Z",
					title: command,
					options: [{ id: "yes", name: "Allow", kind: "allow_once" }],
				},
			}),
		]);

		const card = view.getByRole("generic", { name: "permission" });
		expect(card.querySelector("code")?.textContent).toBe(command);
	});

	it("answers a question form with the choices picked", async () => {
		const view = await testing.openConversations([
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

		expect(testing.posted("/api/conversations/c1/answer")).toEqual([
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
		const view = await testing.openConversations([
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
					{ name: /^Archive/ },
				),
			),
		);

		expect(view.queryByRole("dialog")).toBeNull();
		expect(testing.posted("/api/conversations/c1/setting")).toEqual([
			{ method: "PUT", body: { id: "model", value: "small" } },
		]);
		expect(testing.posted("/api/conversations/c1/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
	});

	it("shows an effort picker by its value alone", async () => {
		const view = await testing.openConversations([
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
		const view = await testing.openConversations([
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

		expect(testing.posted("/api/conversations/c1/setting")).toEqual([
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
		const view = await testing.openConversations(
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

	it("takes a message in an archived conversation, and unarchives it from its actions", async () => {
		const view = await testing.openConversations([], null);
		await testing.say(conversation({ status: "stopped", archived: true }));
		await act(async () => {
			location.hash = "#conversations/c1";
			window.dispatchEvent(new HashChangeEvent("hashchange"));
		});

		expect(
			view
				.getByRole("textbox", { name: "Message input" })
				.getAttribute("contenteditable"),
		).toBe("true");
		await act(async () =>
			fireEvent.click(
				within(view.getByRole("navigation", { name: "actions" })).getByRole(
					"button",
					{ name: /^Unarchive/ },
				),
			),
		);
		expect(testing.posted("/api/conversations/c1/archived")).toEqual([
			{ method: "PUT", body: { archived: false } },
		]);
	});

	it("shows why a conversation failed, and takes a prompt to resume it", async () => {
		const view = await testing.openConversations([
			conversation({ status: "failed", error: "Claude exited with code 1" }),
		]);

		expect(view.getByRole("alert").textContent).toBe(
			"Claude exited with code 1",
		);
		expect(
			view
				.getByRole("textbox", { name: "Message input" })
				.getAttribute("contenteditable"),
		).toBe("true");
	});
});
