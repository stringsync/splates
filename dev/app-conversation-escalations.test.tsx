import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationState, Message } from "../conversations";
import type { Event } from "../events";
import { questions } from "../plan";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	second,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's escalation cards, drawn from the escalate event", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	/** The thread of `messages`, opened with `events`. */
	const opened = async (messages: Message[], events: Event[]) => {
		const state: ConversationState = conversation({
			title: "Header",
			messages,
			events,
		});
		const view = await testing.openConversations([state]);
		return {
			view,
			thread: await waitFor(() => view.getByRole("region", { name: "Header" })),
		};
	};

	it("asks the task's open questions in the Escalated card, though the agent wrote no report", async () => {
		const { view, thread } = await opened(
			[asked("fix the header", 0), said("Stopping here.", 1)],
			[escalated(3)],
		);

		const card = await waitFor(() =>
			view.getByRole("region", { name: "escalated header" }),
		);
		expect(card.textContent).toContain("Escalated");
		expect(card.textContent).toContain("two calls on the header");
		// Numbered from 1, as a report numbers them, whatever ARBOR.md says.
		expect(
			within(card)
				.getAllByRole("listitem", { name: /^question/ })
				.map((each) => each.getAttribute("aria-label")),
		).toEqual(["question 1", "question 2"]);
		expect(card.textContent).toContain("Which pages need it?");
		expect(card.textContent).not.toContain("Keep it?");
		expect(within(thread).queryAllByRole("note", { name: "arbor" })).toEqual(
			[],
		);
		expect(thread.textContent).toContain("Stopping here.");
	});

	it("takes in what the agent wrote of it, drawing one card", async () => {
		const { view } = await opened(
			[
				asked("fix the header", 0),
				said(
					[
						"## ⚠️ Escalated header: waiting on two calls",
						"",
						"The header wraps now.",
						"",
						"### 🎬 Demo: the header on a phone",
						"",
						"Open http://localhost:4310 at 390px wide.",
						"",
						"1. Open Todos.",
						"   The header wraps.",
						"",
						"1. Which pages need it?",
						"   - [a] Todos",
						"   - [b] Tasks",
						"2. How should a stale todo be shown?",
						"   - (a) A muted card",
						"   - (b) A badge",
					].join("\n"),
					5,
				),
			],
			[escalated(3)],
		);

		const card = await waitFor(() =>
			view.getByRole("region", { name: "escalated header" }),
		);
		expect(view.getAllByRole("region", { name: /escalated/ })).toHaveLength(1);
		expect(view.getAllByRole("list", { name: "questions" })).toHaveLength(1);
		expect(card.textContent).toContain("two calls on the header");
		expect(card.textContent).toContain("The header wraps now.");
		expect(card.textContent).toContain("the header on a phone");
		// The size is a quiet letter, its meaning on hover.
		expect(
			within(card).getByLabelText("Large call: hard to undo or outward-facing")
				.textContent,
		).toBe("L");
		expect(card.textContent).not.toContain("large");
	});

	it("puts the agent's recommended choice first, picked already", async () => {
		const { view } = await opened(
			[asked("fix the header", 0), said("Stopping here.", 1)],
			[
				{
					...escalated(3),
					questions: questions(
						[
							"## Blocked",
							"",
							"- [ ] 6. How should a stale todo be shown?",
							"  - (a) A muted card",
							"  - (b) A badge (chosen)",
						].join("\n"),
					),
				},
			],
		);

		const card = await waitFor(() =>
			view.getByRole("region", { name: "escalated header" }),
		);
		const choices = within(card).getAllByRole("button", { pressed: true });
		expect(choices.map((each) => each.textContent)).toEqual([
			"bA badgeRecommended",
		]);
		const listed = [
			...within(card)
				.getByRole("group", { name: "How should a stale todo be shown?" })
				.querySelectorAll("button[aria-pressed]"),
		].map((each) => each.textContent?.charAt(0));
		expect(listed).toEqual(["b", "a"]);
	});

	it("says why it needs the person when no question is open", async () => {
		const { view } = await opened(
			[asked("fix the header", 0), said("Stopping here.", 1)],
			[
				{
					...escalated(3),
					about: "needs access to the staging bucket",
					questions: [],
				},
			],
		);

		const card = await waitFor(() =>
			view.getByRole("region", { name: "escalated header" }),
		);
		expect(card.textContent).toContain("needs access to the staging bucket");
		expect(view.queryByRole("list", { name: "questions" })).toBeNull();
	});

	it("draws a review as the Ready to merge card, its checks from what the agent wrote, merging from it", async () => {
		const { view } = await opened(
			[
				asked("fix the header", 0),
				said(
					[
						"## 🔍 Ready to merge header onto main",
						"",
						"The header wraps on phones.",
						"",
						"Checks: `bin/wiz dev fix`, `bin/wiz dev test`",
						"",
						'Reply "merge", or say what to change.',
					].join("\n"),
					5,
				),
			],
			[
				{
					...escalated(3),
					review: true,
					about: "the header at 390px",
					questions: [],
				},
			],
		);

		const panel = await waitFor(() =>
			view.getByRole("region", { name: "review header" }),
		);
		expect(view.getAllByRole("region", { name: /^review/ })).toHaveLength(1);
		expect(panel.textContent).toContain("The header wraps on phones.");
		expect(within(panel).getByRole("region", { name: "Checks" })).toBeTruthy();

		await act(async () =>
			fireEvent.click(within(panel).getByRole("button", { name: "Merge" })),
		);
		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{ method: "POST", body: { text: "[ARBOR MERGE]" } },
		]);
	});

	it("draws a review with what to look at, though the agent wrote no report", async () => {
		const { view } = await opened(
			[asked("fix the header", 0), said("Done.", 1)],
			[
				{
					...escalated(3),
					review: true,
					about: "the header at 390px",
					questions: [],
				},
			],
		);

		const panel = await waitFor(() =>
			view.getByRole("region", { name: "review header" }),
		);
		expect(panel.textContent).toContain("the header at 390px");
		expect(within(panel).getByRole("button", { name: "Merge" })).toBeTruthy();
	});

	it("shows a review it drew, once approved, as one line in place of the Merge it sent", async () => {
		const { thread } = await opened(
			[
				asked("fix the header", 0),
				said("Ready.", 1),
				asked("[ARBOR MERGE]", 10),
			],
			[{ ...escalated(3), review: true, questions: [] }],
		);

		await waitFor(() => within(thread).getByRole("button", { name: "Show" }));
		expect(
			within(thread)
				.getAllByRole("note", { name: "arbor" })
				.map((line) => line.textContent),
		).toEqual(["Review approvedheaderShow"]);
	});

	it("draws a refused escalation as a failed line", async () => {
		const { thread } = await opened(
			[asked("fix the header", 0), said("I'll finish the steps first.", 1)],
			[
				{
					id: "e",
					at: second(3),
					action: "escalate",
					task: "header",
					reason: "blocked",
					conversation: "c1",
				},
			],
		);

		const line = await waitFor(() =>
			within(thread).getByRole("note", { name: "arbor" }),
		);
		expect(line.textContent).toBe("Escalate failedheader");
		expect(
			within(thread).queryByRole("region", { name: /escalated/ }),
		).toBeNull();
	});

	it("stands an older questions card down, taking over what was written in it", async () => {
		localStorage.setItem(
			"arbor.draft.c1:questions:1:Which pages need it?",
			"> **Which pages need it?**\n\n- (b) Tasks",
		);
		const { view } = await opened(
			[
				asked("fix the header", 0),
				said("1. Which pages need it?\n   - [a] Todos\n   - [b] Tasks", 1),
				asked("[ARBOR REPORT other]", 10),
				said("Escalating.", 11),
			],
			[escalated(12)],
		);

		const card = await waitFor(() =>
			view.getByRole("region", { name: "escalated header" }),
		);
		expect(
			within(card)
				.getByRole("button", { name: /Tasks/ })
				.getAttribute("aria-pressed"),
		).toBe("true");
		// The older card, asked again below, folds to its header.
		expect(view.getAllByRole("list", { name: "questions" })).toHaveLength(1);
		expect(within(card).getByText("1 of 2 answered")).toBeTruthy();
	});
});

/** The person's `text`, sent at `secs`. */
function asked(text: string, secs: number): Message {
	return { ...message("user", text), at: second(secs), until: second(secs) };
}

/** The agent's turn from `secs`, a minute long at most, ending on `text`. */
function said(text: string, secs: number): Message {
	return {
		...message("agent", text),
		at: second(secs),
		until: second(secs + 5),
	};
}

/** `header` escalated at `secs` with two of its three questions open. */
function escalated(secs: number): Extract<Event, { action: "escalate" }> & {
	reason: null;
} {
	return {
		id: `e${secs}`,
		at: second(secs),
		action: "escalate",
		task: "header",
		reason: null,
		conversation: "c1",
		about: "two calls on the header",
		review: false,
		base: "main",
		questions: questions(
			[
				"## Blocked",
				"",
				"- [x] 3. Keep it? → yes",
				"- [ ] 4. Which pages need it?",
				"  - [a] Todos",
				"  - [b] Tasks",
				"- [ ] 6. (large) How should a stale todo be shown?",
				"  - (a) A muted card",
				"  - (b) A badge",
			].join("\n"),
		).filter((each) => !each.done),
	};
}
