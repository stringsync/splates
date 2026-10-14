import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	textIn,
	todo,
	typeIn,
	waitFor,
	within,
} from "./testing";

describe("App's todo cards", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

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
		const view = await testing.openConversations([proposing], undefined, board);
		const open = await waitFor(() =>
			view.getByRole("region", { name: "todo 12" }),
		);
		// Live: the subject as the board has it now, and its lane.
		expect(open.textContent).toContain("Retry the upload on a 413");
		expect(open.textContent).toContain("Uploads");
		expect(open.textContent).toContain("It fails on a 413.");
		// Proposed with no report above, they go unheaded.
		expect(view.queryByText("Next up")).toBeNull();
		const taken = view.getByRole("region", { name: "todo 14" });
		expect(taken.textContent).toContain("limits");
		expect(within(taken).queryByRole("button", { name: /Start/ })).toBeNull();
		const gone = view.getByRole("region", { name: "todo 15" });
		expect(gone.textContent).toContain("archived");
		expect(within(gone).queryByRole("button")).toBeNull();
		const box = view.getByRole("textbox", {
			name: "Message input",
		});
		await typeIn(box, "half a thought");

		await act(async () =>
			fireEvent.click(within(open).getByRole("button", { name: "Start" })),
		);

		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{ method: "POST", body: { text: "[ARBOR TODO #12]" } },
		]);
		expect(textIn(box)).toBe("half a thought");
	});

	it("heads the todos proposed after a merge Next up", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					title: "Merged",
					messages: [
						message(
							"agent",
							[
								"## ✅ Merged uploads onto main",
								"",
								"Uploads retry now.",
								"",
								"### 📝 Retry the upload [#12]",
								"",
								"It touches the retry loop.",
							].join("\n"),
						),
					],
				}),
			],
			undefined,
			board,
		);
		await waitFor(() => view.getByRole("region", { name: "todo 12" }));
		expect(view.getByText("Next up")).toBeTruthy();
	});

	it("starts a proposed todo in a new conversation straight away, on the agent and model it is assigned to", async () => {
		const view = await testing.openConversations(
			[conversation({ ...proposing, agent: "codex" })],
			undefined,
			{
				...board,
				todos: [
					todo({
						id: 12,
						subject: "Retry the upload on a 413",
						lane: 3,
						assignee: { agent: "claude", model: "haiku" },
					}),
					...board.todos.slice(1),
				],
			},
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
		testing.reply = conversation({ id: "c9", status: "starting" });

		await act(async () =>
			fireEvent.click(
				within(open).getByRole("button", {
					name: "Start in a new conversation",
				}),
			),
		);

		await waitFor(() => expect(location.hash).toBe("#conversations/c9"));
		expect(
			testing.posted("/api/conversations").map((each) => each.body),
		).toEqual([
			{
				agent: "claude",
				task: null,
				settings: {},
				model: "haiku",
				assigned: true,
			},
		]);
		await waitFor(() =>
			expect(
				testing.posted("/api/conversations/c9/prompt").map((each) => each.body),
			).toEqual([{ text: "[ARBOR TODO #12]" }]),
		);
		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([]);
	});

	it("starts a proposed todo no one is assigned to with this conversation's agent", async () => {
		const view = await testing.openConversations(
			[conversation({ ...proposing, agent: "codex" })],
			undefined,
			board,
		);
		const open = await waitFor(() =>
			view.getByRole("region", { name: "todo 12" }),
		);
		testing.reply = conversation({ id: "c9", status: "starting" });

		await act(async () =>
			fireEvent.click(
				within(open).getByRole("button", {
					name: "Start in a new conversation",
				}),
			),
		);

		await waitFor(() => expect(location.hash).toBe("#conversations/c9"));
		expect(
			testing.posted("/api/conversations").map((each) => each.body.agent),
		).toEqual(["codex"]);
		await waitFor(() =>
			expect(
				testing.posted("/api/conversations/c9/prompt").map((each) => each.body),
			).toEqual([{ text: "[ARBOR TODO #12]" }]),
		);
	});

	it("keeps a todo as proposed once the person has replied, and says whether it was started", async () => {
		const view = await testing.openConversations(
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
		expect(within(started).queryByRole("button", { name: /Start/ })).toBeNull();
		const other = view.getByRole("region", { name: "todo 15" });
		expect(other.textContent).not.toContain("archived");
		expect(other.textContent).not.toContain("Started");
	});

	it("gathers the todos the reply's task added while it ran under the lane they went to, and not one from before or elsewhere", async () => {
		const at = (minute: number) =>
			new Date(Date.UTC(2026, 9, 13, 12, minute)).toISOString();
		const proposed = (id: number) => `### 📝 Todo ${id} [#${id}]\n\nWhy.`;
		const view = await testing.openConversations(
			[
				conversation({
					task: "uploads",
					lastTask: "uploads",
					messages: [
						{
							...message("user", "Fix the backoff"),
							at: at(0),
							until: at(0),
						},
						{
							...message(
								"agent",
								[12, 13, 14, 15, 16].map(proposed).join("\n\n"),
							),
							at: at(1),
							until: at(9),
						},
					],
				}),
			],
			undefined,
			{
				todos: [
					todo({ id: 12, from: "uploads", createdAt: at(5), lane: 3 }),
					todo({ id: 13, from: "uploads", createdAt: at(6), lane: 3 }),
					todo({ id: 14, from: "uploads", createdAt: at(7) }),
					// Added by the task, but in an earlier turn.
					todo({ id: 15, from: "uploads", createdAt: at(-30) }),
					// Added in the turn, by another task.
					todo({ id: 16, from: "logs", createdAt: at(5) }),
				],
				lanes: [{ id: 3, name: "Uploads" }],
			},
		);
		await waitFor(() => view.getByRole("region", { name: "todo 12" }));

		// Each line, with the cards on the rail under it.
		const groups = view.getAllByText(/^Added /).map((each) => {
			const line = each.closest("p");
			return [
				line?.textContent,
				[...(line?.nextElementSibling?.children ?? [])].map((card) =>
					card.getAttribute("aria-label"),
				),
			];
		});
		expect(groups).toEqual([
			["Added 2 to Uploads by this task", ["todo 12", "todo 13"]],
			["Added to Untriaged by this task", ["todo 14"]],
		]);
		// Only a line over two or more cards draws a rail.
		const railed = view
			.getAllByText(/^Added /)
			.map((each) =>
				each.closest("p")?.nextElementSibling?.classList.contains("border-l-2"),
			);
		expect(railed).toEqual([true, false]);
		expect(view.getByRole("region", { name: "todo 16" })).toBeTruthy();
	});

	it("opens a proposed todo from its subject, over the conversation", async () => {
		const view = await testing.openConversations([proposing], undefined, board);
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

		// Starting it in a new conversation leaves the dialog behind.
		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: "Start" })),
		);
		const codex = await waitFor(() =>
			view.getByRole("menuitem", { name: /Codex/ }),
		);
		await act(async () => fireEvent.click(codex));
		expect(location.hash).toBe("#conversations/new/codex");
		await waitFor(() =>
			expect(view.queryByRole("dialog", { name: /Todo 12/ })).toBeNull(),
		);
	});

	it("opens a todo mentioned in a message, and shows one that is gone as archived", async () => {
		const view = await testing.openConversations(
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

		// The directive it starts with is a chip, which opens it too.
		await act(async () => fireEvent.click(view.getByTitle("[ARBOR TODO #14]")));
		await waitFor(() =>
			expect(view.getByRole("dialog", { name: /Todo 14/ })).toBeTruthy(),
		);
		await act(async () => fireEvent.click(twelve));
		await waitFor(() =>
			expect(view.getByRole("dialog", { name: /Todo 12/ })).toBeTruthy(),
		);
	});
});
