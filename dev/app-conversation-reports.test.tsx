import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	todo,
	waitFor,
	within,
} from "./testing";

describe("App's report cards", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("shows how each task ended, or what it waits on, as a card", async () => {
		await testing.openConversations([
			conversation({
				title: "Reports",
				messages: [
					message(
						"agent",
						[
							"## ✅ Merged header onto main",
							"",
							"The header wraps now.",
							"",
							"## 🛑 Removed footer: superseded by a fix on main",
							"",
							"It set out to move the footer.",
							"",
							"## ⚠️ Escalated sidebar: needs a call on the width",
							"",
							"The sidebar folds on phones.",
						].join("\n"),
					),
				],
			}),
		]);
		const view = document.body;

		const merged = await waitFor(() =>
			within(view).getByRole("region", { name: "merged header" }),
		);
		expect(merged.textContent).toContain("Merged");
		expect(merged.textContent).toContain("main");
		expect(merged.textContent).toContain("The header wraps now.");
		const removed = within(view).getByRole("region", {
			name: "removed footer",
		});
		expect(removed.textContent).toContain("superseded by a fix on main");
		expect(removed.textContent).toContain("It set out to move the footer.");
		const escalated = within(view).getByRole("region", {
			name: "escalated sidebar",
		});
		expect(escalated.textContent).toContain("needs a call on the width");
		expect(view.textContent).not.toContain("## ✅");
	});

	it("shows a handoff as a card naming the agent it went to, and offers to archive it", async () => {
		const view = await testing.openConversations([
			conversation({
				messages: [
					message(
						"agent",
						[
							"## 🤝 Handed off header to Codex: you asked for GPT-5.5",
							"",
							"The parser is done; the styles are next.",
						].join("\n"),
					),
				],
			}),
		]);

		const handed = await waitFor(() =>
			view.getByRole("region", { name: "handed header" }),
		);
		expect(handed.textContent).toContain("Handed off");
		expect(handed.textContent).toContain("to Codex");
		expect(handed.textContent).toContain("you asked for GPT-5.5");
		expect(handed.textContent).toContain("the styles are next");
		const bar = view.getByRole("region", { name: "archive" });
		expect(bar.textContent).toContain("header");
	});

	it("shows a lane orchestrator's finished report as a card naming each lane, and offers to archive it", async () => {
		await testing.openConversations([
			conversation({
				title: "Lanes",
				messages: [
					message(
						"agent",
						[
							"## 🏁 Finished lanes Stats, Licensing",
							"",
							"Both lanes landed.",
							"",
							"- Stats: #155 merged.",
						].join("\n"),
					),
				],
			}),
		]);
		const view = document.body;

		const finished = await waitFor(() =>
			within(view).getByRole("region", { name: "finished Stats, Licensing" }),
		);
		expect(finished.textContent).toContain("Finished");
		expect(within(finished).getByTitle("Stats").textContent).toContain("Lane");
		expect(within(finished).getByTitle("Licensing")).toBeTruthy();
		expect(finished.textContent).toContain("Both lanes landed.");
		expect(
			within(view).getByRole("region", { name: "archive" }).textContent,
		).toContain("Finished Stats, Licensing");
	});

	/** Records each element scrolled into view while `run` runs, in `scrolled`. */
	const scrollingIntoView = async (
		run: (scrolled: Element[]) => Promise<void>,
	) => {
		const scrolled: Element[] = [];
		// scry-ignore fakes-over-mocks: happy-dom lays nothing out, so where the card scrolls has to be spied
		const scroll = spyOn(
			HTMLElement.prototype,
			"scrollIntoView",
		).mockImplementation(function (this: HTMLElement) {
			scrolled.push(this);
		});
		try {
			await run(scrolled);
		} finally {
			scroll.mockRestore();
		}
		return scrolled;
	};

	const talk = [
		message("user", "fix the footer"),
		message("agent", "It moved."),
		message("user", "fix the header"),
		message("agent", "It wraps."),
	];

	it("opens an unread conversation at the first message its person has yet to see, clear of their message", async () => {
		let reply: Element | null = null;
		const scrolled = await scrollingIntoView(async (seen) => {
			await testing.openConversations([
				conversation({ messages: talk, unread: true, seen: 3 }),
			]);
			reply = await waitFor(() => {
				const found = document.querySelector(
					'[data-role="assistant"][data-message-id="3"]',
				);
				expect(found).not.toBeNull();
				return found;
			});
			await waitFor(() => expect(seen.at(-1)).toBe(reply as Element));
		});

		expect(new Set<Element | null>(scrolled)).toEqual(new Set([reply]));
		expect((reply as HTMLElement | null)?.style.scrollMarginTop).toMatch(
			/^\d+(\.\d+)?px$/,
		);
	});

	it("opens a conversation read to its end at the bottom", async () => {
		const scrolled = await scrollingIntoView(async () => {
			await testing.openConversations([
				conversation({ messages: talk, unread: false, seen: 1 }),
			]);
			await waitFor(() =>
				expect(within(document.body).getByText("It wraps.")).toBeTruthy(),
			);
			await act(() => new Promise((done) => requestAnimationFrame(done)));
		});

		expect(scrolled).toEqual([]);
	});

	it("opens a conversation that ends on questions at their card's top, where the focus is", async () => {
		// Resizes the page has no layout to make, as the cards above render.
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
		let card: Element | null = null;
		const scrolled = await scrollingIntoView(async (seen) => {
			await testing.openConversations([
				conversation({
					messages: [
						message("user", "fix the header"),
						message("agent", "1. Which pages need it?\n   - [a] Todos"),
					],
					unread: false,
					seen: 1,
				}),
			]);
			card = await waitFor(() => {
				const found = document.activeElement?.closest("[data-card]");
				expect(found).toBeTruthy();
				return found as Element;
			});
			// The thread places itself again as what is above settles, keeping
			// to the card rather than going on to the bottom.
			seen.length = 0;
			await act(async () => {
				// scry-ignore matchers-over-test-logic: fires every resize watched, building no subject
				for (const fire of watchers) {
					fire();
				}
			});
		}).finally(() => {
			globalThis.ResizeObserver = real;
		});

		expect(scrolled).not.toEqual([]);
		expect(new Set<Element | null>(scrolled)).toEqual(new Set([card]));
	});

	it("keeps the thread clear of the composer only while the focus is elsewhere, so typing never scrolls it", async () => {
		// The footer's height, which the page has no layout to give.
		const height = Object.getOwnPropertyDescriptor(
			HTMLElement.prototype,
			"offsetHeight",
		) as PropertyDescriptor;
		Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
			configurable: true,
			get: () => 120,
		});
		try {
			const view = await testing.openConversations([
				conversation({
					messages: [
						message("user", "fix the footer"),
						message("agent", "## ✅ Merged footer onto main\n\nIt moved."),
					],
				}),
			]);
			const thread = await waitFor(
				() =>
					document.querySelector(
						'[data-slot="aui_thread-viewport"]',
					) as HTMLElement,
			);
			const composer = within(view.container).getByRole("textbox", {
				name: "Message input",
			});
			const source = await waitFor(() =>
				within(view.getByRole("region", { name: "merged footer" })).getByRole(
					"button",
					{ name: "Show source" },
				),
			);

			act(() => composer.focus());
			expect(thread.style.scrollPaddingBottom).toBe("0px");
			act(() => source.focus());
			expect(thread.style.scrollPaddingBottom).toBe("120px");
		} finally {
			Object.defineProperty(HTMLElement.prototype, "offsetHeight", height);
		}
	});

	it("shows a report's markdown as the agent wrote it in place of its body, to copy, until toggled back", async () => {
		const written = [
			"## ✅ Merged header onto main",
			"",
			"The header **wraps** now.",
		].join("\n");
		const view = await testing.openConversations([
			conversation({
				messages: [
					message(
						"agent",
						`${written}\n\n### 📝 Fold the sidebar [#7]\n\nNext.`,
					),
				],
			}),
		]);
		const copied: string[] = [];
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: async (text: string) => void copied.push(text) },
		});
		const card = await waitFor(() =>
			view.getByRole("region", { name: "merged header" }),
		);
		const toggle = within(card).getByRole("button", { name: "Show source" });
		expect(toggle.getAttribute("aria-pressed")).toBe("false");
		expect(card.querySelector("pre")).toBeNull();

		act(() => fireEvent.click(toggle));

		expect(toggle.getAttribute("aria-pressed")).toBe("true");
		expect(card.querySelector("pre")?.textContent).toBe(written);
		expect(card.querySelector("strong")).toBeNull();
		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: "Copy" })),
		);
		expect(copied).toEqual([written]);
		expect(within(card).getByRole("button", { name: "Copied" })).not.toBeNull();

		act(() => fireEvent.click(toggle));

		expect(card.querySelector("pre")).toBeNull();
		expect(card.querySelector("strong")?.textContent).toBe("wraps");
	});

	it("offers to archive the conversation above the composer while its last word reports a task that is over, then goes on to a new one with none waiting", async () => {
		const view = await testing.openConversations([
			conversation({
				messages: [
					message(
						"agent",
						"## ✅ Merged header onto main\n\nThe header wraps now.",
					),
					message("user", "now the footer"),
					message(
						"agent",
						[
							"## ⚠️ Escalated footer: needs a call on the color",
							"",
							"The footer is gray.",
							"",
							"## 🛑 Removed sidebar: superseded by a fix on main",
							"",
							"It set out to fold the sidebar.",
						].join("\n"),
					),
				],
			}),
		]);

		const bar = await waitFor(() =>
			view.getByRole("region", { name: "archive" }),
		);
		// The last report names the task, and no card offers it.
		expect(bar.textContent).toContain("Removed");
		expect(bar.textContent).toContain("sidebar");
		// scry-ignore matchers-over-test-logic: older than this task, which only dropped a test above it
		for (const name of ["merged header", "removed sidebar"]) {
			expect(
				within(view.getByRole("region", { name })).queryByRole("button", {
					name: "Archive",
				}),
			).toBeNull();
		}

		await act(async () =>
			fireEvent.click(within(bar).getByRole("button", { name: "Archive" })),
		);

		expect(testing.posted("/api/conversations/c1/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
		await waitFor(() => expect(location.hash).toBe("#conversations/new"));
		expect(view.getByText("Start a conversation with")).toBeTruthy();
	});
	it("offers no archiving once the conversation carries on past a report, or when the task escalated", async () => {
		const view = await testing.openConversations([
			conversation({
				id: "c1",
				title: "Carried on",
				messages: [
					message("agent", "## ✅ Merged header onto main\n\nIt wraps."),
					message("user", "how far does it wrap?"),
					message("agent", "To two lines."),
				],
			}),
			conversation({
				id: "c2",
				title: "Escalated",
				messages: [
					message(
						"agent",
						"## ⚠️ Escalated footer: needs a call on the color\n\nIt is gray.",
					),
				],
			}),
		]);

		await waitFor(() => view.getByText("To two lines."));
		expect(view.queryByRole("region", { name: "archive" })).toBeNull();
		await act(async () => {
			location.hash = "#conversations/c2";
		});
		await waitFor(() => view.getByRole("region", { name: "escalated footer" }));
		expect(view.queryByRole("region", { name: "archive" })).toBeNull();
	});

	it("shows a message of a checkpoint, resume, reconnect, or merge alone as a bare line", async () => {
		const view = await testing.openConversations([
			conversation({
				messages: [
					message("user", "fix the header"),
					message("user", "[ARBOR CHECKPOINT]"),
					message("agent", "Stopped before the tests."),
					message("user", "[ARBOR RESUME]"),
					message("agent", "Starting the tests."),
					message("user", "[ARBOR RECONNECT]"),
					message("agent", "Ready to merge."),
					message("user", "[ARBOR MERGE]"),
				],
			}),
		]);

		await waitFor(() => view.getAllByRole("note", { name: "arbor" }));
		const lines = view.getAllByRole("note", { name: "arbor" });
		expect(lines.map((line) => line.textContent)).toEqual([
			"Checkpoint",
			"Resume",
			"Reconnect",
			"Merge",
		]);
		expect(lines[0]?.closest('[data-role="user"]')?.className).not.toContain(
			"sticky",
		);
		expect(lines[0]?.querySelector("p")?.title).toBe("[ARBOR CHECKPOINT]");
	});

	it("keeps a checkpoint's and a resume's lines in the turn they come in, under its stuck message", async () => {
		const view = await testing.openConversations([
			conversation({
				messages: [
					message("user", "fix the header"),
					message("agent", "Looking at it."),
					message("user", "[ARBOR CHECKPOINT]"),
					message("agent", "Stopped before the tests."),
					message("user", "[ARBOR RESUME]"),
					message("agent", "Starting the tests."),
					message("user", "and the footer"),
				],
			}),
		]);

		await waitFor(() => view.getAllByRole("note", { name: "arbor" }));
		const turns = [...document.querySelectorAll('[data-slot="aui_turn"]')];
		expect(turns.map((turn) => turn.firstElementChild?.textContent)).toEqual([
			expect.stringContaining("fix the header"),
			expect.stringContaining("and the footer"),
		]);
		const [checkpoint, resume] = view.getAllByRole("note", { name: "arbor" });
		expect(checkpoint?.closest('[data-slot="aui_turn"]')).toBe(turns[0]);
		expect(resume?.closest('[data-slot="aui_turn"]')).toBe(turns[0]);
	});

	it("shows a message of a todo, lane, or task alone as a line with its chip, opening the todo", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					messages: [
						message("user", "[ARBOR TODO #12]"),
						message("agent", "Took it."),
						message("user", "[ARBOR LANE 3]"),
						message("user", "[ARBOR TASK header]"),
						message("user", "[ARBOR HANDOFF footer]"),
						message("user", "[ARBOR LANE untriaged]"),
					],
				}),
			],
			undefined,
			{
				todos: [todo({ id: 12, subject: "Retry the upload", lane: 3 })],
				lanes: [{ id: 3, name: "Uploads" }],
			},
		);

		await waitFor(() => view.getAllByRole("note", { name: "arbor" }));
		const lines = view.getAllByRole("note", { name: "arbor" });
		expect(lines.map((line) => line.textContent)).toEqual([
			"Todo#12 Retry the upload",
			"LaneUploads",
			"Taskheader",
			"Handofffooter",
			"Untriaged lane",
		]);
		expect(lines[0]?.closest('[data-role="user"]')?.className).not.toContain(
			"sticky",
		);

		fireEvent.click(view.getByTitle("Todo #12: Retry the upload"));
		await waitFor(() =>
			expect(view.getByRole("dialog").textContent).toContain("Todo 12"),
		);
	});

	it("keeps a todo said with more as a chip", async () => {
		const view = await testing.openConversations([
			conversation({
				messages: [message("user", "[ARBOR TODO #12] but skip the tests")],
			}),
		]);

		await waitFor(() =>
			expect(view.getByTitle("[ARBOR TODO #12]")).toBeTruthy(),
		);
		expect(view.queryByRole("region", { name: "take todo #12" })).toBeNull();
	});

	it("keeps a checkpoint said with more as a chip", async () => {
		const view = await testing.openConversations([
			conversation({
				messages: [message("user", "[ARBOR CHECKPOINT] then wait")],
			}),
		]);

		await waitFor(() =>
			expect(view.getByTitle("[ARBOR CHECKPOINT]")).toBeTruthy(),
		);
		expect(view.queryByRole("region", { name: "checkpoint" })).toBeNull();
	});
});
