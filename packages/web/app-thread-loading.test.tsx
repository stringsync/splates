import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { ConversationState } from "@splates/server/conversations";
import { listed } from "@splates/server/conversations/browser";
import { Duration } from "core/time";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	openRow,
	resize,
	Testing,
	tool,
	typeIn,
	waitFor,
	within,
} from "./testing";

describe("Opening complete conversation history", () => {
	let testing: Testing;
	let whole: ConversationState;
	let release: () => void;
	beforeEach(() => {
		testing = new Testing();
		whole = conversation({
			title: "History",
			messages: [
				message("user", "Read the file"),
				message("agent", tool(), "Finished reading"),
			],
		});
		testing.wholes.c1 = whole;
		release = testing.holdHistory("c1");
	});
	afterEach(() => {
		cleanup();
		testing.dispose();
		resize(1024, 768);
	});

	async function fireHistoryLoadingDelay(): Promise<void> {
		const index = testing.timer.timeouts.findIndex(
			(each) => !each.disposed && each.delay.ms === Duration.secs(1).ms,
		);
		expect(index).toBeGreaterThanOrEqual(0);
		await act(async () => testing.timer.fireTimeout(index));
	}

	it.each([1024, 390])(
		"reveals text and work together at width %s without replacing the draft",
		async (width) => {
			resize(width, 844);
			const view = await testing.openConversations([listed(whole)]);
			const thread = within(view.getByRole("region", { name: "History" }));
			expect(thread.queryByText("Loading conversation")).toBeNull();
			await fireHistoryLoadingDelay();
			expect(thread.getByText("Loading conversation")).toBeTruthy();
			expect(thread.queryByText("Finished reading")).toBeNull();
			expect(thread.queryByText("How can I help you today?")).toBeNull();
			const box = thread.getByRole("textbox", { name: "Message input" });
			await typeIn(box, "Keep my draft");
			await act(async () => release());
			await waitFor(() =>
				expect(thread.getByText("Finished reading")).toBeTruthy(),
			);
			expect(thread.getByText("Worked")).toBeTruthy();
			expect(thread.queryByText("Loading conversation")).toBeNull();
			expect(thread.getByRole("textbox", { name: "Message input" })).toBe(box);
			expect(box.textContent).toBe("Keep my draft");
			expect(
				testing.asked.filter((path) => path === "/api/conversations/c1"),
			).toHaveLength(1);
		},
	);

	it("shows the task chain only after the conversation loads", async () => {
		testing.agentChain = {
			name: "Parent task",
			root: { conversation: "parent", title: "Parent task" },
			spent: 0,
			budget: 5000,
			stopped: false,
			nodes: [
				{
					id: 1,
					title: "History",
					status: "running",
					parent: null,
					conversation: "c1",
					tokens: 0,
				},
			],
		};
		const view = await testing.openConversations([listed(whole)]);
		const thread = within(view.getByRole("region", { name: "History" }));
		expect(thread.queryByText("Loading conversation")).toBeNull();
		await fireHistoryLoadingDelay();
		expect(thread.getByText("Loading conversation")).toBeTruthy();
		expect(thread.queryByRole("status", { name: "task chain" })).toBeNull();
		await act(async () => release());
		const banner = await thread.findByRole("status", { name: "task chain" });
		expect(banner.textContent).toContain("Queued by Parent task");
		expect(thread.getByText("Finished reading")).toBeTruthy();
	});

	it("keeps the curtain up while an initial report card is still loading", async () => {
		const outcome = Promise.withResolvers<void>();
		testing.readingOutcomes = outcome.promise;
		whole = {
			...whole,
			messages: [
				...whole.messages,
				message(
					"agent",
					"## ✅ Merged header onto main\n\nThe header wraps now.",
				),
			],
		};
		testing.wholes.c1 = whole;
		const view = await testing.openConversations([listed(whole)]);
		const thread = within(view.getByRole("region", { name: "History" }));
		await act(async () => release());
		try {
			await waitFor(() =>
				expect(testing.asked).toContain("/api/tasks/header/outcome"),
			);
			// Firing every scheduled timeout must keep the curtain up while report cards load.
			await act(async () => testing.timer.fireTimeouts());
			expect(thread.getByText("Loading conversation")).toBeTruthy();
			expect(thread.queryByText("Finished reading")).toBeNull();
		} finally {
			await act(async () => outcome.resolve());
		}
		expect(thread.getByText("Finished reading")).toBeTruthy();
		expect(thread.getByRole("region", { name: "merged header" })).toBeTruthy();
		expect(thread.queryByText("Loading conversation")).toBeNull();
	});

	it("reveals a failed report lookup with the transcript and its original text", async () => {
		whole = {
			...whole,
			messages: [
				message(
					"agent",
					"## 🧹 Removed footer: already fixed\n\nThe footer stays put.",
				),
			],
		};
		testing.wholes.c1 = whole;
		testing.landed.footer = 503;
		const view = await testing.openConversations([listed(whole)]);
		await act(async () => release());
		const card = await view.findByRole("region", { name: "removed footer" });
		expect(card.textContent).toContain("The footer stays put.");
		expect(view.queryByText("Loading conversation")).toBeNull();
		expect(
			testing.asked.filter(
				(path) => path === "/api/tasks/footer/outcome?ended=removed",
			),
		).toHaveLength(1);
	});

	it.each([503, 404])(
		"offers a retry after history returns %s and distinguishes empty history",
		async (status) => {
			release();
			testing.wholes.c1 = status;
			const view = await testing.openConversations([listed(whole)]);
			await waitFor(() =>
				expect(
					view.getByRole("button", { name: "Retry history" }),
				).toBeTruthy(),
			);
			expect(view.getByRole("alert").textContent).toContain(
				status === 404 ? "no longer available" : "Couldn't load",
			);
			expect(view.queryByText("How can I help you today?")).toBeNull();
			testing.wholes.c1 = { ...whole, messages: [] };
			await act(async () =>
				fireEvent.click(view.getByRole("button", { name: "Retry history" })),
			);
			await waitFor(() =>
				expect(view.getByText("How can I help you today?")).toBeTruthy(),
			);
			expect(view.queryByRole("button", { name: "Retry history" })).toBeNull();
		},
	);

	it("allows retrying a stalled read", async () => {
		testing.answerWithin(Duration.ms(30));
		const view = await testing.openConversations([listed(whole)]);
		await waitFor(() =>
			expect(view.getByRole("button", { name: "Retry history" })).toBeTruthy(),
		);
		release();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Retry history" })),
		);
		await waitFor(() =>
			expect(view.getByText("Finished reading")).toBeTruthy(),
		);
	});

	// vet-ignore simple-test-setup: the newer listing and full starting state are specific to this reconnect scenario
	it("keeps a loaded thread through a changed reconnect listing and live updates", async () => {
		const newer = {
			...whole,
			messages: [
				...whole.messages,
				message("user", "New question"),
				message("agent", "New answer"),
			],
		};
		testing.wholes.c1 = newer;
		const view = await testing.openConversations([whole]);
		const box = view.getByRole("textbox", { name: "Message input" });
		await typeIn(box, "Draft during reconnect");
		testing.talk = { agents: [], conversations: [listed(newer)] };
		await act(async () => testing.talkStream?.onopen?.());
		await waitFor(() =>
			expect(testing.asked).toContain("/api/conversations/c1"),
		);
		expect(view.getByText("Finished reading")).toBeTruthy();
		expect(view.queryByText("Loading conversation")).toBeNull();
		expect(view.queryByText("New answer")).toBeNull();
		await testing.say({
			...newer,
			messages: [...newer.messages, message("agent", "Latest live update")],
		});
		await act(async () => release());
		expect(view.getByText("Latest live update")).toBeTruthy();
		expect(view.getByRole("textbox", { name: "Message input" })).toBe(box);
		expect(box.textContent).toBe("Draft during reconnect");
	});

	it("does not reveal a late response after navigating to another conversation", async () => {
		const first = conversation({
			title: "First",
			messages: [message("agent", "Late first answer")],
		});
		const second = conversation({
			id: "c2",
			title: "Second",
			messages: [message("agent", "Second answer")],
		});
		testing.wholes.c1 = first;
		const view = await testing.openConversations([listed(first), second]);
		await openRow(view, "Second");
		await act(async () => release());
		const thread = within(view.getByRole("region", { name: "Second" }));
		expect(thread.getByText("Second answer")).toBeTruthy();
		expect(view.queryByText("Late first answer")).toBeNull();
		await openRow(view, "First");
		expect(view.getByText("Late first answer")).toBeTruthy();
		expect(view.queryByText("Loading conversation")).toBeNull();
	});

	it("waits for complete history before focusing a waiting question opened by the shortcut", async () => {
		whole = conversation({
			title: "Needs an answer",
			messages: [
				message("user", "Choose a color"),
				message("agent", "1. Which color?\n   - (a) Blue\n   - (b) Green"),
			],
		});
		testing.wholes.c1 = whole;
		const view = await testing.openConversations([listed(whole)], null);
		await act(async () =>
			fireEvent.keyDown(document.body, {
				altKey: true,
				metaKey: true,
				code: "KeyM",
			}),
		);
		expect(view.queryByText("Loading conversation")).toBeNull();
		expect(view.queryByRole("listitem", { name: "question 1" })).toBeNull();
		await act(async () => release());
		const card = await waitFor(() =>
			view.getByRole("listitem", { name: "question 1" }),
		);
		await waitFor(() =>
			expect(card.contains(document.activeElement)).toBe(true),
		);
	});

	it("reveals earlier turns and scrolls to the origin enqueue bar when clicking Queued by", async () => {
		const turns = Array.from({ length: 24 }, (_, index) => {
			const at = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
			const replyAt = new Date(
				Date.UTC(2026, 0, 1, 0, index, 30),
			).toISOString();
			return [
				{ ...message("user", `Turn ${index + 1}`), at },
				{ ...message("agent", `Reply ${index + 1}`), at: replyAt },
			];
		}).flat();
		const origin = conversation({
			id: "origin",
			title: "Origin conversation",
			messages: turns,
			events: [
				{
					id: "ev-q1",
					at: new Date(Date.UTC(2026, 0, 1, 0, 0, 45)).toISOString(),
					action: "queue add",
					reason: null,
					task: null,
					conversation: "origin",
					tasks: [{ id: 1, subject: "Follow-up eval" }],
				},
			],
		});
		testing.wholes.origin = origin;
		testing.agentChain = {
			name: "Origin conversation",
			root: { conversation: "origin", title: "Origin conversation" },
			spent: 0,
			budget: 5000,
			stopped: false,
			nodes: [
				{
					id: 1,
					title: "Follow-up eval",
					status: "running",
					parent: null,
					conversation: "c1",
					tokens: 0,
				},
			],
		};
		const scrolled: Element[] = [];
		// vet-ignore fakes-over-mocks: happy-dom lays nothing out, so where the bar scrolls has to be spied
		const scrollSpy = spyOn(
			HTMLElement.prototype,
			"scrollIntoView",
		).mockImplementation(function (this: HTMLElement) {
			scrolled.push(this);
		});
		try {
			const view = await testing.openConversations([
				listed(whole),
				listed(origin),
			]);
			await act(async () => release());
			const childThread = within(view.getByRole("region", { name: "History" }));
			const banner = await childThread.findByText(
				/Queued by Origin conversation/,
			);
			fireEvent.click(banner);
			const chainDialog = await view.findByRole("dialog");
			fireEvent.click(within(chainDialog).getByText("Origin conversation"));
			const originThread = within(
				await view.findByRole("region", { name: "Origin conversation" }),
			);
			const bar = await originThread.findByRole("status", {
				name: "queued tasks",
			});
			expect(bar.textContent).toContain("Queued #1");
			expect(originThread.getByText("Turn 1")).toBeTruthy();
			await waitFor(() => expect(scrolled).toContain(bar));
		} finally {
			scrollSpy.mockRestore();
		}
	});
});
