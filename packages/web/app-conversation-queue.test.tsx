import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Duration } from "core/time";
import { setHeldAfterMs } from "./sending";
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
		setHeldAfterMs(0);
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		setHeldAfterMs(5000);
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
			heldForTask: 3,
			queue: spot,
			createdAt: new Date(Date.now() - 30_000).toISOString(),
		});
		const view = await testing.openConversations([state], "c1");
		const thread = view.getByRole("region", { name: "#3 Fix the upload" });

		expect(view.queryByText("How can I help you today?")).toBeNull();
		expect(
			within(thread).getByRole("note", { name: "splates" }).textContent,
		).toMatch(/Task\s*#\s*3/);
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

	it("looks sent in the thread, not held above the composer, until it has waited past the delay", async () => {
		setHeldAfterMs(400);
		const state = conversation({
			id: "c1",
			title: "Fix login",
			status: "starting",
			messages: [
				{
					...message("user", "later note"),
					queued: true,
					at: new Date(testing.wall.now()).toISOString(),
				},
			],
		});
		const view = await testing.openConversations([state], "c1");
		expect(view.queryByRole("list", { name: "messages sending" })).toBeNull();
		expect(view.getByText("later note")).toBeTruthy();
		await act(async () => {
			testing.wall.advance(Duration.ms(400));
			testing.timer.fireTimeout(
				testing.timer.timeouts.findIndex(
					(each) => !each.disposed && each.delay.ms === 400,
				),
			);
		});
		const row = view.getByRole("list", { name: "messages sending" });
		expect(within(row).getByText("later note")).toBeTruthy();
		expect(view.getAllByText("later note")).toHaveLength(1);
	});

	it("lists a prompt waiting on a starting agent above the composer, to edit or discard but not send now", async () => {
		const state = conversation({
			id: "c1",
			title: "Fix login",
			status: "starting",
			messages: [
				{
					...message("user", "Fix login"),
					at: new Date(Date.now() - 30_000).toISOString(),
					queued: true,
				},
			],
		});
		const view = await testing.openConversations([state], "c1");
		const queued = await view.findByRole("list", {
			name: "messages sending",
		});
		expect(within(queued).getByText("Fix login")).toBeTruthy();
		expect(within(queued).getByRole("button", { name: /Edit/ })).toBeTruthy();
		expect(
			within(queued).getByRole("button", { name: /Discard/ }),
		).toBeTruthy();
		expect(
			within(queued).queryByRole("button", { name: /Send now/ }),
		).toBeNull();
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

		const queued = await view.findByRole("list", {
			name: "messages sending",
		});
		expect(within(queued).getByTitle("[SPLATES TASK alpha]").textContent).toBe(
			"Taskalpha",
		);
		expect(within(queued).getByText("then stop")).toBeTruthy();
	});

	// vet-ignore simple-test-setup: each test opens the conversation its case needs
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

		const queued = await view.findByRole("list", {
			name: "messages sending",
		});
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

		const queued = await view.findByRole("list", {
			name: "messages sending",
		});
		expect(within(queued).getByTitle("[SPLATES CHECKPOINT]").textContent).toBe(
			"Checkpoint",
		);
	});

	it("holds a queued message above the composer to send now, interrupting the turn", async () => {
		const view = await testing.openConversations([working], "c1");
		const queued = await view.findByRole("list", {
			name: "messages sending",
		});

		expect(
			within(queued)
				.getAllByRole("listitem")
				.map((each) => each.textContent),
		).toEqual([expect.stringContaining("the second note")]);
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

	it("shows a message sent mid-turn in the same row as the queue, without sending the queue", async () => {
		const view = await testing.openConversations([working], "c1");
		await type(view, "more");
		await act(async () => fireEvent.keyDown(box(view), { key: "Enter" }));
		await waitFor(() => expect(textIn(box(view))).toBe(""));

		const queued = await view.findByRole("list", {
			name: "messages sending",
		});
		expect(
			within(queued)
				.getAllByRole("listitem")
				.map((each) => each.textContent),
		).toEqual([
			expect.stringContaining("more"),
			expect.stringContaining("the second note"),
		]);
		expect(testing.posted("/api/conversations/c1/send-now")).toEqual([]);
	});

	it("holds a queued message out of the composer with Edit until the server takes it back, leaving the composer when refused", async () => {
		const view = await testing.openConversations([working], "c1");
		await type(view, "still typing");
		testing.holdWrites();
		testing.refuseWrites = { reason: "not_found", message: "already sent" };
		const queued = await view.findByRole("list", {
			name: "messages sending",
		});

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
		const queued = await view.findByRole("list", {
			name: "messages sending",
		});
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

	it("lists a stopped conversation's queued message above the composer to edit or discard, with Send now", async () => {
		const view = await testing.openConversations(
			[{ ...working, status: "stopped" }],
			"c1",
		);
		const queued = await view.findByRole("list", {
			name: "messages sending",
		});

		expect(within(queued).getByText("the second note")).toBeTruthy();
		expect(within(queued).getByRole("button", { name: /Edit/ })).toBeTruthy();
		await act(async () =>
			fireEvent.click(within(queued).getByRole("button", { name: /Send now/ })),
		);
		expect(testing.posted("/api/conversations/c1/send-now")).toHaveLength(1);

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
