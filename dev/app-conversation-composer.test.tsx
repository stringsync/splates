import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationState } from "../conversations";
import {
	act,
	type ConversationsView,
	cleanup,
	conversation,
	fireEvent,
	message,
	newWith,
	Testing,
	textIn,
	todo,
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
	describe("/ commands", () => {
		const held = conversation({
			commands: [
				{ name: "arbor", description: "Land work on trunk", hint: null },
				{ name: "code-review", description: "Review the diff", hint: null },
				{ name: "init", description: "Write a CLAUDE.md", hint: null },
			],
		});
		const composer = async () => {
			const view = await testing.openConversations([held]);
			const box = view.getByRole("textbox", {
				name: "Message input",
			});
			return { view, box };
		};

		it("lists the agent's skills for a / at the start, filtered as typed, and writes the one picked", async () => {
			const { view, box } = await composer();

			await typeIn(box, "/");
			const list = await waitFor(() => view.getByRole("listbox"));
			expect(
				within(list)
					.getAllByRole("option")
					.map((option) => option.textContent),
			).toEqual([
				"/arborLand work on trunk",
				"/code-reviewReview the diff",
				"/initWrite a CLAUDE.md",
			]);

			await typeIn(box, "/rev");
			expect(
				within(view.getByRole("listbox"))
					.getAllByRole("option")
					.map((option) => option.textContent),
			).toEqual(["/code-reviewReview the diff"]);
			await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

			expect(textIn(box)).toBe("/code-review ");
			// Enter picked a command; it did not send.
			expect(testing.posted(`/api/conversations/${held.id}/prompt`)).toEqual(
				[],
			);
		});

		it("leaves a / anywhere but the start a character", async () => {
			const { view, box } = await composer();

			for (const text of ["see /in", "src/in"]) {
				await typeIn(box, text);
				expect(view.queryByRole("listbox")).toBeNull();
			}
		});
	});

	describe("# references", () => {
		const board = {
			todos: [todo({ id: 12, subject: "Retry the upload on a 413", lane: 3 })],
			lanes: [{ id: 3, name: "Uploads" }],
		};

		it("lists arbor's items by category for a #, and writes the one picked as a chip", async () => {
			const view = await testing.openConversations([], null, board);
			const box = view.getByRole("textbox", {
				name: "Message input",
			});

			await typeIn(box, "#");
			const categories = await waitFor(() =>
				view.getByRole("listbox", { name: "references" }),
			);
			expect(
				within(categories)
					.getAllByRole("option")
					.map((option) => option.textContent),
			).toEqual(["Directives", "Todos", "Lanes", "Tasks"]);
			await act(async () =>
				fireEvent.click(
					within(categories).getByRole("option", { name: /Todos/ }),
				),
			);
			const todos = view.getByRole("listbox", { name: "references" });
			expect(
				within(todos)
					.getAllByRole("option")
					.map((option) => option.textContent),
			).toEqual(["Retry the upload on a 413#12"]);

			await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

			await waitFor(() =>
				expect(within(box).getByTitle("[ARBOR TODO #12]")).toBeTruthy(),
			);
			expect(textIn(box)).toBe("[ARBOR TODO #12] ");
			expect(testing.posted("/api/conversations")).toEqual([]);
		});

		it("reaches Back with the arrow keys in a category, and goes back on Enter", async () => {
			const view = await testing.openConversations([], null, board);
			const box = view.getByRole("textbox", {
				name: "Message input",
			});
			const key = (name: string) =>
				act(async () => fireEvent.keyDown(box, { key: name }));
			const highlighted = () =>
				view
					.getByRole("listbox", { name: "references" })
					.querySelector("[data-highlighted]")?.textContent;

			await typeIn(box, "#");
			await waitFor(() => view.getByRole("listbox", { name: "references" }));
			await key("ArrowDown");
			await key("Enter");
			expect(highlighted()).toBe("Retry the upload on a 413#12");

			await key("ArrowUp");
			expect(highlighted()).toBe("Back");
			await key("ArrowDown");
			expect(highlighted()).toBe("Retry the upload on a 413#12");
			await key("ArrowDown");
			expect(highlighted()).toBe("Back");

			await key("Enter");
			expect(
				within(view.getByRole("listbox", { name: "references" }))
					.getAllByRole("option")
					.map((option) => option.textContent),
			).toEqual(["Directives", "Todos", "Lanes", "Tasks"]);
			expect(textIn(box)).toBe("#");
			expect(testing.posted("/api/conversations")).toEqual([]);
		});

		it("keeps the row the arrow keys are on while the pointer rests on the list", async () => {
			const view = await testing.openConversations([], null, {
				todos: [1, 2, 3].map((id) => todo({ id, subject: `Todo ${id}` })),
				lanes: [],
			});
			const box = view.getByRole("textbox", {
				name: "Message input",
			});
			const key = (name: string) =>
				act(async () => fireEvent.keyDown(box, { key: name }));
			const list = () => view.getByRole("listbox", { name: "references" });
			const highlighted = () =>
				list().querySelector("[data-highlighted]")?.textContent;
			const point = (subject: string, left: number) =>
				act(async () =>
					fireEvent.mouseMove(
						within(list()).getByRole("option", {
							name: new RegExp(subject),
						}),
						{ clientX: left, clientY: 10 },
					),
				);

			await typeIn(box, "#");
			await waitFor(list);
			await key("ArrowDown");
			await key("Enter");
			expect(highlighted()).toBe("Todo 1#1");

			// Rows scrolling under a pointer that stays put, or only trembles.
			await point("Todo 3", 100);
			await point("Todo 3", 102);
			expect(highlighted()).toBe("Todo 1#1");
			await key("ArrowDown");
			await point("Todo 1", 101);
			expect(highlighted()).toBe("Todo 2#2");

			// A pointer that really moves takes the highlight.
			await point("Todo 3", 120);
			expect(highlighted()).toBe("Todo 3#3");
			await point("Todo 1", 121);
			expect(highlighted()).toBe("Todo 1#1");
		});

		it("searches every category for what follows the #", async () => {
			const view = await testing.openConversations([], null, board);
			const box = view.getByRole("textbox", {
				name: "Message input",
			});

			await typeIn(box, "see #upl");
			const found = await waitFor(() =>
				view.getByRole("listbox", { name: "references" }),
			);
			expect(
				within(found)
					.getAllByRole("option")
					.map((option) => option.textContent),
			).toEqual(["Retry the upload on a 413#12", "Uploadslane 3"]);
			await act(async () => fireEvent.keyDown(box, { key: "ArrowDown" }));
			await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

			await waitFor(() =>
				expect(view.getByTitle("[ARBOR LANE 3]")).toBeTruthy(),
			);
			expect(textIn(box)).toBe("see [ARBOR LANE 3] ");
		});

		it("writes a system picked after a #, by its name when an alias found it", async () => {
			testing.systems = [
				{ name: "playback", aliases: ["player"], globs: ["src/audio/**"] },
			];
			const view = await testing.openConversations([], null, board);
			const box = view.getByRole("textbox", {
				name: "Message input",
			});

			await typeIn(box, "fix #playe");
			const found = await waitFor(() =>
				view.getByRole("listbox", { name: "references" }),
			);
			expect(
				within(found)
					.getAllByRole("option")
					.map((option) => option.textContent),
			).toEqual(["playbackplayer"]);
			await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

			await waitFor(() => expect(textIn(box)).toBe("fix #playback "));
			expect(
				within(box).getByRole("button", { name: "playback" }),
			).toBeTruthy();
		});

		it("offers no system its name or alias calls without a #, and sends on Enter", async () => {
			testing.systems = [
				{ name: "playback", aliases: ["player"], globs: ["src/audio/**"] },
			];
			const view = await testing.openConversations([], null, board);
			const box = view.getByRole("textbox", {
				name: "Message input",
			});

			for (const text of ["fix playback", "the Player"]) {
				await typeIn(box, text);
				expect(view.queryByRole("listbox", { name: "references" })).toBeNull();
			}

			testing.reply = conversation({ id: "c9", status: "starting" });
			await typeIn(box, "fix player");
			await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
			await waitFor(() =>
				expect(testing.posted("/api/conversations/c9/prompt")).toEqual([
					{ method: "POST", body: { text: "fix player" } },
				]),
			);
		});

		it("offers the systems as a category of their own", async () => {
			testing.systems = [{ name: "mixer", globs: ["src/mixer/**"] }];
			const view = await testing.openConversations([], null, board);
			const box = view.getByRole("textbox", {
				name: "Message input",
			});

			await typeIn(box, "#");
			const categories = await waitFor(() =>
				view.getByRole("listbox", { name: "references" }),
			);
			await act(async () =>
				fireEvent.click(
					within(categories).getByRole("option", { name: /Systems/ }),
				),
			);
			await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

			await waitFor(() => expect(textIn(box)).toBe("#mixer "));
		});

		it("runs a conversation's action picked after a #, writing nothing", async () => {
			const view = await testing.openConversations([
				conversation({ title: "alpha" }),
			]);
			const box = view.getByRole("textbox", {
				name: "Message input",
			});

			await typeIn(box, "#archi");
			await waitFor(() => view.getByRole("listbox", { name: "references" }));
			await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

			expect(testing.posted("/api/conversations/c1/archived")).toEqual([
				{ method: "PUT", body: { archived: true } },
			]);
			expect(textIn(box)).toBe("");
		});
	});

	describe("drafts", () => {
		const held = [
			conversation({ id: "c1", title: "Fix login" }),
			conversation({ id: "c2", title: "Tidy tests" }),
		];
		/** Opens the conversation listed by `name`, as a click in the sidebar does. */
		const go = async (view: ConversationsView, name: string) => {
			const nav = view.getByRole("navigation", { name: "conversations" });
			const item = within(nav)
				.getAllByRole("button")
				.find((button) => button.textContent?.includes(name));
			if (item === undefined) {
				throw new Error(`no ${name} listed`);
			}
			await act(async () => fireEvent.click(item));
		};
		const box = (view: ConversationsView) =>
			view.getByRole("textbox", {
				name: "Message input",
			});
		const type = (view: ConversationsView, text: string) =>
			typeIn(box(view), text);

		it("keeps what was typed in each conversation, and a new one, while switching", async () => {
			const view = await testing.openConversations(held, "c1");
			await type(view, "half a thought");

			await go(view, "Tidy tests");
			await waitFor(() => expect(textIn(box(view))).toBe(""));
			await type(view, "another");
			await newWith(view, "Claude");
			await waitFor(() => expect(textIn(box(view))).toBe(""));
			await type(view, "a fresh start");

			await go(view, "Fix login");
			await waitFor(() => expect(textIn(box(view))).toBe("half a thought"));
			await go(view, "Tidy tests");
			await waitFor(() => expect(textIn(box(view))).toBe("another"));
			await newWith(view, "Claude");
			await waitFor(() => expect(textIn(box(view))).toBe("a fresh start"));
		});

		it("keeps a draft across a reload, and drops it once sent", async () => {
			const view = await testing.openConversations(held, "c1");
			await type(view, "before the reload");
			cleanup();

			const again = await testing.openConversations(held, "c1");
			await waitFor(() => expect(textIn(box(again))).toBe("before the reload"));
			await act(async () => fireEvent.keyDown(box(again), { key: "Enter" }));
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "before the reload" } },
			]);
			await go(again, "Tidy tests");
			await go(again, "Fix login");
			await waitFor(() => expect(textIn(box(again))).toBe(""));
		});

		it("makes a directive typed anywhere a chip, and sends it where it stands", async () => {
			const view = await testing.openConversations(held, "c1");
			await type(view, "keep [ARBOR TODO #12] small");

			await waitFor(() =>
				expect(within(box(view)).getByTitle("[ARBOR TODO #12]")).toBeTruthy(),
			);
			expect(textIn(box(view))).toBe("keep [ARBOR TODO #12] small");
			expect(localStorage.getItem("arbor.draft.c1")).toBe(
				"keep [ARBOR TODO #12] small",
			);

			await act(async () => fireEvent.keyDown(box(view), { key: "Enter" }));
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "keep [ARBOR TODO #12] small" } },
			]);
			await waitFor(() =>
				expect(view.queryByTitle("[ARBOR TODO #12]")).toBeNull(),
			);
			expect(localStorage.getItem("arbor.draft.c1") ?? "").toBe("");
		});

		it("shows the directives a sent message starts with as chips, ahead of its words", async () => {
			const view = await testing.openConversations([
				conversation({
					id: "c1",
					title: "Fix login",
					messages: [
						message("user", "[ARBOR TASK alpha]\n\nand keep it small"),
						message("user", "not [ARBOR TASK alpha] here"),
					],
				}),
			]);

			await waitFor(() =>
				expect(view.getByTitle("[ARBOR TASK alpha]").textContent).toBe(
					"Taskalpha",
				),
			);
			expect(view.getByText("and keep it small")).toBeTruthy();
			expect(view.getByText("not [ARBOR TASK alpha] here")).toBeTruthy();
		});

		it("sends a directive kept in a draft with nothing typed", async () => {
			localStorage.setItem("arbor.draft.c1", "[ARBOR TASK alpha]");
			const view = await testing.openConversations(held, "c1");
			await waitFor(() =>
				expect(view.getByTitle("[ARBOR TASK alpha]").textContent).toBe(
					"Taskalpha",
				),
			);
			expect(textIn(box(view))).toBe("[ARBOR TASK alpha]");

			await act(async () => fireEvent.keyDown(box(view), { key: "Enter" }));
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "[ARBOR TASK alpha]" } },
			]);
		});

		it("drops a directive from the draft when Backspace takes its chip", async () => {
			const view = await testing.openConversations(held, "c1");
			await type(view, "then stop [ARBOR LANE 2]");
			await waitFor(() =>
				expect(within(box(view)).getByTitle("[ARBOR LANE 2]")).toBeTruthy(),
			);

			await act(async () => fireEvent.keyDown(box(view), { key: "Backspace" }));

			expect(view.queryByTitle("[ARBOR LANE 2]")).toBeNull();
			expect(textIn(box(view))).toBe("then stop ");
			expect(localStorage.getItem("arbor.draft.c1")).toBe("then stop ");
		});

		it("puts a message back in the composer when the server refuses it", async () => {
			const view = await testing.openConversations(held, "c1");
			testing.refuseWrites = { reason: "usage", message: "not now" };
			await type(view, "try this");

			await act(async () => fireEvent.keyDown(box(view), { key: "Enter" }));

			await waitFor(() => expect(textIn(box(view))).toBe("try this"));
		});

		it("sends while the agent works, offering Send over Stop once something is typed", async () => {
			const view = await testing.openConversations(
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
				expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
					{ method: "POST", body: { text: "use the second note" } },
				]),
			);
			// Sent mid-turn, it stops nothing.
			expect(testing.posted("/api/conversations/c1/send-now")).toEqual([]);
		});

		it("shows the directives a queued message starts with as chips, ahead of its words", async () => {
			const view = await testing.openConversations(
				[
					conversation({
						id: "c1",
						title: "Fix login",
						status: "running",
						messages: [
							message("user", "go"),
							{
								...message("user", "[ARBOR TASK alpha]\n\nthen stop"),
								queued: true,
							},
						],
					}),
				],
				"c1",
			);

			const queued = view.getByRole("region", { name: "queued messages" });
			expect(within(queued).getByTitle("[ARBOR TASK alpha]").textContent).toBe(
				"Taskalpha",
			);
			expect(within(queued).getByText("then stop")).toBeTruthy();
		});

		it("holds a queued message above the composer, out of the thread, to send now or take back with Up", async () => {
			const view = await testing.openConversations(
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
			expect(testing.posted("/api/conversations/c1/send-now")).toHaveLength(1);
			// Enter with nothing typed, as in Zed, which the button says until
			// something is typed.
			const send = within(queued).getByRole("button", { name: /Send now/ });
			expect(send.textContent).toBe("Send now↵");
			await type(view, "more");
			expect(send.textContent).toBe("Send now");
			// With something typed, Enter queues it and sends nothing now.
			await act(async () => fireEvent.keyDown(box(view), { key: "Enter" }));
			await waitFor(() =>
				expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
					{ method: "POST", body: { text: "more" } },
				]),
			);
			expect(testing.posted("/api/conversations/c1/send-now")).toHaveLength(1);
			await waitFor(() => expect(textIn(box(view))).toBe(""));
			await act(async () => fireEvent.keyDown(box(view), { key: "Enter" }));
			expect(testing.posted("/api/conversations/c1/send-now")).toHaveLength(2);
			testing.reply = { text: "the second note", images: [] };
			await act(async () => fireEvent.keyDown(box(view), { key: "ArrowUp" }));
			expect(testing.posted("/api/conversations/c1/unqueue")).toEqual([
				{ method: "POST", body: { index: 0 } },
			]);
			await waitFor(() => expect(textIn(box(view))).toBe("the second note"));
		});

		it("throws a queued message away, leaving the composer as it was", async () => {
			const view = await testing.openConversations(
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

			expect(testing.posted("/api/conversations/c1/unqueue")).toEqual([
				{ method: "POST", body: { index: 1 } },
			]);
			expect(textIn(box(view))).toBe("still typing");
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
			const view = await testing.openConversations(
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

	describe("chips", () => {
		const held = [conversation({ id: "c1", title: "Fix login" })];
		const box = (view: ConversationsView) =>
			view.getByRole("textbox", { name: "Message input" });

		it("shows a file picked after an @ as its chip, the text reading its path", async () => {
			testing.tree = ["src/", "src/index.ts"];
			const view = await testing.openConversations(held, "c1");

			await typeIn(box(view), "see @ind");
			await waitFor(() => view.getByRole("listbox"));
			await act(async () => fireEvent.keyDown(box(view), { key: "Enter" }));

			await waitFor(() => expect(textIn(box(view))).toBe("see @src/index.ts "));
			expect(
				within(box(view)).getByTitle(/\/src\/index\.ts$/).textContent,
			).toBe("index.ts");
		});

		it("names file chips that share a name by the directories above them", async () => {
			testing.tree = [
				"app/",
				"app/index.ts",
				"server/",
				"server/index.ts",
				"a.ts",
			];
			localStorage.setItem(
				"arbor.draft.c1",
				"@app/index.ts @server/index.ts @a.ts",
			);
			const view = await testing.openConversations(held, "c1");

			await waitFor(() =>
				expect(
					within(box(view))
						.getAllByRole("link")
						.map((chip) => chip.textContent),
				).toEqual(["app/index.ts", "server/index.ts", "a.ts"]),
			);
		});

		it("shows the references in a draft as Resolving… until the paths and systems come, then as their chips", async () => {
			let list = () => {};
			testing.listing = new Promise((resolve) => {
				list = resolve;
			});
			testing.tree = ["src/", "src/index.ts"];
			testing.systems = [
				{ name: "playback", aliases: ["player"], globs: ["src/audio/**"] },
			];
			const draft = "fix #player in @src/index.ts, not #12 or @gone.ts";
			localStorage.setItem("arbor.draft.c1", draft);
			const view = await testing.openConversations(held, "c1");

			await waitFor(() =>
				expect(within(box(view)).getAllByText("Resolving…")).toHaveLength(3),
			);
			expect(textIn(box(view))).toBe(draft);

			await act(async () => list());

			await waitFor(() =>
				expect(within(box(view)).queryByText("Resolving…")).toBeNull(),
			);
			expect(
				within(box(view)).getByRole("button", { name: "playback" }),
			).toBeTruthy();
			expect(within(box(view)).getByTitle(/\/src\/index\.ts$/)).toBeTruthy();
			// Named nothing once they came: as written.
			expect(within(box(view)).getByText("@gone.ts")).toBeTruthy();
			expect(textIn(box(view))).toBe(draft);
		});
	});
});
