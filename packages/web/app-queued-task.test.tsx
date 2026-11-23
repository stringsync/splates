import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	Testing,
	todo,
	typeIn,
	waitFor,
	within,
} from "./testing";

describe("App's page for a queued task", () => {
	let testing: Testing;

	const board = {
		todos: [
			todo({
				id: 1,
				subject: "Needs the third",
				text: "Check the licenses when the app starts.",
				blockedBy: [3],
				stage: "queued",
			}),
			todo({
				id: 2,
				subject: "Waits for an agent",
				stage: "queued",
				assignee: { agent: "claude", model: "haiku" },
			}),
			todo({ id: 3, subject: "Not queued yet", stage: "available" }),
			todo({ id: 4, subject: "Ahead in line", stage: "queued" }),
			todo({
				id: 5,
				subject: "Follows the fourth",
				stage: "queued",
				blockedBy: [4],
			}),
			todo({
				id: 6,
				subject: "Follows running work",
				stage: "queued",
				blockedBy: [7],
			}),
			todo({
				id: 7,
				subject: "Already running",
				stage: "running",
				takenBy: "blocker",
			}),
		],
		lanes: [],
	};

	beforeEach(() => {
		localStorage.clear();
		testing = new Testing();
		testing.everywhere = [
			{
				project: "wren",
				repo: "wren",
				root: "/repo",
				trunk: "main",
				tasks: [],
				laneNames: [],
				worktreeRoot: "/code/worktrees",
				lanesTaken: {},
				conversations: [],
			},
		];
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	async function open(subject: string) {
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Fix login" })],
			undefined,
			board,
		);
		const queue = await waitFor(() =>
			view.getByRole("list", { name: /queue$/ }),
		);
		fireEvent.click(within(queue).getByText(subject));
		return view;
	}

	it("shows the task as a card, with no assignee or stage chip", async () => {
		const view = await open("Waits for an agent");
		const card = await view.findByRole("article", { name: "Task #2" });

		expect(within(card).getByText("Waits for an agent")).toBeTruthy();
		expect(within(card).queryByTestId("assignee")).toBeNull();
		expect(within(card).queryByRole("status")).toBeNull();
	});

	it("says what blocks a task, and how far along each blocker is", async () => {
		const view = await open("Needs the third");
		const card = await view.findByRole("article", { name: "Task #1" });
		const blocked = view.getByRole("region", { name: "Blocked" });

		expect(
			within(card).getByText("Check the licenses when the app starts."),
		).toBeTruthy();
		expect(
			within(blocked).getAllByRole("button", { name: /^Queue \d+ blockers?$/ })
				.length,
		).toBeGreaterThan(0);
	});

	it("lists the blockers of a task that can still start, with their status", async () => {
		const view = await open("Follows the fourth");
		const status = await view.findByRole("status", { name: "Queued" });
		const list = within(status).getByRole("list", { name: "Blockers" });

		expect(within(list).getByText("Ahead in line")).toBeTruthy();
		expect(within(list).getByText("queued")).toBeTruthy();
	});

	it.each([
		{ id: 2, subject: "Waits for an agent", blocked: false },
		{ id: 1, subject: "Needs the third", blocked: true },
		{ id: 5, subject: "Follows the fourth", blocked: false },
		{ id: 6, subject: "Follows running work", blocked: false },
	])(
		"starts an in-page conversation for $subject under its task card and hides the leading talk chip",
		async ({ id, subject, blocked }) => {
			const view = await open(subject);
			const box = await view.findByRole("textbox", { name: "Message input" });
			testing.reply = conversation({
				id: "c9",
				status: "idle",
				queuedTask: id,
				title: subject,
			});

			await typeIn(box, "Wait, everything else is ok");
			await act(async () =>
				fireEvent.click(view.getByRole("button", { name: "Send message" })),
			);

			await waitFor(() =>
				expect(testing.posted("/api/conversations")).toHaveLength(1),
			);
			expect(testing.posted("/api/conversations")[0]?.body).toMatchObject({
				queuedTask: id,
				title: subject,
			});
			expect(testing.posted(`/api/todos/${id}`)).toHaveLength(0);

			// Stays on the queued task's cards, Unqueue button, and live thread.
			expect(
				await view.findByRole("article", { name: `Task #${id}` }),
			).toBeTruthy();
			expect(
				view.getByRole("button", { name: "Unqueue: Unqueue" }),
			).toBeTruthy();
			expect(
				blocked
					? view.getByRole("region", { name: "Blocked" })
					: view.getByRole("status", { name: "Queued" }),
			).toBeTruthy();
			expect(await view.findByText("Wait, everything else is ok")).toBeTruthy();
			expect(view.queryByTitle(`[SPLATES TALK #${id}]`)).toBeNull();
		},
	);

	it("shows the queued task cards when opening a live queuedTask conversation directly", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c9",
					queuedTask: 1,
					title: "Needs the third",
					messages: [
						{
							role: "user",
							parts: [
								{
									type: "text",
									text: "[SPLATES TALK #1]\n\nCan we trim the scope?",
								},
							],
							plan: null,
							at: "2026-10-11T10:00:00.000Z",
							until: "2026-10-11T10:00:00.000Z",
						},
					],
				}),
			],
			undefined,
			board,
		);

		expect(await view.findByRole("article", { name: "Task #1" })).toBeTruthy();
		expect(view.getByRole("region", { name: "Blocked" })).toBeTruthy();
		expect(view.getByRole("button", { name: "Unqueue: Unqueue" })).toBeTruthy();
		expect(view.getByText("Can we trim the scope?")).toBeTruthy();
		expect(view.queryByTitle("[SPLATES TALK #1]")).toBeNull();
		// Task #1 is deduplicated from the sidebar Queue list while its live talk is open.
		const queue = view.getByRole("list", { name: /queue$/ });
		expect(within(queue).queryByText("Needs the third")).toBeNull();
	});
});
