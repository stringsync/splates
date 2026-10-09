import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationState } from "../conversations";
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
	) => {
		testing.talk = { agents: AGENTS, conversations: held };
		const view = await testing.open({ tasks: [details({ task: "alpha" })] });
		const tab = await waitFor(() =>
			view.getByRole("tab", { name: /Conversations/ }),
		);
		await act(async () => fireEvent.click(tab));
		if (open !== null) {
			const nav = view.getByRole("navigation", { name: "conversations" });
			const item = within(nav)
				.getAllByRole("button")
				.find((button) => button.textContent?.includes(nameIn(held, open)));
			if (item === undefined) {
				throw new Error(`no conversation ${open} listed`);
			}
			await act(async () => fireEvent.click(item));
		}
		return view;
	};

	const nameIn = (held: ConversationState[], id: string) => {
		const found = held.find((each) => each.id === id);
		return found?.title ?? found?.task ?? "New conversation";
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

	it("lists conversations by task, the main tree last, and archived ones apart", async () => {
		const view = await conversations(
			[
				conversation({ id: "c1", task: "alpha", title: "Fix login" }),
				conversation({ id: "c2", task: null, title: "Look around" }),
				conversation({ id: "c3", task: "alpha", title: "Old", archived: true }),
			],
			null,
		);
		const nav = view.getByRole("navigation", { name: "conversations" });

		expect(
			within(nav)
				.getAllByRole("list")
				.map((group) => [
					group.getAttribute("aria-label"),
					...within(group)
						.queryAllByRole("listitem")
						.map((item) => item.textContent),
				]),
		).toEqual([
			["alpha", "Fix login"],
			["Main tree", "Look around"],
		]);
		await act(async () =>
			fireEvent.click(within(nav).getByRole("button", { name: /Archived/ })),
		);
		const archived = view.getByRole("region", {
			name: "archived conversations",
		});
		expect(archived.textContent).toContain("Old");
		expect(location.hash).toBe("#conversations/archived");
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
				within(nav).getByRole("button", { name: "Archive Fix login" }),
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
			fireEvent.click(view.getByRole("button", { name: "More for Fix login" })),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("menuitem", { name: "Rename" })),
			),
		);
		const box = await waitFor(() =>
			view.getByRole("textbox", { name: "Rename Fix login" }),
		);
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
					within(nav).getByRole("button", { name: "Claude Fix login" }),
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
			expect(view.queryByRole("region", { name: "Fix login" })).toBeNull();
		} finally {
			resize(1024, 768);
		}
	});

	it("starts a conversation from a task's +, with the agent picked, and opens it", async () => {
		const view = await conversations([], null);
		testing.reply = conversation({
			id: "c9",
			agent: "codex",
			task: "alpha",
			status: "starting",
		});

		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "New conversation in alpha" }),
			),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("menuitem", { name: "Codex" })),
			),
		);

		expect(posted("/api/conversations")).toEqual([
			{ method: "POST", body: { agent: "codex", task: "alpha" } },
		]);
		await waitFor(() =>
			expect(view.getByRole("region", { name: "alpha" })).toBeTruthy(),
		);
		expect(location.hash).toBe("#conversations/c9");
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
					{
						role: "user",
						parts: [{ type: "text", text: "what does it say?" }],
					},
					{
						role: "agent",
						parts: [
							{
								type: "tool",
								id: "t1",
								title: "cat note.txt",
								status: "completed",
							},
							{ type: "text", text: "It says **hi**." },
						],
					},
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
		await act(async () =>
			fireEvent.click(
				within(thread).getByRole("button", { name: /1 tool call/ }),
			),
		);
		expect(thread.textContent).toContain("cat note.txt");
		expect(within(thread).getByText("running")).toBeTruthy();
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

	it("answers a permission with a digit: 1 denies, 2 allows once, 3 always", async () => {
		await conversations([
			conversation({
				status: "running",
				ask: {
					type: "permission",
					id: "t1",
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

	it("switches the model, and archives the conversation", async () => {
		const view = await conversations([
			conversation({
				model: {
					id: "model",
					name: "Model",
					current: "big",
					options: [
						{ value: "big", name: "Big", description: null },
						{ value: "small", name: "Small", description: null },
					],
				},
			}),
		]);

		await act(async () =>
			fireEvent.change(view.getByRole("combobox", { name: "model" }), {
				target: { value: "small" },
			}),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Archive" })),
		);

		expect(posted("/api/conversations/c1/model")).toEqual([
			{ method: "PUT", body: { model: "small" } },
		]);
		expect(posted("/api/conversations/c1/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
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
			fireEvent.click(view.getByRole("button", { name: "Unarchive" })),
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
});
