import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { ConversationState } from "../conversations";
import type { Snapshot } from "../snapshot";
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

/** Sizes the window, as a phone held upright or a laptop. */
const resize = (width: number, height: number) =>
	(
		window as unknown as {
			happyDOM: { setViewport(size: { width: number; height: number }): void };
		}
	).happyDOM.setViewport({ width, height });

const AGENTS = [
	{ id: "claude", name: "Claude" },
	{ id: "codex", name: "Codex" },
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
	) => {
		testing.talk = { agents: AGENTS, conversations: held };
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
			fireEvent.click(view.getByRole("button", { name: "New conversation" })),
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

	it("shows no Conversations without `--experimental`", async () => {
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

	it("offers its actions in a card in its upper right, its task's changes among them, closing them on Escape", async () => {
		const view = await conversations([
			conversation({ id: "c1", task: "alpha", title: "Fix login" }),
			conversation({ id: "c2", title: "Look around" }),
		]);
		const overview = view.getByRole("navigation", { name: "overview" });

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
		const main = view.getByRole("navigation", { name: "overview" });
		expect(
			within(main)
				.getAllByRole("button")
				.map((button) => button.textContent),
		).toEqual(["TerminalCtrl+`", "Archive"]);
	});

	it("archives from the list, with the agent's mark in place of its name", async () => {
		const view = await conversations(
			[conversation({ id: "c1", task: "alpha", title: "Fix login" })],
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

	it("with none open, offers the latest idle conversations to pick back up, none working or waiting", async () => {
		const view = await conversations(
			[
				conversation({ id: "c1", task: "alpha", title: "Fix login" }),
				conversation({ id: "c4", title: "Busy", status: "running" }),
				conversation({ id: "c5", task: null, title: "Look into it" }),
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
		).toEqual(["alpha", "Look into itmain tree"]);
		expect(within(recent).queryByRole("status")).toBeNull();
		await act(async () =>
			fireEvent.click(within(recent).getByRole("button", { name: /alpha/ })),
		);
		expect(location.hash).toBe("#conversations/c1");
	});

	it("starts a conversation from the home composer, in the main tree with the agent picked beside New conversation and its settings, and says the message", async () => {
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

		it("composes the reply in the composer as choices are picked, sending nothing", async () => {
			const view = await conversations([asking()]);
			const choice = async (question: string, name: string) => {
				const card = await waitFor(() =>
					view.getByRole("listitem", { name: `question ${question}` }),
				);
				await act(async () =>
					fireEvent.click(
						within(card).getByRole("button", { name: new RegExp(name) }),
					),
				);
			};

			await choice("2", "A badge");
			expect(box(view).value).toBe("2. b");
			await choice("1", "Tasks");
			await choice("1", "Todos");
			expect(box(view).value).toBe("1. a, b\n2. b");
			await choice("2", "A muted card");
			expect(box(view).value).toBe("1. a, b\n2. a");
			expect(
				within(view.getByRole("listitem", { name: "question 2" }))
					.getByRole("button", { name: /A muted card/ })
					.getAttribute("aria-pressed"),
			).toBe("true");

			const note = (question: string) =>
				within(
					view.getByRole("listitem", { name: `question ${question}` }),
				).getByRole("textbox") as HTMLTextAreaElement;
			await act(async () =>
				fireEvent.change(note("2"), { target: { value: "only on phones" } }),
			);
			await act(async () =>
				fireEvent.change(note("3"), {
					target: { value: "after a\nphone check" },
				}),
			);
			expect(box(view).value).toBe(
				"1. a, b\n2. a: only on phones\n3. after a phone check",
			);
			expect(note("2").value).toBe("only on phones");
			expect(view.getByText("3 of 3 answered")).toBeTruthy();

			await act(async () =>
				fireEvent.change(note("3"), { target: { value: "" } }),
			);
			expect(box(view).value).toBe("1. a, b\n2. a: only on phones");
			expect(view.getByText("2 of 3 answered")).toBeTruthy();
			expect(posted("/api/conversations/c1/prompt")).toEqual([]);
		});

		it("keeps a note that starts like a choice as typed, picking nothing", async () => {
			const view = await conversations([asking()]);
			const card = await waitFor(() =>
				view.getByRole("listitem", { name: "question 2" }),
			);
			const note = within(card).getByRole("textbox") as HTMLTextAreaElement;

			for (const typed of ["a", "a ", "a lot"]) {
				await act(async () =>
					fireEvent.change(note, { target: { value: typed } }),
				);
				expect(note.value).toBe(typed);
			}
			expect(box(view).value).toBe("2. : a lot");
			expect(
				within(card)
					.getByRole("button", { name: /A muted card/ })
					.getAttribute("aria-pressed"),
			).toBe("false");
		});

		it("folds questions once replied to, opening on the answers sent, never asking them again", async () => {
			const view = await conversations([
				conversation({
					title: "Header",
					messages: [
						message("user", "fix the header"),
						message("agent", report),
						message("user", "1. a, b\n2. b: only on phones"),
						message("agent", "Done."),
					],
				}),
			]);
			const panel = await waitFor(() =>
				view.getByRole("region", { name: "questions for you" }),
			);
			const fold = within(panel).getByRole("button", {
				name: /Questions for you/,
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

		it("lists the files edited, each opening to its edits", async () => {
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
						paths: ["/repo/lib/b.ts"],
						edits: [{ path: "/repo/lib/b.ts", old: null, new: "new" }],
					}),
					"Done.",
				]),
			);

			const files = await waitFor(() =>
				within(thread).getByRole("list", { name: "edited files" }),
			);
			expect(files.textContent).toBe("src/a.ts×2lib/b.ts");
			await act(async () =>
				fireEvent.click(
					within(files).getByRole("button", { name: /src\/a.ts/ }),
				),
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

		it("shows a review apart from questions, merging or saying what to change through the composer", async () => {
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
				fireEvent.click(within(panel).getByRole("button", { name: /Merge/ })),
			);
			expect(box(view).value).toBe("merge");
			expect(
				within(panel)
					.getByRole("button", { name: /Merge on send/ })
					.getAttribute("aria-pressed"),
			).toBe("true");

			await act(async () =>
				fireEvent.change(
					within(panel).getByRole("textbox", { name: "Changes to header" }),
					{ target: { value: "keep it on one line on tablets" } },
				),
			);
			expect(box(view).value).toBe("keep it on one line on tablets");
			expect(
				within(panel)
					.getByRole("button", { name: /Merge/ })
					.getAttribute("aria-pressed"),
			).toBe("false");
			expect(posted("/api/conversations/c1/prompt")).toEqual([]);
		});

		it("keeps merge typed into the changes box, so a change can start with it", async () => {
			const view = await conversations([reviewing]);
			const panel = await waitFor(() =>
				view.getByRole("region", { name: "review header" }),
			);
			const changes = within(panel).getByRole("textbox", {
				name: "Changes to header",
			}) as HTMLTextAreaElement;

			await act(async () => {
				fireEvent.focus(changes);
				fireEvent.change(changes, { target: { value: "merge" } });
			});
			expect(changes.value).toBe("merge");

			await act(async () =>
				fireEvent.change(changes, {
					target: { value: "merge the header first" },
				}),
			);
			expect(box(view).value).toBe("merge the header first");
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

		it("offers to archive the conversation from each report of a task that is over", async () => {
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
			expect(gone.textContent).toContain("gone");
			expect(within(gone).queryByRole("button", { name: /Start/ })).toBeNull();
			const box = view.getByRole("textbox", {
				name: "Message input",
			}) as HTMLTextAreaElement;
			await act(async () =>
				fireEvent.change(box, { target: { value: "half a thought" } }),
			);

			await act(async () =>
				fireEvent.click(within(open).getByRole("button", { name: /Start/ })),
			);

			expect(posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "[ARBOR TODO #12]" } },
			]);
			expect(box.value).toBe("half a thought");
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
			expect(within(started).queryByRole("button")).toBeNull();
			const other = view.getByRole("region", { name: "todo 15" });
			expect(other.textContent).not.toContain("gone");
			expect(other.textContent).not.toContain("Started");
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

	it("switches a setting, and archives the conversation", async () => {
		const view = await conversations([
			conversation({
				settings: [
					{
						id: "model",
						name: "Model",
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
				within(view.getByRole("navigation", { name: "overview" })).getByRole(
					"button",
					{ name: "Archive" },
				),
			),
		);

		expect(posted("/api/conversations/c1/setting")).toEqual([
			{ method: "PUT", body: { id: "model", value: "small" } },
		]);
		expect(posted("/api/conversations/c1/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
	});

	it("offers each agent's own settings on the home, a pick for one never reaching the other", async () => {
		const model = (current: string, names: string[]) => ({
			id: "model",
			name: "Model",
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
				within(view.getByRole("navigation", { name: "overview" })).getByRole(
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

		it("lists a task whose agent runs outside the page as external, waiting once it escalates, and opens it alone with its questions, not its plan", async () => {
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
				["betaexternal", "working"],
				["gammaexternal", "waiting on you"],
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
			// Its agent cannot be messaged: the cards compose a reply to copy.
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
			expect(
				(
					within(alone).getByRole("textbox", {
						name: "reply",
					}) as HTMLTextAreaElement
				).value,
			).toBe("1. three");
			await act(async () =>
				fireEvent.click(within(alone).getByRole("button", { name: "Copy" })),
			);
			expect(copied).toEqual(["1. three"]);
			expect(
				within(alone).getByRole("button", { name: "Copied" }),
			).toBeTruthy();
			await act(async () =>
				fireEvent.click(
					within(alone).getByRole("button", { name: "About gamma" }),
				),
			);
			const popup = await waitFor(() =>
				view.getByRole("dialog", { name: "About gamma" }),
			);
			expect(popup.textContent).toContain("Waiting on you: How many retries?");
			expect(popup.textContent).toContain("Cap upload retries");
			await act(async () =>
				fireEvent.click(within(popup).getByRole("button", { name: "Details" })),
			);
			expect(view.getByRole("dialog", { name: "gamma" })).toBeTruthy();
		});

		it("heads a conversation with its branch and progress, which open its Goal, next step and open questions", async () => {
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
			const popup = await waitFor(() =>
				view.getByRole("dialog", { name: "About alpha" }),
			);
			expect(popup.textContent).toContain("Cap upload retries");
			expect(popup.textContent).toContain("Assuming: How many retries?");
			// No panel of them in the thread yet: the plan they are in opens.
			await act(async () =>
				fireEvent.click(
					within(popup).getByRole("button", { name: "1 open question" }),
				),
			);
			expect(view.getByRole("dialog", { name: "alpha" })).toBeTruthy();
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
	});
});
