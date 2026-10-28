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

		const thread = view.getByRole("region", { name: "Fix login" });
		expect(within(thread).getByTitle("[SPLATES TASK alpha]").textContent).toBe(
			"Taskalpha",
		);
		expect(within(thread).getByText("then stop")).toBeTruthy();
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

		const thread = view.getByRole("region", { name: "Fix login" });
		const chip = within(thread).getByTitle("[SPLATES LANE 2]");
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

		const thread = view.getByRole("region", { name: "Fix login" });
		expect(within(thread).getByTitle("[SPLATES CHECKPOINT]").textContent).toBe(
			"Checkpoint",
		);
	});

	it("shows a queued message in the thread after the turn it waits on, under a Queued row, with Working under the running turn", async () => {
		const view = await testing.openConversations([working], "c1");
		const thread = view.getByRole("region", { name: "Fix login" });

		expect(
			[...thread.querySelectorAll('[data-role="user"]')].map(
				(each) => each.textContent,
			),
		).toEqual([
			expect.stringContaining("go"),
			expect.stringContaining("the second note"),
		]);
		expect(view.getAllByText(/the second note/)).toHaveLength(1);
		const reply = (text: string | RegExp) =>
			within(thread)
				.getByText(text)
				.closest('[data-slot="aui_assistant-message-root"]');
		expect(within(thread).getAllByText(/^Queued \d+s$/)).toHaveLength(1);
		expect(within(thread).getAllByText("Working")).toHaveLength(1);
		expect(reply("Working")).toBe(reply("On it."));
	});

	it("keeps interruption in the composer without sending or dropping a queued follow-up", async () => {
		const view = await testing.openConversations([working], "c1");
		const thread = view.getByRole("region", { name: "Fix login" });

		expect(
			within(thread).queryByRole("button", { name: "Interrupt" }),
		).toBeNull();
		await act(async () =>
			fireEvent.click(
				within(thread).getByRole("button", { name: "Stop generating" }),
			),
		);

		expect(testing.posted("/api/conversations/c1/cancel")).toEqual([
			{ method: "POST", body: {} },
		]);
		expect(testing.posted("/api/conversations/c1/send-now")).toEqual([]);
		expect(within(thread).getByText("the second note")).toBeTruthy();
	});

	it("shows a message sent mid-turn under the same Queued row at once, and sends nothing now on Enter with nothing typed", async () => {
		const view = await testing.openConversations([working], "c1");
		const thread = view.getByRole("region", { name: "Fix login" });

		await type(view, "more");
		await act(async () => fireEvent.keyDown(box(view), { key: "Enter" }));
		await waitFor(() => expect(textIn(box(view))).toBe(""));
		await act(async () => fireEvent.keyDown(box(view), { key: "Enter" }));

		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{ method: "POST", body: { text: "more" } },
		]);
		expect(testing.posted("/api/conversations/c1/send-now")).toEqual([]);
		expect(
			[...thread.querySelectorAll('[data-role="user"]')].map(
				(each) => each.textContent,
			),
		).toEqual([
			expect.stringContaining("go"),
			expect.stringContaining("the second note"),
			expect.stringContaining("more"),
		]);
		expect(within(thread).getAllByText(/^Queued \d+s$/)).toHaveLength(1);
		expect(within(thread).getAllByText("Working")).toHaveLength(1);
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

	it("takes a queued message back into the composer at once with Up, emptying it again when refused", async () => {
		const view = await testing.openConversations([working], "c1");
		testing.holdWrites();
		testing.refuseWrites = { reason: "not_found", message: "already sent" };

		await act(async () => fireEvent.keyDown(box(view), { key: "ArrowUp" }));

		expect(textIn(box(view))).toBe("the second note");
		await act(async () => testing.release());
		await waitFor(() => expect(textIn(box(view))).toBe(""));
		expect(view.getByText("Not taken back: already sent")).toBeTruthy();
	});
});
