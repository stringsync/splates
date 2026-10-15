import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	message,
	resize,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App on a phone", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		resize(390, 844);
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		resize(1024, 768);
	});

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

	it("lists the agents waiting on you first in its inbox", async () => {
		const view = await testing.openConversations(
			[
				conversation({ id: "c1", title: "Quiet", status: "stopped" }),
				conversation({ id: "c2", title: "Broke", status: "failed" }),
			],
			null,
			// No external agents, which would list as working.
			{ tasks: [] },
		);

		const inbox = view.getByRole("region", { name: "inbox" });
		expect(
			within(inbox)
				.getAllByRole("region")
				.map((group) => group.getAttribute("aria-label")),
		).toEqual(["Needs you", "Recent"]);
		const waiting = within(inbox).getByRole("region", { name: "Needs you" });
		expect(waiting.textContent).toContain("Broke");
		expect(waiting.textContent).toContain("Failed");
	});

	it("puts a task its conversation left in Needs you, and says how long one elsewhere has been quiet", async () => {
		const left = details({ task: "delta", takenBy: "c9" });
		const quiet = details({ task: "gamma", activeAt: hoursAgo(2) });
		const view = await testing.openConversations(
			[conversation({ id: "c9", task: "delta", archived: true })],
			null,
			{ tasks: [left, quiet] },
		);

		const inbox = view.getByRole("region", { name: "inbox" });
		const group = (name: string) =>
			within(inbox).getByRole("region", { name }).textContent;
		expect(group("Needs you")).toContain(
			"Abandoned · Its conversation was archived",
		);
		expect(group("Working")).toContain("gamma2hNo sign since 2h");
	});

	it("nests a subagent under the agent it reports to, which is answered for it", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "orch", title: "Orchestrator", status: "idle" })],
			null,
			{
				tasks: [
					details({
						task: "sub",
						status: "escalated",
						escalation: "look",
						caller: "orch",
					}),
				],
			},
		);

		const waiting = within(
			view.getByRole("region", { name: "inbox" }),
		).getByRole("region", { name: "Needs you" });
		expect(within(waiting).getByRole("heading").textContent).toBe(
			"Needs you · 1",
		);
		const [orchestrator, sub] = within(waiting).getAllByRole("button");
		expect(orchestrator?.textContent).toContain("Escalated · sub: look");
		expect(sub?.textContent).toContain("sub");

		await act(async () => fireEvent.click(sub as HTMLElement));
		const note = view.getByRole("note", { name: "reports to" });
		expect(view.queryByText("Its agent runs outside the page")).toBeNull();
		await act(async () =>
			fireEvent.click(
				within(note).getByRole("button", { name: "Open Orchestrator" }),
			),
		);

		expect(location.hash).toBe("#conversations/orch");
	});

	it("renames, marks unread and archives a conversation from a long press on its inbox row", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Fix login", status: "stopped" })],
			null,
			{ tasks: [] },
		);
		const inbox = view.getByRole("region", { name: "inbox" });
		// As Android holds a row: the finger down, then the context menu.
		const hold = async () => {
			const row = within(inbox).getByRole("button", { name: /Fix login/ });
			await act(async () => {
				fireEvent.pointerDown(row);
				fireEvent.contextMenu(row);
			});
			return view.getByRole("dialog", { name: "Fix login" });
		};

		let menu = await hold();
		// The press opens the menu, not the conversation.
		expect(location.hash).not.toBe("#conversations/c1");
		await act(async () =>
			fireEvent.click(within(menu).getByRole("button", { name: "Rename" })),
		);
		const box = within(menu).getByRole("textbox", {
			name: "Rename Fix login",
		});
		await act(async () =>
			fireEvent.change(box, { target: { value: "Login" } }),
		);
		await act(async () =>
			fireEvent.click(within(menu).getByRole("button", { name: "Save" })),
		);
		expect(testing.posted("/api/conversations/c1/name")).toEqual([
			{ method: "PUT", body: { name: "Login" } },
		]);

		menu = await hold();
		await act(async () =>
			fireEvent.click(
				within(menu).getByRole("button", { name: "Mark as unread" }),
			),
		);
		expect(testing.posted("/api/conversations/c1/unread")).toEqual([
			{ method: "PUT", body: { unread: true } },
		]);

		menu = await hold();
		await act(async () =>
			fireEvent.click(within(menu).getByRole("button", { name: "Archive" })),
		);
		expect(testing.posted("/api/conversations/c1/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
	});

	it("starts a new conversation from the composer along the inbox's bottom", async () => {
		const view = await testing.openConversations([], null);

		await act(async () =>
			fireEvent.focus(
				view.getByRole("textbox", { name: "Start a conversation" }),
			),
		);

		expect(location.hash).toBe("#conversations/new");
		expect(view.getByRole("region", { name: "new conversation" })).toBeTruthy();
	});

	it("starts a new conversation from the pen atop any other page", async () => {
		const view = await testing.openConversations([], null);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Open menu" })),
		);
		const drawer = await waitFor(() =>
			view.getByRole("dialog", { name: "Pages" }),
		);
		await act(async () =>
			fireEvent.click(within(drawer).getByRole("button", { name: /Tasks/ })),
		);
		expect(location.hash).toBe("#tasks");

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "New conversation" })),
		);

		expect(location.hash).toBe("#conversations/new");
		expect(view.getByRole("region", { name: "new conversation" })).toBeTruthy();
	});

	it("goes back to the inbox from any page the menu opened, however many it opened", async () => {
		const view = await testing.openConversations([], null);
		const length = history.length;
		const pick = async (name: RegExp) => {
			await act(async () =>
				fireEvent.click(view.getByRole("button", { name: "Open menu" })),
			);
			const drawer = await waitFor(() =>
				view.getByRole("dialog", { name: "Pages" }),
			);
			await act(async () =>
				fireEvent.click(within(drawer).getByRole("button", { name })),
			);
		};
		await pick(/Tasks/);
		await pick(/Stats/);
		await pick(/Creds/);

		expect(location.hash).toBe("#creds");
		expect(history.length).toBe(length + 1);
		await act(
			() =>
				new Promise<void>((resolve) => {
					addEventListener("popstate", () => resolve(), { once: true });
					history.back();
				}),
		);
		expect(location.hash).toBe("#conversations");
		expect(view.getByRole("region", { name: "inbox" })).toBeTruthy();
	});

	it("answers questions one at a time, in a sheet the bar above the composer opens", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Header",
				messages: [message("user", "fix the header"), message("agent", report)],
			}),
		]);

		// In the thread, a line in place of the card.
		expect(view.queryByRole("list", { name: "questions" })).toBeNull();
		const bar = await waitFor(() =>
			view.getByRole("button", { name: /3 questions for you\s*Answer/ }),
		);
		await act(async () => fireEvent.click(bar));
		const sheet = await waitFor(() =>
			view.getByRole("dialog", { name: "3 questions for you" }),
		);
		const shown = () =>
			within(sheet)
				.getAllByRole("listitem")
				.map((card) => card.getAttribute("aria-label"));
		expect(shown()).toEqual(["question 1"]);
		// Pinned under every question: what else to say, and Send.
		expect(
			within(sheet).getByRole("textbox", { name: "Anything else" }),
		).toBeTruthy();
		expect(within(sheet).getByRole("button", { name: "Send" })).toBeTruthy();
		// Its progress in the dots of its footer, not wrapping the header.
		expect(sheet.textContent).not.toContain("answered");
		const nav = within(sheet).getByRole("navigation", { name: "questions" });
		expect(
			within(nav)
				.getByRole("button", { current: "step" })
				.getAttribute("aria-label"),
		).toBe("Question 1 of 3");

		// Picking all that apply leaves it to the arrow to go on.
		await act(async () =>
			fireEvent.click(within(sheet).getByRole("button", { name: /Todos/ })),
		);
		expect(shown()).toEqual(["question 1"]);
		await act(async () =>
			fireEvent.click(
				within(sheet).getByRole("button", { name: "Next question" }),
			),
		);
		expect(shown()).toEqual(["question 2"]);

		// Picking one goes on by itself.
		await act(async () =>
			fireEvent.click(
				within(sheet).getByRole("button", { name: /A muted card/ }),
			),
		);
		await waitFor(() => expect(shown()).toEqual(["question 3"]));

		await act(async () =>
			fireEvent.click(
				within(sheet).getByRole("button", { name: "Previous question" }),
			),
		);
		expect(shown()).toEqual(["question 2"]);
		await act(async () =>
			fireEvent.click(
				within(nav).getByRole("button", { name: "Question 1 of 3, answered" }),
			),
		);
		expect(shown()).toEqual(["question 1"]);
	});

	it("leaves the bar above the composer out while the card's own line is in sight", async () => {
		const real = globalThis.IntersectionObserver;
		// The one line in the thread, as the observer last watched it.
		let watched: ((ratio: number) => void) | null = null;
		globalThis.IntersectionObserver = class {
			constructor(private readonly callback: IntersectionObserverCallback) {}
			observe(target: Element) {
				watched = (ratio) =>
					this.callback(
						[{ target, intersectionRatio: ratio } as IntersectionObserverEntry],
						{} as IntersectionObserver,
					);
			}
			disconnect() {}
		} as unknown as typeof IntersectionObserver;
		const scroll = (ratio: number) => act(async () => watched?.(ratio));
		try {
			const view = await testing.openConversations([
				conversation({
					title: "Header",
					messages: [
						message("user", "fix the header"),
						message("agent", report),
					],
				}),
			]);
			const bar = () =>
				view.queryByRole("button", { name: /3 questions for you\s*Answer/ });
			await waitFor(() => expect(bar()).toBeTruthy());

			await scroll(1);
			expect(bar()).toBeNull();
			expect(
				view.getByRole("button", { name: /3 questions for you\s*Open/ }),
			).toBeTruthy();

			await scroll(0.2);
			expect(bar()).toBeTruthy();
		} finally {
			globalThis.IntersectionObserver = real;
		}
	});

	it("goes on from a typed answer to the next question's field, keeping the keyboard up", async () => {
		const media = window.matchMedia;
		window.matchMedia = (query) =>
			query === "(pointer: coarse)"
				? ({
						matches: true,
						addEventListener: () => {},
						removeEventListener: () => {},
					} as unknown as MediaQueryList)
				: media.call(window, query);
		try {
			const view = await testing.openConversations([
				conversation({
					title: "Header",
					messages: [
						message("user", "fix the header"),
						message(
							"agent",
							"1. What looks wrong at 390px?\n2. What else should change?",
						),
					],
				}),
			]);
			await act(async () =>
				fireEvent.click(
					await waitFor(() =>
						view.getByRole("button", { name: /2 questions for you\s*Answer/ }),
					),
				),
			);
			const sheet = await waitFor(() =>
				view.getByRole("dialog", { name: "2 questions for you" }),
			);
			const first = within(sheet).getByRole("textbox", { name: "Answer to 1" });
			await act(async () => first.focus());

			await act(async () => fireEvent.keyDown(first, { key: "Enter" }));

			const second = within(sheet).getByRole("textbox", {
				name: "Answer to 2",
			});
			expect(document.activeElement === second).toBe(true);
		} finally {
			window.matchMedia = media;
		}
	});

	it("keeps the field typed in above the keyboard as it comes up after the focus", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Header",
				messages: [
					message("user", "fix the header"),
					message("agent", "1. What looks wrong at 390px?"),
				],
			}),
		]);
		await act(async () =>
			fireEvent.click(
				await waitFor(() =>
					view.getByRole("button", { name: /1 question for you\s*Answer/ }),
				),
			),
		);
		const sheet = await waitFor(() =>
			view.getByRole("dialog", { name: "1 question for you" }),
		);
		const body = sheet.querySelector("[data-sheet]") as HTMLElement;
		const field = within(sheet).getByRole("textbox", { name: "Answer to 1" });
		// The sheet ends where the window does; the field sits well down it.
		body.getBoundingClientRect = () =>
			DOMRect.fromRect({ x: 0, y: 56, width: 390, height: innerHeight - 56 });
		const foot = innerHeight - 100;
		field.getBoundingClientRect = () =>
			DOMRect.fromRect({ x: 0, y: foot - 40, width: 390, height: 40 });
		// The sheet focuses it as it opens, before the keyboard is up.
		await act(async () => field.focus());
		await act(() => new Promise((done) => requestAnimationFrame(done)));
		const from = body.scrollTop;

		// The keyboard comes up only once the field has the focus.
		const shown = innerHeight - 300;
		await act(async () => resize(390, shown));

		await waitFor(() =>
			expect(body.scrollTop).toBe(from + foot - (shown - 12)),
		);
	});

	it("leaves the dots off a sheet of one question", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Header",
				messages: [
					message("user", "fix the header"),
					message("agent", "1. Which pages need it?\n   - [a] Todos"),
				],
			}),
		]);

		await act(async () =>
			fireEvent.click(
				await waitFor(() =>
					view.getByRole("button", { name: /1 question for you\s*Answer/ }),
				),
			),
		);
		const sheet = await waitFor(() =>
			view.getByRole("dialog", { name: "1 question for you" }),
		);
		expect(within(sheet).queryByRole("navigation")).toBeNull();
		expect(sheet.textContent).not.toContain("answered");
		expect(within(sheet).getByRole("button", { name: "Send" })).toBeTruthy();
	});

	it("goes from a sheet the inbox opened to the conversation behind it", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					title: "Header",
					task: "alpha",
					messages: [
						message("user", "fix the header"),
						message("agent", report),
					],
				}),
			],
			null,
			{ tasks: [details({ task: "alpha", status: "escalated" })] },
		);

		await act(async () =>
			fireEvent.click(
				within(view.getByRole("region", { name: "Needs you" })).getByRole(
					"button",
					{ name: /alpha/ },
				),
			),
		);
		const sheet = await waitFor(() =>
			view.getByRole("dialog", { name: "3 questions for you" }),
		);
		await act(async () =>
			fireEvent.click(
				within(sheet).getByRole("button", { name: "Conversation" }),
			),
		);

		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
		expect(location.hash).toBe("#conversations/c1");
		expect(view.getByText("fix the header")).toBeTruthy();
	});

	it("goes on from its header to the next agent waiting on you", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", title: "Broke", status: "failed" }),
			conversation({ id: "c2", title: "Also broke", status: "failed" }),
		]);
		expect(location.hash).toBe("#conversations/c1");

		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "Next waiting on you, of 1" }),
			),
		);

		expect(location.hash).toBe("#conversations/c2");
	});

	it("goes from atop any other page to the next agent waiting on you", async () => {
		const view = await testing.openConversations(
			[
				conversation({ id: "c1", title: "Broke", status: "failed" }),
				conversation({ id: "c2", title: "Also broke", status: "failed" }),
			],
			null,
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Open menu" })),
		);
		const drawer = await waitFor(() =>
			view.getByRole("dialog", { name: "Pages" }),
		);
		await act(async () =>
			fireEvent.click(within(drawer).getByRole("button", { name: /Tasks/ })),
		);
		expect(location.hash).toBe("#tasks");

		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "Next waiting on you, of 2" }),
			),
		);

		expect(location.hash).toBe("#conversations/c1");
	});

	it("heads the inbox and every page the menu opens with the slot's mark and the project switcher", async () => {
		const view = await testing.openConversations([], null);
		const inbox = view.getByRole("region", { name: "inbox" });
		expect(
			within(inbox).getByRole("button", { name: "Switch project" }),
		).toBeTruthy();
		expect(within(inbox).getByRole("img", { name: "arbor" })).toBeTruthy();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Open menu" })),
		);
		const drawer = await waitFor(() =>
			view.getByRole("dialog", { name: "Pages" }),
		);
		await act(async () =>
			fireEvent.click(within(drawer).getByRole("button", { name: /Stats/ })),
		);
		await waitFor(() => expect(location.hash).toBe("#stats"));

		const bar = await waitFor(() => {
			const header = view.container.querySelector("header");
			expect(header).not.toBeNull();
			return header as HTMLElement;
		});
		await waitFor(() =>
			expect(
				within(bar).getByRole("button", { name: "Switch project" }),
			).toBeTruthy(),
		);
		expect(within(bar).getByRole("img", { name: "arbor" })).toBeTruthy();
		expect(within(bar).queryByRole("heading", { name: "Stats" })).toBeNull();
	});

	it("keeps its drawer's header to one line, leaving out the project's path", async () => {
		const view = await testing.openConversations([], null, {
			path: "/work/demo-repo",
		});
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Open menu" })),
		);
		const drawer = await waitFor(() =>
			view.getByRole("dialog", { name: "Pages" }),
		);

		expect(drawer.textContent).not.toContain("/work/demo-repo");
	});

	it("heads a conversation with its name alone, its task's branch atop its widgets", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", task: "alpha", title: "Fix login" })],
			"c1",
			{ tasks: [details({ task: "alpha" })] },
		);
		expect(view.queryByRole("img", { name: "branch" })).toBeNull();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Widgets" })),
		);
		const actions = view.getByRole("navigation", { name: "actions" });
		await act(async () =>
			fireEvent.click(
				within(actions).getByRole("button", { name: "task/alpha" }),
			),
		);

		expect(
			await waitFor(() => view.getByRole("dialog", { name: "alpha" })),
		).toBeDefined();
	});

	it("takes up a task from atop a main-tree conversation's widgets", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Look around" })],
			"c1",
			{ tasks: [details({ task: "beta", status: "escalated" })] },
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Widgets" })),
		);
		const actions = view.getByRole("navigation", { name: "actions" });
		await act(async () =>
			fireEvent.click(within(actions).getByRole("button", { name: /main/ })),
		);

		expect(
			(await waitFor(() => view.getAllByRole("menuitem"))).map(
				(each) => each.textContent,
			),
		).toContain("beta");
	});

	it("starts a new conversation with the same agent from a conversation's bar", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", title: "Broke", agent: "codex" }),
		]);
		expect(location.hash).toBe("#conversations/c1");

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "New conversation" })),
		);

		expect(location.hash).toBe("#conversations/new/codex");
		const starting = view.getByRole("region", { name: "new conversation" });
		expect(
			within(starting).getByRole("button", { name: "Pick an agent" })
				.textContent,
		).toContain("Codex");
	});

	it("opens a shell in the main tree from the new conversation's picker, listed in the inbox until closed", async () => {
		const view = await testing.openConversations([], null);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "New conversation" })),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Pick an agent" })),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("menuitem", { name: "Terminal" })),
			),
		);

		expect(location.hash).toBe("#conversations/terminal/1");
		expect(
			view.getByRole("region", { name: "terminal" }).textContent,
		).toContain("in the main tree");
		expect(testing.shells.map((shell) => shell.task)).toEqual([null]);

		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "Back to conversations" }),
			),
		);
		const terminals = view.getByRole("region", { name: "Terminals" });
		await act(async () =>
			fireEvent.click(
				within(terminals).getByRole("button", { name: /^Terminal 1/ }),
			),
		);
		expect(location.hash).toBe("#conversations/terminal/1");
		expect(testing.shells).toHaveLength(1);

		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "Back to conversations" }),
			),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Close Terminal 1" })),
		);
		expect(testing.shells[0]?.readyState).toBe(3);
		expect(view.queryByRole("region", { name: "Terminals" })).toBeNull();
	});
});

function hoursAgo(hours: number): string {
	return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}
