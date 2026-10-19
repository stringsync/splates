import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { SWIPE_PX } from "./phone-swipe";
import {
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	message,
	resize,
	Testing,
	tool,
	toThread,
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

	/** Opens task `name`'s dialog on the Tasks page, as a link to it does. */
	const openTaskAt = async (name: string) => {
		await act(async () => {
			location.hash = `#tasks/${name}`;
			window.dispatchEvent(new HashChangeEvent("hashchange"));
		});
		await waitFor(() =>
			expect(document.querySelector('[role="dialog"]')).not.toBeNull(),
		);
	};

	it("keeps an empty inbox as home and in the menu without the conversation service", async () => {
		const view = await testing.open({ tasks: [] });
		expect(view.getByRole("region", { name: "inbox" })).toBeTruthy();
		await waitFor(() =>
			expect(view.getByText("No conversations yet.")).toBeTruthy(),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Open menu" })),
		);
		expect(
			view.getByRole("button", { name: "Inbox" }).getAttribute("aria-current"),
		).toBe("page");
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Board" })),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Open menu" })),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Inbox" })),
		);
		expect(view.getByRole("region", { name: "inbox" })).toBeTruthy();
	});

	it("keeps the inbox and menu while loading, then shows its empty state", async () => {
		testing.talk = { agents: [], conversations: [] };
		const release = testing.holdSnapshots();
		const view = testing.render({ tasks: [] });
		expect(view.getByRole("region", { name: "inbox" })).toBeTruthy();
		expect(view.getByRole("status", { name: "Loading inbox" })).toBeTruthy();
		expect(view.queryByText(/No conversations yet/)).toBeNull();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Open menu" })),
		);
		expect(view.getByRole("button", { name: "Inbox" })).toBeTruthy();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Inbox" })),
		);
		await act(async () => release());
		await waitFor(() =>
			expect(
				view.getByText("No conversations yet. Start one below."),
			).toBeTruthy(),
		);
		expect(view.queryByRole("status", { name: "Loading inbox" })).toBeNull();
	});

	const report = [
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
	/** Task alpha, asking what `report` asks. */
	const asking = details({
		task: "alpha",
		plan: [
			"# alpha",
			"",
			"## Blocked",
			"",
			"- [ ] 1. Which pages need it?",
			"- [ ] 2. How should a stale todo be shown?",
			"- [ ] 3. Ready to merge?",
		].join("\n"),
	});

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

	/** The inbox with another project, zebra, listed beside this one. */
	const inZebraAndHere = async () => {
		localStorage.clear();
		testing.everywhere = [
			{
				project: "zebra",
				repo: "zebra",
				root: "/code/zebra",
				trunk: "main",
				tasks: [],
				laneNames: [],
				lanesTaken: {},
				conversations: [
					conversation({ id: "z1", title: "Stripes", status: "running" }),
					conversation({ id: "z2", title: "Zebra broke", status: "failed" }),
				],
			},
		];
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Mine", status: "running" })],
			null,
			{ tasks: [] },
		);
		const inbox = view.getByRole("region", { name: "inbox" });
		await waitFor(() => within(inbox).getByRole("region", { name: "zebra" }));
		return inbox;
	};

	it("folds the inbox by project, with every project's waiting agents in Needs you", async () => {
		const inbox = await inZebraAndHere();
		const needsYou = within(inbox).getByRole("region", { name: "Needs you" });
		expect(needsYou.textContent).toContain("Zebra broke");
		expect(needsYou.textContent).toContain("zebra");
		const zebra = within(inbox).getByRole("region", { name: "zebra" });
		expect(within(zebra).getByRole("button", { name: /Stripes/ })).toBeTruthy();

		await act(async () =>
			fireEvent.click(within(zebra).getByRole("button", { name: /Stripes/ })),
		);
		const there = new URL(String(testing.visited[0]));
		expect(there.searchParams.get("project")).toBe("zebra");
		expect(there.hash).toBe("#conversations/z1");
	});

	it("starts a conversation in a folder's project from its +", async () => {
		const inbox = await inZebraAndHere();
		await act(async () =>
			fireEvent.click(
				within(inbox).getByRole("button", {
					name: "New conversation in zebra",
				}),
			),
		);
		expect(new URL(String(testing.visited[0])).hash).toBe("#conversations/new");
	});

	it("folds a folder away, dotted while one of its agents waits", async () => {
		const inbox = await inZebraAndHere();
		const zebra = within(inbox).getByRole("region", { name: "zebra" });
		await act(async () =>
			fireEvent.click(within(zebra).getByRole("button", { name: /^zebra/ })),
		);
		await waitFor(() =>
			expect(
				within(zebra).queryByRole("button", { name: /Stripes/ }),
			).toBeNull(),
		);
		expect(
			within(zebra).getByRole("img", { name: "waiting on you" }),
		).toBeTruthy();
	});

	// scry-ignore simple-test-setup: each test here opens its own inbox; this one only lost a neighbour.
	it("leaves a task its conversation left, and one at work outside the page, and one asking outside it, to the Tasks page", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c9", task: "delta", archived: true })],
			null,
			{
				tasks: [
					details({ task: "delta", takenBy: "c9" }),
					details({ task: "gamma", lease: "held", activeAt: hoursAgo(2) }),
					details({
						task: "omega",
						activeAt: hoursAgo(2),
						plan: "# omega\n\n## Blocked\n\n- [ ] 1. Which look?\n",
					}),
				],
			},
		);

		const inbox = view.getByRole("region", { name: "inbox" });
		expect(inbox.textContent).not.toContain("delta");
		expect(inbox.textContent).not.toContain("gamma");
		expect(inbox.textContent).not.toContain("omega");
		expect(
			within(inbox).queryByRole("region", { name: "Needs you" }),
		).toBeNull();
	});

	it("nests a subagent under the agent it reports to, which is answered for it", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "orch", title: "Orchestrator", status: "idle" })],
			null,
			{
				tasks: [
					details({
						task: "sub",
						caller: "orch",
						activeAt: "2026-10-11T10:00:00.000Z",
						plan: "# sub\n\n## Blocked\n\n- [ ] 1. Which look?\n",
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
		// Its task is the Tasks page's: its wait shows on the one it reports to.
		const [orchestrator, ...others] = within(waiting).getAllByRole("button");
		expect(orchestrator?.textContent).toContain("sub: Which look?");
		expect(others).toEqual([]);

		await openTaskAt("sub");
		const note = view.getByRole("note", { name: "subagent" });
		expect(note.textContent).toContain("A subagent of Orchestrator");
		await act(async () =>
			fireEvent.click(
				within(note).getByRole("button", { name: "Orchestrator" }),
			),
		);

		expect(location.hash).toBe("#conversations/orch");
	});

	it("names a subagent's parent, its task, and the type and model it was started on", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "orch",
					name: "Worker protocol",
					status: "running",
					task: "worker-protocol",
					messages: [
						message(
							"agent",
							tool({
								id: "agent1",
								title: "Map the cards",
								kind: "think",
								subagent: { type: "Explore", model: "haiku" },
							}),
							tool({
								id: "add1",
								command: "splates add sub --goal 'Map them'",
								parent: "agent1",
							}),
						),
					],
				}),
			],
			null,
			{ tasks: [details({ task: "sub", caller: "orch" })] },
		);

		await openTaskAt("sub");
		const note = view.getByRole("note", { name: "subagent" });
		expect(note.textContent).toContain(
			"A subagent of Worker protocol on worker-protocol, which it reports to.",
		);
		expect(
			within(note).getByText("Map the cards · Explore · haiku"),
		).toBeTruthy();
	});

	it("renames, marks unread and archives a conversation from a long press on its inbox row", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Fix login", status: "stopped" })],
			null,
			{ tasks: [] },
		);
		const inbox = view.getByRole("region", { name: "inbox" });
		// As Android holds a row: the finger down, then the context menu.
		const hold = async (name: string) => {
			const row = within(inbox).getByRole("button", { name: RegExp(name) });
			await act(async () => {
				fireEvent.pointerDown(row);
				fireEvent.contextMenu(row);
			});
			return view.getByRole("dialog", { name });
		};

		let menu = await hold("Fix login");
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
		// Before the server streams it back.
		expect(
			within(inbox).getByRole("button", { name: /Login/ }).textContent,
		).toStartWith("Login");

		menu = await hold("Login");
		await act(async () =>
			fireEvent.click(
				within(menu).getByRole("button", { name: "Mark as unread" }),
			),
		);
		expect(testing.posted("/api/conversations/c1/unread")).toEqual([
			{ method: "PUT", body: { unread: true } },
		]);

		menu = await hold("Login");
		// Marked unread already, so it offers that no more.
		expect(
			within(menu).queryByRole("button", { name: "Mark as unread" }),
		).toBeNull();
		await act(async () =>
			fireEvent.click(within(menu).getByRole("button", { name: "Archive" })),
		);
		expect(testing.posted("/api/conversations/c1/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
		expect(within(inbox).queryByRole("button", { name: /Login/ })).toBeNull();
	});

	it("archives a conversation swiped left on its inbox row, asking first when its agent is at work", async () => {
		const view = await testing.openConversations(
			[
				conversation({ id: "c1", title: "Fix login", status: "stopped" }),
				conversation({ id: "c2", title: "Add search", status: "running" }),
			],
			null,
			{ tasks: [] },
		);
		const inbox = view.getByRole("region", { name: "inbox" });
		const swipe = async (name: RegExp, by: number) => {
			const row = within(inbox).getByRole("button", { name });
			await act(async () => {
				fireEvent.pointerDown(row, { clientX: 300, clientY: 100 });
				fireEvent.pointerMove(row, { clientX: 300 - by, clientY: 104 });
				fireEvent.pointerUp(row, { clientX: 300 - by, clientY: 104 });
				fireEvent.click(row);
			});
		};

		// Short of the mark, it slides back, and the tap that ends it opens nothing.
		await swipe(/Fix login/, SWIPE_PX - 20);
		expect(testing.posted("/api/conversations/c1/archived")).toEqual([]);
		expect(location.hash).not.toBe("#conversations/c1");

		// Archived once it has slid off and closed up.
		await swipe(/Fix login/, SWIPE_PX + 20);
		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/archived")).toEqual([
				{ method: "PUT", body: { archived: true } },
			]),
		);

		await swipe(/Add search/, SWIPE_PX + 20);
		const confirm = view.getByRole("dialog", { name: "Archive Add search?" });
		expect(testing.posted("/api/conversations/c2/archived")).toEqual([]);
		await act(async () =>
			fireEvent.click(within(confirm).getByRole("button", { name: "Archive" })),
		);
		expect(testing.posted("/api/conversations/c2/archived")).toEqual([
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
		await toThread(view);

		// In the thread, a line in place of the card.
		expect(view.queryByRole("list", { name: "questions" })).toBeNull();
		const bar = await waitFor(() =>
			within(
				view.getByRole("complementary", { name: "Waiting on you" }),
			).getByRole("button", { name: /3 questions for you/ }),
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
		expect(sheet.textContent).toContain("Question 1 of 3");
		// What else to say waits for a screen of its own, opened when asked.
		expect(
			within(sheet).queryByRole("textbox", { name: "Anything else" }),
		).toBeNull();
		expect(within(sheet).queryByRole("button", { name: "Back" })).toBeNull();
		const button = (name: string) =>
			within(sheet).getByRole("button", { name });

		// A pick, of one or all that apply, leaves it to Next to go on.
		await act(async () =>
			fireEvent.click(within(sheet).getByRole("button", { name: /Todos/ })),
		);
		expect(shown()).toEqual(["question 1"]);
		await act(async () => fireEvent.click(button("Next")));
		expect(shown()).toEqual(["question 2"]);
		await act(async () =>
			fireEvent.click(
				within(sheet).getByRole("button", { name: /A muted card/ }),
			),
		);
		await new Promise((resolve) => setTimeout(resolve, 400));
		expect(shown()).toEqual(["question 2"]);
		expect(within(sheet).queryByRole("button", { name: "Send" })).toBeNull();
		await act(async () => fireEvent.click(button("Next")));
		expect(shown()).toEqual(["question 3"]);

		await act(async () => fireEvent.click(button("Back")));
		expect(shown()).toEqual(["question 2"]);
		await act(async () => fireEvent.click(button("Next")));

		// The last question sends, and opens what else to say only when asked.
		expect(shown()).toEqual(["question 3"]);
		expect(within(sheet).queryByRole("button", { name: "Next" })).toBeNull();
		expect(button("Send")).toBeTruthy();
		expect(
			within(sheet).queryByRole("textbox", { name: "Anything else" }),
		).toBeNull();
		await act(async () => fireEvent.click(button("Anything else?")));

		// Its screen: what else to say, each question a tap back, and Send.
		expect(within(sheet).queryByRole("list", { name: "questions" })).toBeNull();
		expect(
			within(sheet).getByRole("textbox", { name: "Anything else" }),
		).toBeTruthy();
		expect(button("Send")).toBeTruthy();
		const answers = within(sheet).getByRole("list", { name: "your answers" });
		expect(within(answers).getAllByLabelText("answered")).toHaveLength(2);
		await act(async () =>
			fireEvent.click(within(answers).getAllByRole("button")[0] as HTMLElement),
		);
		expect(shown()).toEqual(["question 1"]);
	});

	// scry-ignore simple-test-setup: its IntersectionObserver stub is its own, which no other test shares
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
			await toThread(view);
			const bar = () =>
				view.queryByRole("complementary", { name: "Waiting on you" });
			await waitFor(() => expect(bar()).toBeTruthy());

			await scroll(1);
			expect(bar()).toBeNull();
			// The line reads as the bar did, so either is the same tap.
			expect(
				view.getByRole("button", { name: /3 questions for you\s*Answer/ }),
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
			await toThread(view);
			await act(async () =>
				fireEvent.click(
					await waitFor(() =>
						within(
							view.getByRole("complementary", { name: "Waiting on you" }),
						).getByRole("button", { name: /2 questions for you/ }),
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

			// From the last question, the keyboard drops to show Send.
			await act(async () => fireEvent.keyDown(second, { key: "Enter" }));
			expect(document.activeElement === second).toBe(false);
			expect(
				within(sheet).queryByRole("textbox", { name: "Anything else" }),
			).toBeNull();
		} finally {
			window.matchMedia = media;
		}
	});

	// scry-ignore simple-test-setup: its layout stubs are its own, which no other test shares
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
		await toThread(view);
		await act(async () =>
			fireEvent.click(
				await waitFor(() =>
					within(
						view.getByRole("complementary", { name: "Waiting on you" }),
					).getByRole("button", { name: /1 question for you/ }),
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

	it("counts nothing on a sheet of one question, sending from it", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Header",
				messages: [
					message("user", "fix the header"),
					message("agent", "1. Which pages need it?\n   - [a] Todos"),
				],
			}),
		]);
		await toThread(view);

		await act(async () =>
			fireEvent.click(
				await waitFor(() =>
					within(
						view.getByRole("complementary", { name: "Waiting on you" }),
					).getByRole("button", { name: /1 question for you/ }),
				),
			),
		);
		const sheet = await waitFor(() =>
			view.getByRole("dialog", { name: "1 question for you" }),
		);
		expect(sheet.textContent).not.toContain("of 1");
		expect(sheet.textContent).not.toContain("answered");

		expect(within(sheet).queryByRole("button", { name: "Next" })).toBeNull();
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
			{ tasks: [asking] },
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

	it("goes back to the inbox on closing a sheet the inbox opened", async () => {
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
			{ tasks: [asking] },
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
		await act(
			() =>
				new Promise<void>((resolve) => {
					addEventListener("popstate", () => resolve(), { once: true });
					fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
				}),
		);

		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
		expect(location.hash).toBe("#conversations");
		expect(view.getByRole("region", { name: "inbox" })).toBeTruthy();
	});

	it("counts on its header's way back the other agents waiting on you", async () => {
		const view = await testing.openConversations([
			conversation({
				id: "c1",
				title: "Broke",
				status: "failed",
				createdAt: "2026-10-11T10:02:00.000Z",
			}),
			conversation({
				id: "c2",
				title: "Also broke",
				status: "failed",
				createdAt: "2026-10-11T10:01:00.000Z",
			}),
		]);
		expect(location.hash).toBe("#conversations/c1");
		view.getByRole("status", { name: "1 waiting on you" });
		expect(view.queryByRole("button", { name: /^Next waiting/ })).toBeNull();

		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "Back to conversations" }),
			),
		);

		expect(location.hash).toBe("#conversations");
	});

	it("goes from atop any other page to the next agent waiting on you", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					title: "Broke",
					status: "failed",
					createdAt: "2026-10-11T10:02:00.000Z",
				}),
				conversation({
					id: "c2",
					title: "Also broke",
					status: "failed",
					createdAt: "2026-10-11T10:01:00.000Z",
				}),
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

	it("keeps branding and the project switcher in the drawer alone", async () => {
		const view = await testing.openConversations([], null);
		const inbox = view.getByRole("region", { name: "inbox" });
		expect(
			within(inbox).queryByRole("button", { name: "Switch project" }),
		).toBeNull();
		expect(
			within(inbox).queryByRole("img", { name: /Spinning Plates|slot / }),
		).toBeNull();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Open menu" })),
		);
		const drawer = await waitFor(() =>
			view.getByRole("dialog", { name: "Pages" }),
		);
		expect(
			within(drawer).getByRole("button", { name: "Switch project" }),
		).toBeTruthy();
		expect(
			within(drawer).getByRole("img", { name: "Spinning Plates" }),
		).toBeTruthy();
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
				within(bar).queryByRole("button", { name: "Switch project" }),
			).toBeNull(),
		);
		expect(
			within(bar).queryByRole("img", { name: /Spinning Plates|slot / }),
		).toBeNull();
		expect(within(bar).getByRole("heading", { name: "Stats" })).toBeTruthy();
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

	it("opens phone widgets with a visible close control and returns focus to the header", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Look around" })],
			"c1",
		);
		const toggle = view.getByRole("button", { name: "Widgets" });
		toggle.focus();
		await act(async () => fireEvent.click(toggle));
		const widgets = view.getByRole("region", { name: "widgets" });
		const close = within(widgets).getByRole("button", {
			name: /^Close$/,
		});
		expect(document.activeElement).toBe(close);
		await act(async () => fireEvent.click(close));
		expect(widgets.inert).toBe(true);
		expect(document.activeElement).toBe(toggle);
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
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
			{ tasks: [details({ task: "beta" })] },
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

	it("leaves Update to the inbox's bar, out of a conversation's", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Broke" })],
			"c1",
			{ release: { running: "0.0.43", newest: "0.0.44" } },
		);
		expect(location.hash).toBe("#conversations/c1");
		view.getByRole("button", { name: "More" });
		expect(view.queryByRole("button", { name: "Update" })).toBeNull();

		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "Back to conversations" }),
			),
		);

		await waitFor(() => view.getByRole("button", { name: "Update" }));
	});

	it("starts a new conversation with the same agent from a conversation's bar", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", title: "Broke", agent: "codex" }),
		]);
		expect(location.hash).toBe("#conversations/c1");
		// A phone starts one from the inbox, mostly: the kebab keeps it here.
		expect(view.queryByRole("button", { name: "New conversation" })).toBeNull();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "More" })),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() =>
					view.getByRole("menuitem", { name: "New conversation" }),
				),
			),
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

	// scry-ignore simple-test-setup: the background commands it lists are what it checks, and no other test opens with them
	it("nests a conversation's running commands and its shell under it in the inbox, opening each from there", async () => {
		const running = {
			id: "b1",
			name: "Start the dev server",
			command: "bun dev",
			subagent: null,
			state: "running" as const,
			output: "/tmp/b1.output",
		};
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					title: "Serve it",
					status: "stopped",
					background: [
						running,
						{ ...running, id: "b2", name: "Old build", state: "completed" },
					],
				}),
			],
			"c1",
			{ tasks: [] },
		);
		await act(async () => {
			fireEvent.keyDown(window, { key: "`", code: "Backquote", ctrlKey: true });
		});
		const [shell] = testing.shells;
		await act(async () => shell?.accept());
		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "Back to conversations" }),
			),
		);

		const recent = within(
			view.getByRole("region", { name: "inbox" }),
		).getByRole("region", { name: "Recent" });
		expect(
			within(recent)
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual([
			expect.stringContaining("Serve it"),
			"TerminalShell up",
			"Start the dev serverbun dev",
		]);
		expect(recent.textContent).not.toContain("Old build");

		await act(async () =>
			fireEvent.click(
				within(recent).getByRole("button", { name: /^Terminal/ }),
			),
		);
		expect(location.hash).toBe("#conversations/c1/terminal");
		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "Back to conversations" }),
			),
		);

		await act(async () =>
			fireEvent.click(
				within(
					within(view.getByRole("region", { name: "inbox" })).getByRole(
						"region",
						{ name: "Recent" },
					),
				).getByRole("button", { name: /^Start the dev server/ }),
			),
		);
		expect(location.hash).toBe("#conversations/c1");
		expect(
			within(
				view.getByRole("complementary", { name: "background command" }),
			).getByRole("heading").textContent,
		).toBe("Start the dev server");
	});
});

function hoursAgo(hours: number): string {
	return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}
