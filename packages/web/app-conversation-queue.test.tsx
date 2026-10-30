import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	type ConversationsView,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	textIn,
	typeIn,
	waitFor,
	within,
} from "./testing";

describe("App's composer queue", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const _held = [
		conversation({ id: "c1", title: "Fix login" }),
		conversation({ id: "c2", title: "Tidy tests" }),
	];
	const box = (view: ConversationsView) =>
		view.getByRole("textbox", {
			name: "Message input",
		});
	const type = (view: ConversationsView, text: string) =>
		typeIn(box(view), text);
	// A turn the agent is still working on, with a note queued for its end.
	const queuedAt = new Date(Date.now() - 30_000).toISOString();
	const working = conversation({
		id: "c1",
		title: "Fix login",
		status: "running",
		taking: "queue",
		messages: [
			message("user", "go"),
			message("agent", "On it."),
			{ ...message("user", "the second note"), queued: true, at: queuedAt },
		],
	});

	it("opens a conversation held for a queued task on the task it will be asked, queued, not an empty thread", async () => {
		const spot = {
			position: 1,
			of: 2,
			since: "2026-10-19T12:00:00.000Z",
			reason: "waits on #2",
		};
		const state = conversation({
			id: "c1",
			title: "#3 Fix the upload",
			// As one reads back after a restart, before the queue holds it again.
			status: "stopped",
			queued: 3,
			queue: spot,
			createdAt: new Date(Date.now() - 30_000).toISOString(),
		});
		const view = await testing.openConversations([state], "c1");
		const thread = view.getByRole("region", { name: "#3 Fix the upload" });

		expect(view.queryByText("How can I help you today?")).toBeNull();
		expect(
			within(thread).getByRole("note", { name: "splates" }).textContent,
		).toMatch(/Task\s*#\s*3/);
		expect(within(thread).getByText(/^Queued \d+s$/)).toBeTruthy();

		await testing.say({
			...state,
			status: "starting",
			messages: [{ ...message("user", "and the logout"), queued: true }],
		});
		await waitFor(() =>
			expect(within(thread).getByText("and the logout")).toBeTruthy(),
		);
		expect(
			within(thread).getByRole("note", { name: "splates" }).textContent,
		).toMatch(/Task\s*#\s*3/);
	});

	// scry-ignore simple-test-setup: The starting conversation and its timestamp belong only to this startup-queue test.
	it("pins startup-held messages in the thread above a shimmering Queued label until the first turn starts", async () => {
		const first = {
			...message("user", "Fix login"),
			at: new Date(Date.now() - 30_000).toISOString(),
		};
		const state = conversation({
			id: "c1",
			title: "Fix login",
			status: "starting",
			messages: [{ ...first, queued: true }],
		});
		const view = await testing.openConversations([state], "c1");
		const thread = view.getByRole("region", { name: "Fix login" });
		const user = within(thread)
			.getByText("Fix login")
			.closest('[data-slot="aui_user-message-root"]');
		expect(user?.hasAttribute("data-sticks")).toBe(true);
		const label = within(thread).getByText(/^Queued \d+s$/);
		const initial = label.textContent;
		await waitFor(() => expect(label.textContent).not.toBe(initial));
		expect(label.className).toContain("shimmer");
		expect(label.className).toContain("motion-reduce:animate-none");
		expect(label.getAttribute("role")).toBe("status");
		const row = label.closest('[data-slot="queued"]');
		expect(row?.querySelector(".lucide-hourglass")).toBeTruthy();
		expect(within(thread).queryByText(/^Working/)).toBeNull();

		await testing.say({
			...state,
			status: "running",
			messages: [
				{
					...first,
					sentAt: new Date(Date.parse(first.at) + 20_000).toISOString(),
				},
			],
		});

		await waitFor(() =>
			expect(within(thread).getByText("Queued for 20s")).toBeTruthy(),
		);
		expect(
			view.queryByText(/Waiting for agent to start\. Your messages/),
		).toBeNull();
		expect(
			view.queryByRole("status", { name: "waiting for agent to start" }),
		).toBeNull();
		expect(view.getByRole("status", { name: "working" })).toBeTruthy();
		expect(within(thread).getByText("Queued for 20s").className).not.toContain(
			"shimmer",
		);
		expect(row?.querySelector(".lucide-hourglass")).toBeNull();
		expect(row?.querySelector(".lucide-check")).toBeTruthy();
		expect(within(thread).getByText(/^Working/)).toBeTruthy();
		expect(
			within(thread)
				.getByText("Fix login")
				.closest('[data-slot="aui_user-message-root"]'),
		).toBe(user);
		await testing.say({
			...state,
			status: "idle",
			messages: [
				{
					...first,
					sentAt: new Date(Date.parse(first.at) + 20_000).toISOString(),
				},
				message("agent", "Finished."),
			],
		});
		expect(within(thread).getByText("Queued for 20s")).toBeTruthy();
		expect(within(thread).queryByText(/^Working/)).toBeNull();
	});

	it("sends while the agent works, offering Send over Stop once something is typed", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Fix login", status: "running" })],
			"c1",
		);
		expect(view.getByRole("button", { name: "Stop generating" })).toBeTruthy();

		await type(view, "use the second note");

		expect(view.queryByRole("button", { name: "Stop generating" })).toBeNull();
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
							...message("user", "[SPLATES TASK alpha]\n\nthen stop"),
							queued: true,
						},
					],
				}),
			],
			"c1",
		);

		const queued = view.getByRole("region", { name: "queued messages" });
		expect(within(queued).getByTitle("[SPLATES TASK alpha]").textContent).toBe(
			"Taskalpha",
		);
		expect(within(queued).getByText("then stop")).toBeTruthy();
	});

	// scry-ignore simple-test-setup: each test opens the conversation its case needs
	it("shows a directive mid-way through a queued message as a chip where it stands", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					title: "Fix login",
					status: "running",
					messages: [
						message("user", "go"),
						{ ...message("user", "then [SPLATES LANE 2] next"), queued: true },
					],
				}),
			],
			"c1",
		);

		const queued = view.getByRole("region", { name: "queued messages" });
		const chip = within(queued).getByTitle("[SPLATES LANE 2]");
		expect(chip.textContent).toBe("Lane 2");
		expect(chip.parentElement?.textContent).toBe("then Lane 2 next");
	});

	it("names a queued directive about no todo, lane or task by its label", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					title: "Fix login",
					status: "running",
					messages: [
						message("user", "go"),
						{ ...message("user", "[SPLATES CHECKPOINT]"), queued: true },
					],
				}),
			],
			"c1",
		);

		const queued = view.getByRole("region", { name: "queued messages" });
		expect(within(queued).getByTitle("[SPLATES CHECKPOINT]").textContent).toBe(
			"Checkpoint",
		);
	});

	it("holds a queued message above the composer to send now, interrupting the turn", async () => {
		const view = await testing.openConversations([working], "c1");
		const queued = view.getByRole("region", { name: "queued messages" });

		expect(
			within(queued)
				.getAllByRole("listitem")
				.map((each) => each.textContent),
		).toEqual(["the second note"]);
		expect(view.getAllByText(/the second note/)).toHaveLength(1);
		await act(async () =>
			fireEvent.click(within(queued).getByRole("button", { name: /Send now/ })),
		);
		expect(testing.posted("/api/conversations/c1/send-now")).toHaveLength(1);

		await act(async () => fireEvent.keyDown(box(view), { key: "Enter" }));
		expect(testing.posted("/api/conversations/c1/send-now")).toHaveLength(2);
		await type(view, "more");
		await act(async () => fireEvent.keyDown(box(view), { key: "Enter" }));
		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "more" } },
			]),
		);
		expect(testing.posted("/api/conversations/c1/send-now")).toHaveLength(2);
		await waitFor(() => expect(textIn(box(view))).toBe(""));
		await act(async () => fireEvent.keyDown(box(view), { key: "Enter" }));
		expect(testing.posted("/api/conversations/c1/send-now")).toHaveLength(3);
	});

	it("shows a message sent mid-turn in the pending row, apart from the queue, without sending the queue", async () => {
		const view = await testing.openConversations([working], "c1");
		await type(view, "more");
		await act(async () => fireEvent.keyDown(box(view), { key: "Enter" }));
		await waitFor(() => expect(textIn(box(view))).toBe(""));

		const queued = view.getByRole("region", { name: "queued messages" });
		expect(
			within(queued)
				.getAllByRole("listitem")
				.map((each) => each.textContent),
		).toEqual([expect.stringContaining("the second note")]);
		const pending = view.getByRole("list", { name: "messages sending" });
		expect(within(pending).getByText("more")).toBeTruthy();
		expect(testing.posted("/api/conversations/c1/send-now")).toEqual([]);
	});

	it("holds a queued message out of the composer with Edit until the server takes it back, leaving the composer when refused", async () => {
		const view = await testing.openConversations([working], "c1");
		await type(view, "still typing");
		testing.holdWrites();
		testing.refuseWrites = { reason: "not_found", message: "already sent" };
		const queued = view.getByRole("region", { name: "queued messages" });

		await act(async () =>
			fireEvent.click(within(queued).getByRole("button", { name: /Edit/ })),
		);

		expect(textIn(box(view))).toBe("still typing");
		await act(async () => testing.release());
		await waitFor(() => expect(textIn(box(view))).toBe("still typing"));
		expect(view.getByText("Not taken back: already sent")).toBeTruthy();
	});

	it("throws a queued message away with Trash, leaving the composer as it was", async () => {
		const view = await testing.openConversations([working], "c1");
		await type(view, "still typing");
		const queued = view.getByRole("region", { name: "queued messages" });
		testing.reply = { text: "the second note", files: [] };

		await act(async () =>
			fireEvent.click(
				within(queued).getByRole("button", {
					name: "Discard the second note",
				}),
			),
		);

		expect(testing.posted("/api/conversations/c1/unqueue")).toEqual([
			{ method: "POST", body: { index: 0 } },
		]);
		expect(textIn(box(view))).toBe("still typing");
	});

	it("keeps a stopped conversation's queued message in the thread with its Send action", async () => {
		const view = await testing.openConversations(
			[{ ...working, status: "stopped" }],
			"c1",
		);
		const thread = view.getByRole("region", { name: "Fix login" });

		expect(view.queryByRole("region", { name: "queued messages" })).toBeNull();
		expect(within(thread).getByText("the second note")).toBeTruthy();
		await act(async () =>
			fireEvent.click(within(thread).getByRole("button", { name: "Send" })),
		);
		expect(testing.posted("/api/conversations/c1/send-now")).toHaveLength(1);
	});

	it("takes the last queued message back into the composer with Up once the server has it", async () => {
		const view = await testing.openConversations([working], "c1");
		await type(view, "more");
		await act(async () => fireEvent.keyDown(box(view), { key: "Enter" }));
		await waitFor(() => expect(textIn(box(view))).toBe(""));

		// Still on its way, there is nothing to take back yet.
		await act(async () => fireEvent.keyDown(box(view), { key: "ArrowUp" }));
		expect(testing.posted("/api/conversations/c1/unqueue")).toEqual([]);
		await testing.say({
			...working,
			messages: [
				...working.messages,
				{
					...message("user", "more"),
					queued: true,
					at: queuedAt,
					id: testing.sentId("c1", "more"),
				},
			],
		});
		testing.reply = { text: "more", files: [] };
		await act(async () => fireEvent.keyDown(box(view), { key: "ArrowUp" }));

		expect(testing.posted("/api/conversations/c1/unqueue")).toEqual([
			{ method: "POST", body: { index: 1 } },
		]);
		await waitFor(() => expect(textIn(box(view))).toBe("more"));
	});

	it("holds a queued message out of the composer with Up until the server takes it back, leaving the composer when refused", async () => {
		const view = await testing.openConversations([working], "c1");
		testing.holdWrites();
		testing.refuseWrites = { reason: "not_found", message: "already sent" };

		await act(async () => fireEvent.keyDown(box(view), { key: "ArrowUp" }));

		expect(textIn(box(view))).toBe("");
		await act(async () => testing.release());
		await waitFor(() =>
			expect(view.getByText("Not taken back: already sent")).toBeTruthy(),
		);
		expect(textIn(box(view))).toBe("");
		expect(view.getByText("Not taken back: already sent")).toBeTruthy();
	});
});
