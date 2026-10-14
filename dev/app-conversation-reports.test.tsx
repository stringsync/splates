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

	/** Records each element scrolled into view while `run` runs, in `scrolled`. */
	const scrollingIntoView = async (
		run: (scrolled: Element[]) => Promise<void>,
	) => {
		const scrolled: Element[] = [];
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

	it("shows the task a reply says it added, with its Goal, as a card", async () => {
		await testing.openConversations([
			conversation({
				title: "Added",
				messages: [
					message("agent", "## 🌱 Added header\n\nWrap the header on phones."),
				],
			}),
		]);

		const added = await waitFor(() =>
			within(document.body).getByRole("region", { name: "added header" }),
		);
		expect(added.textContent).toContain("header");
		expect(added.textContent).toContain("Wrap the header on phones.");
	});

	it("shows a message of a checkpoint, resume, or merge alone as a card under the tree-pine", async () => {
		const view = await testing.openConversations([
			conversation({
				messages: [
					message("user", "fix the header"),
					message("user", "[ARBOR CHECKPOINT]"),
					message("agent", "Stopped before the tests."),
					message("user", "[ARBOR RESUME]"),
					message("agent", "Ready to merge."),
					message("user", "[ARBOR MERGE]"),
				],
			}),
		]);

		const checkpoint = await waitFor(() =>
			view.getByRole("region", { name: "checkpoint" }),
		);
		expect(checkpoint.textContent).toContain(
			"Asked the agent to update ARBOR.md and stop.",
		);
		expect(view.getByRole("region", { name: "resume" }).textContent).toContain(
			"Asked the agent to carry on from ARBOR.md.",
		);
		expect(checkpoint.closest('[data-role="user"]')?.className).not.toContain(
			"sticky",
		);
		expect(view.getByRole("region", { name: "merge" }).textContent).toContain(
			"Asked the agent to merge the task it had reviewed.",
		);
		for (const name of ["checkpoint", "resume", "merge"]) {
			expect(
				view.getByRole("region", { name }).querySelector(".lucide-tree-pine"),
			).not.toBeNull();
		}
		expect(view.queryByTitle("[ARBOR CHECKPOINT]")).toBeNull();
	});

	it("shows a message of a todo, lane, or task alone as a card, its chip opening the todo", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					messages: [
						message("user", "[ARBOR TODO #12]"),
						message("agent", "Took it."),
						message("user", "[ARBOR LANE 3]"),
						message("user", "[ARBOR TASK header]"),
					],
				}),
			],
			undefined,
			{
				todos: [todo({ id: 12, subject: "Retry the upload", lane: 3 })],
				lanes: [{ id: 3, name: "Uploads" }],
			},
		);

		const taken = await waitFor(() =>
			view.getByRole("region", { name: "take todo #12" }),
		);
		expect(taken.textContent).toContain("Asked the agent to take");
		expect(taken.textContent).toContain("Retry the upload");
		expect(taken.closest('[data-role="user"]')?.className).not.toContain(
			"sticky",
		);
		const lane = view.getByRole("region", { name: "work down lane 3" });
		expect(lane.textContent).toContain("Asked the agent to work down");
		expect(lane.textContent).toContain("Uploads");
		const task = view.getByRole("region", { name: "claim task header" });
		expect(task.textContent).toContain("Asked the agent to claim");
		expect(task.textContent).toContain("header");
		for (const card of [taken, lane, task]) {
			expect(card.querySelector("header .lucide-tree-pine")).not.toBeNull();
		}

		fireEvent.click(within(taken).getByTitle("[ARBOR TODO #12]"));
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
