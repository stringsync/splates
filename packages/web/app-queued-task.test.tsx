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

	it("shows the task as a card, with the agent that will work it", async () => {
		const view = await open("Waits for an agent");
		const card = await view.findByRole("article", { name: "Task #2" });

		expect(within(card).getByText("Waits for an agent")).toBeTruthy();
		expect(within(card).getByTestId("assignee").textContent).toContain(
			"Claude · haiku will work this",
		);
		expect(view.getByRole("status", { name: "Queued" })).toBeTruthy();
	});

	it("says what blocks a task, and how far along each blocker is", async () => {
		const view = await open("Needs the third");
		const card = await view.findByRole("article", { name: "Task #1" });
		const blocked = view.getByRole("alert", { name: "Blocked" });

		expect(
			within(card).getByText("Check the licenses when the app starts."),
		).toBeTruthy();
		expect(within(card).getByText("Blocked")).toBeTruthy();
		expect(within(blocked).getByText("Not queued yet")).toBeTruthy();
		expect(within(blocked).getByText("not queued")).toBeTruthy();
		expect(within(card).getByTestId("assignee").textContent).toContain(
			"Any agent",
		);
	});

	it("takes what is sent in the thread's own composer as more for the task", async () => {
		const view = await open("Waits for an agent");
		const box = await view.findByRole("textbox", { name: "Message input" });

		await typeIn(box, "Mind the retry limit.");
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Send message" })),
		);

		await waitFor(() => expect(testing.posted("/api/todos/2")).toHaveLength(1));
		const [sent] = testing.posted("/api/todos/2");
		expect(sent?.method).toBe("PATCH");
		expect(sent?.body).toMatchObject({ subject: "Waits for an agent" });
		expect(sent?.body).toMatchObject({
			text: expect.stringMatching(
				/^\*\*Added while queued, .+:\*\*\n\nMind the retry limit\.$/,
			),
		});
	});
});
