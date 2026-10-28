import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { SERVER_TOLD } from "@stringsync/splates-server/conversations/browser";
import {
	conflictWarning,
	earlyWarning,
} from "@stringsync/splates-server/server/browser";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	tool,
	waitFor,
	within,
} from "./testing";

describe("App's conversation thread", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
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

	it("stamps each message with how long ago it was said once the actions turn timestamps on, and a settled reply with when it ended", async () => {
		const minutes = (ago: number) =>
			new Date(Date.now() - ago * 60_000).toISOString();
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					title: "Read the note",
					messages: [
						{ ...message("user", "what does it say?"), at: minutes(9) },
						{
							...message("agent", "It says hi."),
							at: minutes(8),
							until: minutes(4),
						},
					],
				}),
			],
			"c1",
		);
		const thread = view.getByRole("region", { name: "Read the note" });
		const stamps = () =>
			[...thread.querySelectorAll("time")].map((each) => each.textContent);
		await waitFor(() =>
			expect(thread.textContent).toContain("what does it say?"),
		);
		expect(stamps()).toEqual([]);

		const actions = view.getByRole("navigation", { name: "actions" });
		await act(async () =>
			fireEvent.click(
				within(actions).getByRole("button", { name: "Show timestamps" }),
			),
		);

		await waitFor(() => expect(stamps()).toEqual(["9m ago", "4m ago"]));
		await act(async () =>
			fireEvent.click(
				within(actions).getByRole("button", { name: "Hide timestamps" }),
			),
		);
		expect(stamps()).toEqual([]);
	});

	it("labels a message another conversation told with a link back to it", async () => {
		const view = await testing.openConversations(
			[
				conversation({ id: "orch", title: "Orchestrate" }),
				conversation({
					id: "c1",
					title: "Read the note",
					messages: [
						{ ...message("user", "merge it"), told: "orch" },
						{ ...message("user", "thanks") },
					],
				}),
			],
			"c1",
		);
		const thread = view.getByRole("region", { name: "Read the note" });

		await waitFor(() => expect(thread.textContent).toContain("merge it"));

		const labels = thread.querySelectorAll("[data-slot=aui_user-message-told]");
		expect(labels).toHaveLength(1);
		expect(labels[0]?.textContent).toBe("from Orchestrate");
		expect(labels[0]?.querySelector("a")?.getAttribute("href")).toBe(
			"#conversations/orch",
		);
	});

	it("draws splates server's early warning as an event line, not a message", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					title: "Read the note",
					messages: [
						{
							...message(
								"user",
								earlyWarning("c1-task", conflictWarning("main", ["state.ts"])),
							),
							told: SERVER_TOLD,
						},
					],
				}),
			],
			"c1",
		);
		const thread = view.getByRole("region", { name: "Read the note" });

		const line = await waitFor(() =>
			within(thread).getByRole("note", { name: "splates" }),
		);
		expect(line.textContent).toContain("Conflict with");
		expect(within(line).getByLabelText("Conflict")).toBeDefined();
		expect(within(line).getByTitle("Branch main")).toBeDefined();
		expect(within(line).getByTitle("state.ts")).toBeDefined();
		expect(thread.textContent).not.toContain("Splates early warning");
		expect(
			thread.querySelector("[data-slot=aui_user-message-told]"),
		).toBeNull();
	});

	it("draws an unrecognized server prompt and a handoff as event lines", async () => {
		const serverText = "A server prompt the page does not know yet.";
		const handoff =
			"[SPLATES TASK c1-task]\n\nThe agent before you on this task stopped without handing it over, so its SPLATES.md may be behind. What it said and did last is in /tmp/transcript.md: read its end before going on.";
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					title: "Read the note",
					messages: [
						{ ...message("user", serverText), told: SERVER_TOLD },
						message("user", handoff),
					],
				}),
			],
			"c1",
		);
		const thread = view.getByRole("region", { name: "Read the note" });

		await waitFor(() =>
			expect(
				within(thread).getAllByRole("note", { name: "splates" }),
			).toHaveLength(2),
		);
		expect(thread.textContent).toContain(`Told agent: ${serverText}`);
		expect(thread.textContent).toContain("Handoff");
		expect(thread.textContent).toContain("c1-task");
		expect(thread.textContent).not.toContain("The agent before you");
		expect(within(thread).getByTitle(serverText)).toBeDefined();
		const notes = within(thread).getAllByRole("note", { name: "splates" });
		expect(
			notes.some(
				(note) => note.querySelector("p")?.getAttribute("title") === handoff,
			),
		).toBe(true);
	});

	it("leaves a reply unstamped while it is still being written", async () => {
		localStorage.setItem(
			"splates.settings",
			JSON.stringify({ "conversation.timestamps": true }),
		);
		const view = await testing.openConversations([
			conversation({ title: "Read the note" }),
		]);

		await testing.say(
			conversation({
				title: "Read the note",
				status: "running",
				messages: [
					{
						...message("user", "what does it say?"),
						at: new Date().toISOString(),
					},
					{ ...message("agent", "It says"), at: new Date().toISOString() },
				],
			}),
		);

		const thread = view.getByRole("region", { name: "Read the note" });
		await waitFor(() =>
			expect(thread.textContent).toContain("what does it say?"),
		);
		expect(
			[...thread.querySelectorAll("time")].map((each) => each.textContent),
		).toEqual(["just now"]);
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
		expect(
			within(thread).getByText("Working").closest('[role="status"]'),
		).not.toBeNull();
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

	it("opens a menu to copy a message from when a finger holds it", async () => {
		const written: string[] = [];
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: async (text: string) => void written.push(text) },
		});
		const view = await testing.openConversations([
			conversation({ title: "Copy", messages: [message("user", "ok thanks")] }),
		]);
		const thread = view.getByRole("region", { name: "Copy" });
		const box = await waitFor(() => {
			const found = thread.querySelector(".aui-user-message-content");
			expect(found).not.toBeNull();
			return found as HTMLElement;
		});
		const hold = async (pointerType: string) => {
			fireEvent.pointerDown(box, { pointerType });
			await act(() => new Promise((done) => setTimeout(done, 600)));
			fireEvent.pointerUp(box, { pointerType });
		};

		// A mouse's press opens nothing.
		await hold("mouse");
		expect(view.queryByRole("menuitem", { name: "Copy" })).toBeNull();

		await hold("touch");
		fireEvent.click(await view.findByRole("menuitem", { name: "Copy" }));
		await waitFor(() => expect(written).toEqual(["ok thanks"]));
		await waitFor(() =>
			expect(view.queryByRole("menuitem", { name: "Copy" })).toBeNull(),
		);
	});

	it("keeps a message of a skill alone in the turn it comes in, unstuck, so it takes none of a turn's scroll", async () => {
		const view = await testing.openConversations([
			conversation({
				messages: [
					message("user", "fix the header"),
					message("agent", "Looking at it."),
					message("user", "/simplify"),
					message("agent", "Simplified it."),
					message("user", "/simplify and the footer"),
				],
			}),
		]);

		await waitFor(() => view.getByText("Simplified it."));
		const turns = [...document.querySelectorAll('[data-slot="aui_turn"]')];
		expect(turns.map((turn) => turn.firstElementChild?.textContent)).toEqual([
			expect.stringContaining("fix the header"),
			expect.stringContaining("/simplify and the footer"),
		]);
		const skill = view.getByText("/simplify").closest('[data-role="user"]');
		expect(skill?.closest('[data-slot="aui_turn"]')).toBe(turns[0]);
		expect(skill?.className).not.toContain("sticky");
	});

	it("scrolls the thread at once, even when asked to glide", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", title: "Fix login" }),
		]);
		const thread = view.container.ownerDocument.querySelector(
			'[data-slot="aui_thread-viewport"]',
		) as HTMLElement;

		thread.scrollTo({ top: 40, behavior: "smooth" });

		// A glide would land on a later tick.
		expect(thread.scrollTop).toBe(40);
	});

	it("follows the bottom as an open timeline of work still going on grows, until the person scrolls up", async () => {
		// Resizes the page has no layout to make, as the timeline grows.
		const watchers = new Set<() => void>();
		const real = globalThis.ResizeObserver;
		globalThis.ResizeObserver = class {
			private readonly fire: () => void;
			constructor(changed: ResizeObserverCallback) {
				this.fire = () => changed([], this as unknown as ResizeObserver);
			}
			observe() {
				watchers.add(this.fire);
			}
			unobserve() {}
			disconnect() {
				watchers.delete(this.fire);
			}
		} as unknown as typeof ResizeObserver;
		try {
			const view = await testing.openConversations([
				conversation({
					title: "Run tests",
					status: "running",
					messages: [
						message("user", "run the tests"),
						message(
							"agent",
							tool({ command: "bun test", status: "in_progress" }),
						),
					],
				}),
			]);
			const thread = document.querySelector(
				'[data-slot="aui_thread-viewport"]',
			) as HTMLElement;
			const work = await waitFor(() => {
				const found = thread.querySelector<HTMLDetailsElement>(
					'[data-slot="work"] details',
				);
				expect(found).not.toBeNull();
				return found as HTMLDetailsElement;
			});
			let height = 1000;
			Object.defineProperty(thread, "scrollHeight", { get: () => height });
			Object.defineProperty(thread, "clientHeight", { get: () => 500 });
			// Model the browser's clamping for both assistant-ui and work follow.
			let top = 0;
			Object.defineProperty(thread, "scrollTop", {
				get: () => top,
				set: (next: number) => {
					top = Math.max(0, Math.min(next, height - 500));
				},
			});
			const scroll = async (top: number) => {
				thread.scrollTop = top;
				await act(async () => fireEvent.scroll(thread));
			};
			const grow = async (by: number) => {
				height += by;
				await act(async () => {
					// scry-ignore matchers-over-test-logic: fires every resize watched, building no subject
					for (const fire of watchers) {
						fire();
					}
				});
			};
			await scroll(500);

			// Opened mid-turn, even folded work keeps the latest in view.
			await grow(100);
			expect(thread.scrollTop).toBe(600);

			await scroll(600);
			await act(async () => {
				work.open = true;
				fireEvent(work, new Event("toggle"));
			});
			await grow(200);
			expect(thread.scrollTop).toBe(800);

			await scroll(700);
			await grow(200);
			expect(thread.scrollTop).toBe(700);

			// Back at the bottom, it follows again.
			await scroll(1000);
			await grow(150);
			expect(thread.scrollTop).toBe(1150);
			expect(view.getByText(/Working/)).toBeTruthy();
		} finally {
			globalThis.ResizeObserver = real;
		}
	});

	it("shows why a conversation failed, and takes a prompt to resume it", async () => {
		const view = await testing.openConversations([
			conversation({ status: "failed", error: "Claude exited with code 1" }),
		]);

		expect(view.getByRole("alert").textContent).toBe(
			"The agent stopped. Send a message to start it again.Claude exited with code 1",
		);
		expect(
			view
				.getByRole("textbox", { name: "Message input" })
				.getAttribute("contenteditable"),
		).toBe("true");
	});

	it("says splates stopped an agent left idle, and what wakes it", async () => {
		const view = await testing.openConversations([
			conversation({
				status: "stopped",
				stoppedIdle: "2026-10-14T10:00:00.000Z",
			}),
		]);

		expect(
			view.container.ownerDocument.querySelector('[data-slot="idle-banner"]')
				?.textContent,
		).toBe(
			"Stopped after 30 minutes idle. Sending a message starts it again where it left off.",
		);
	});

	it("says where an agent waits to start, and moves it to the front", async () => {
		const since = new Date(Date.now() - 5 * 60_000).toISOString();
		const view = await testing.openConversations([
			conversation({
				status: "starting",
				queue: { position: 3, of: 4, since, reason: "paused" },
			}),
		]);

		const banner = view.container.ownerDocument.querySelector(
			'[data-slot="queue-banner"]',
		);
		expect(banner?.textContent).toContain(
			"Waiting to start, 3rd of 4 in line. The queue is paused, so what splates starts on its own waits. It has waited 5m, and starts once you resume it on the Queue page.",
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Start next" })),
		);
		const moved = testing.posts.find((post) => post.path.includes("/position"));
		expect(moved?.method).toBe("PUT");
		expect(JSON.parse(String(moved?.body))).toEqual({ position: 1 });
	});

	it("says a wait past a minute is longer than usual, with the Queue page to try", async () => {
		const since = new Date(Date.now() - 5 * 60_000).toISOString();
		const view = await testing.openConversations([
			conversation({
				status: "starting",
				queue: { position: 1, of: 1, since, reason: "no worker up" },
			}),
		]);

		const late = view.container.ownerDocument.querySelector(
			'[data-slot="queue-late"]',
		);
		expect(late?.textContent).toContain(
			"Taking longer than usual. The Queue page shows what waits and why.",
		);
		expect(
			view.getByRole("link", { name: "Open Queue" }).getAttribute("href"),
		).toBe("#tasks");
	});

	it("says nothing is late of a wait under a minute", async () => {
		const since = new Date(Date.now() - 20_000).toISOString();
		const view = await testing.openConversations([
			conversation({
				status: "starting",
				queued: 3,
				queue: { position: 1, of: 1, since, reason: "starting" },
			}),
		]);

		const banner = view.container.ownerDocument.querySelector(
			'[data-slot="queue-banner"]',
		);
		expect(banner?.textContent).toContain(
			"Queued, 1st of 1 to start. Its task is starting, readying a worktree and installing. It has been at it under a minute.",
		);
		expect(
			view.container.ownerDocument.querySelector('[data-slot="queue-late"]'),
		).toBeNull();
	});

	it("says a held task waits on its blocker, never late, with no slot to move", async () => {
		const since = new Date(Date.now() - 30 * 60_000).toISOString();
		const view = await testing.openConversations([
			conversation({
				status: "starting",
				queued: 3,
				queue: { position: 2, of: 2, since, reason: "waits on #2" },
			}),
		]);

		const banner = view.container.ownerDocument.querySelector(
			'[data-slot="queue-banner"]',
		);
		expect(banner?.textContent).toContain(
			"Queued, 2nd of 2 to start. It waits on #2 to land first, and starts once it does.",
		);
		expect(
			view.container.ownerDocument.querySelector('[data-slot="queue-late"]'),
		).toBeNull();
		expect(view.queryByRole("button", { name: "Start next" })).toBeNull();
	});

	it("says why a held task's start was refused, and retries it", async () => {
		const since = new Date().toISOString();
		const view = await testing.openConversations([
			conversation({
				status: "starting",
				queued: 3,
				queue: {
					position: 1,
					of: 1,
					since,
					reason: "could not start: hook_failed: install exited 1",
				},
			}),
		]);

		const banner = view.container.ownerDocument.querySelector(
			'[data-slot="queue-banner"]',
		);
		expect(banner?.textContent).toContain(
			"Its task could not start: hook_failed: install exited 1. Fix what that says, then retry.",
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Retry" })),
		);
		const retried = testing.posts.find((post) =>
			post.path.includes("/api/todos/3/retry"),
		);
		expect(retried?.method).toBe("POST");
	});

	it("says nothing of idling for an agent stopped otherwise", async () => {
		const view = await testing.openConversations([
			conversation({ status: "stopped" }),
		]);

		expect(
			view.container.ownerDocument.querySelector('[data-slot="idle-banner"]'),
		).toBeNull();
	});

	it("says a failed turn takes another try, cut to a few lines until tapped", async () => {
		const view = await testing.openConversations([
			conversation({ error: "Internal error" }),
		]);

		const alert = view.getByRole("alert");
		expect(alert.textContent).toContain(
			"The last turn failed. Send a message to try again.",
		);
		const words = within(alert).getByRole("button", { name: "Internal error" });
		expect(words.getAttribute("aria-expanded")).toBe("false");
		await act(async () => fireEvent.click(words));
		expect(words.getAttribute("aria-expanded")).toBe("true");
	});
});
