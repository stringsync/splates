import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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

	it("shows a working report as a card, offering no archive while it works", async () => {
		const view = await testing.openConversations([
			conversation({
				messages: [
					message(
						"agent",
						[
							"## ⏳ Working header: on Claude Sonnet 5.5",
							"",
							"Every step is planned, so a cheaper model takes it.",
						].join("\n"),
					),
				],
			}),
		]);

		const working = await waitFor(() =>
			view.getByRole("region", { name: "working header" }),
		);
		expect(working.textContent).toContain("Working");
		expect(working.textContent).toContain("on Claude Sonnet 5.5");
		expect(working.textContent).toContain("a cheaper model takes it");
		expect(view.queryByRole("region", { name: "archive" })).toBeNull();
	});

	it("shows an old ask to hand off as a line naming the agent and model", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					task: "alpha",
					messages: [message("user", "[SPLATES HANDOFF TO codex gpt-5.5]")],
				}),
			],
			"c1",
			{},
			[
				{
					id: "codex",
					name: "Codex",
					models: [{ id: "gpt-5.5", name: "GPT-5.5" }],
					settings: [],
					limits: [],
				},
			],
		);

		const line = await waitFor(() =>
			view.getByRole("note", { name: "splates" }),
		);
		expect(line.textContent).toContain("Hand off toCodex · GPT-5.5");
	});

	it("shows an old lane orchestrator's finished report as the words it wrote, with no card or archive offer", async () => {
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
						].join("\n"),
					),
				],
			}),
		]);
		const view = document.body;

		await waitFor(() =>
			expect(view.textContent).toContain("Both lanes landed."),
		);
		expect(
			within(view).queryByRole("region", { name: "finished Stats, Licensing" }),
		).toBeNull();
		expect(within(view).queryByRole("region", { name: "archive" })).toBeNull();
	});

	it.each([
		["unread", { unread: true, seen: 1 }],
		["partly read", { unread: false, read: 1 }],
		["read", { unread: false, read: 4 }],
		[
			"merged",
			{
				messages: [
					message("agent", "## ✅ Merged footer onto main\n\nIt moved."),
				],
			},
		],
		[
			"asking",
			{
				messages: [message("agent", "1. Which pages need it?\n   - [a] Todos")],
			},
		],
	])("opens the %s conversation at the bottom", async (_name, overrides) => {
		// happy-dom has no layout, so give the viewport a scrollable height.
		const height = Object.getOwnPropertyDescriptor(
			HTMLElement.prototype,
			"scrollHeight",
		);
		Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
			configurable: true,
			get: () => 1600,
		});
		try {
			const view = await testing.openConversations([
				conversation({
					messages: [
						message("user", "fix the footer"),
						message("agent", "It moved."),
						message("user", "fix the header"),
						message("agent", "It wraps."),
					],
					...overrides,
				}),
			]);
			const thread = view.container.querySelector(
				'[data-slot="aui_thread-viewport"]',
			) as HTMLElement;
			await waitFor(() => expect(thread.scrollTop).toBe(1600));
		} finally {
			Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
			Object.defineProperties(
				HTMLElement.prototype,
				height ? { scrollHeight: height } : {},
			);
		}
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

	it("shows under a merged card how its task went beside the project's usual, the gate's word and what went wrong", async () => {
		testing.landed.header = {
			outcome: {
				project: "/repo",
				task: "header",
				base: "main",
				ended: "merged",
				startedAt: "2026-10-14T09:20:00.000Z",
				endedAt: "2026-10-14T10:00:00.000Z",
				questionRounds: 0,
				reviewRounds: 0,
				failedMerges: 1,
				size: { files: 2, added: 40, removed: 3 },
				findings: [
					{ kind: "gate", reason: "conflict", at: "", files: ["header.ts"] },
					{ kind: "stopped", at: "" },
				],
				conversation: null,
				agent: null,
				model: null,
			},
			baseline: null,
		};
		const view = await testing.openConversations([
			conversation({
				messages: [
					message(
						"agent",
						"## ✅ Merged header onto main\n\nThe header wraps now.",
					),
				],
			}),
		]);

		const went = await waitFor(() =>
			within(view.getByRole("region", { name: "merged header" })).getByRole(
				"region",
				{ name: "how it went" },
			),
		);
		expect(went.textContent).toContain("+40 −3");
		expect(
			within(went).getByRole("list", { name: "gate" }).textContent,
		).toContain("Conflicted in header.ts");
		expect(
			within(went).getByRole("list", { name: "findings" }).textContent,
		).toContain("You stopped a turn");
		expect(testing.asked).toContain("/api/tasks/header/outcome");
	});

	it("shows a message of a checkpoint, resume, reconnect, or merge alone as a bare line", async () => {
		const view = await testing.openConversations([
			conversation({
				messages: [
					message("user", "fix the header"),
					message("user", "[SPLATES CHECKPOINT]"),
					message("agent", "Stopped before the tests."),
					message("user", "[SPLATES RESUME]"),
					message("agent", "Starting the tests."),
					message("user", "[SPLATES RECONNECT]"),
					message("agent", "Ready to merge."),
					message("user", "[SPLATES MERGE]"),
				],
			}),
		]);

		await waitFor(() => view.getAllByRole("note", { name: "splates" }));
		const lines = view.getAllByRole("note", { name: "splates" });
		expect(lines.map((line) => line.textContent)).toEqual([
			"Checkpoint",
			"Resume",
			"Reconnect",
			"Merge",
		]);
		expect(lines[0]?.closest('[data-role="user"]')?.className).not.toContain(
			"sticky",
		);
		expect(lines[0]?.querySelector("p")?.title).toBe("[SPLATES CHECKPOINT]");
	});

	it("keeps a checkpoint's and a resume's lines in the turn they come in, under its stuck message", async () => {
		const view = await testing.openConversations([
			conversation({
				messages: [
					message("user", "fix the header"),
					message("agent", "Looking at it."),
					message("user", "[SPLATES CHECKPOINT]"),
					message("agent", "Stopped before the tests."),
					message("user", "[SPLATES RESUME]"),
					message("agent", "Starting the tests."),
					message("user", "and the footer"),
				],
			}),
		]);

		await waitFor(() => view.getAllByRole("note", { name: "splates" }));
		const turns = [...document.querySelectorAll('[data-slot="aui_turn"]')];
		expect(turns.map((turn) => turn.firstElementChild?.textContent)).toEqual([
			expect.stringContaining("fix the header"),
			expect.stringContaining("and the footer"),
		]);
		const [checkpoint, resume] = view.getAllByRole("note", { name: "splates" });
		expect(checkpoint?.closest('[data-slot="aui_turn"]')).toBe(turns[0]);
		expect(resume?.closest('[data-slot="aui_turn"]')).toBe(turns[0]);
	});

	it("shows a message of a todo, lane, or task alone as a line with its chip, opening the todo", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					messages: [
						message("user", "[SPLATES TASK #12]"),
						message("agent", "Took it."),
						message("user", "[SPLATES LANE 3]"),
						message("user", "[SPLATES TASK header]"),
						message("user", "[SPLATES HANDOFF footer]"),
						message("user", "[SPLATES LANE untriaged]"),
					],
				}),
			],
			undefined,
			{
				todos: [todo({ id: 12, subject: "Retry the upload", lane: 3 })],
				lanes: [{ id: 3, name: "Uploads" }],
			},
		);

		await waitFor(() => view.getAllByRole("note", { name: "splates" }));
		const lines = view.getAllByRole("note", { name: "splates" });
		expect(lines.map((line) => line.textContent)).toEqual([
			"Task#12 Retry the upload",
			"LaneUploads",
			"Taskheader",
			"Handofffooter",
			"Untriaged lane",
		]);
		expect(lines[0]?.closest('[data-role="user"]')?.className).not.toContain(
			"sticky",
		);

		fireEvent.click(view.getByTitle("Task #12: Retry the upload"));
		await waitFor(() =>
			expect(view.getByRole("dialog").textContent).toContain("Task 12"),
		);
	});

	it("keeps a todo said with more as a chip", async () => {
		const view = await testing.openConversations([
			conversation({
				messages: [message("user", "[SPLATES TASK #12] but skip the tests")],
			}),
		]);

		await waitFor(() =>
			expect(view.getByTitle("[SPLATES TASK #12]")).toBeTruthy(),
		);
		expect(view.queryByRole("region", { name: "take todo #12" })).toBeNull();
	});

	it("keeps a checkpoint said with more as a chip", async () => {
		const view = await testing.openConversations([
			conversation({
				messages: [message("user", "[SPLATES CHECKPOINT] then wait")],
			}),
		]);

		await waitFor(() =>
			expect(view.getByTitle("[SPLATES CHECKPOINT]")).toBeTruthy(),
		);
		expect(view.queryByRole("region", { name: "checkpoint" })).toBeNull();
	});
});
