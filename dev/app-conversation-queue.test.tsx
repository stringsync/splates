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
		await waitFor(() => expect(label.textContent).not.toBe(initial), {
			timeout: 2500,
		});
		expect(label.className).toContain("shimmer");
		expect(label.className).toContain("motion-reduce:animate-none");
		expect(label.getAttribute("role")).toBe("status");
		expect(view.queryByRole("region", { name: "queued messages" })).toBeNull();
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
			expect(
				view.queryByRole("region", { name: "queued messages" }),
			).toBeNull(),
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
						{ ...message("user", "then [ARBOR LANE 2] next"), queued: true },
					],
				}),
			],
			"c1",
		);

		const queued = view.getByRole("region", { name: "queued messages" });
		const chip = within(queued).getByTitle("[ARBOR LANE 2]");
		expect(chip.textContent).toBe("Lane 2");
		expect(chip.parentElement?.textContent).toBe("then Lane 2 next");
	});

	it("names a queued directive about no todo, lane or task by its label", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					status: "running",
					messages: [
						message("user", "go"),
						{ ...message("user", "[ARBOR UPDATE]"), queued: true },
					],
				}),
			],
			"c1",
		);

		const queued = view.getByRole("region", { name: "queued messages" });
		expect(within(queued).getByTitle("[ARBOR UPDATE]").textContent).toBe(
			"Check in",
		);
	});

	it("holds a queued message above the composer, out of the thread, to send now or take back with Up", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					title: "Fix login",
					status: "running",
					taking: "queue",
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
			fireEvent.click(within(queued).getByRole("button", { name: /Send now/ })),
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
		// Up waits for the server to have the last one, to take it back.
		await act(async () => fireEvent.keyDown(box(view), { key: "ArrowUp" }));
		expect(testing.posted("/api/conversations/c1/unqueue")).toEqual([]);
		await testing.say(
			conversation({
				id: "c1",
				title: "Fix login",
				status: "running",
				messages: [
					message("user", "go"),
					message("agent", { type: "text", text: "On it." }),
					{ ...message("user", "the second note"), queued: true },
					{
						...message("user", "more"),
						queued: true,
						id: testing.sentId("c1", "more"),
					},
				],
			}),
		);
		testing.reply = { text: "more", files: [] };
		await act(async () => fireEvent.keyDown(box(view), { key: "ArrowUp" }));
		expect(testing.posted("/api/conversations/c1/unqueue")).toEqual([
			{ method: "POST", body: { index: 1 } },
		]);
		await waitFor(() => expect(textIn(box(view))).toBe("more"));
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
		testing.reply = { text: "the second note", files: [] };
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
});
