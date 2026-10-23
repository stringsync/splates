import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	AGENTS,
	act,
	type ConversationsView,
	cleanup,
	conversation,
	details,
	fireEvent,
	openQueueRow,
	queueRow,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's external agents", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const PLAN = `# a task

## Goal

Cap upload retries

## Next

- [ ] cap retries

## Blocked

- [ ] 1. How many retries?
`;

	/** The sidebar's agents, by what each says, and its mark. */
	const sidebar = (view: ConversationsView) =>
		within(view.getByRole("navigation", { name: "conversations" }))
			.getAllByRole("listitem")
			.map((row) => [
				row.textContent,
				within(row).queryByRole("status")?.getAttribute("aria-label") ?? null,
			]);

	/** Moves the address to `hash`, as a link does. */
	const go = (hash: string) =>
		act(async () => {
			location.hash = hash;
			window.dispatchEvent(new HashChangeEvent("hashchange"));
		});

	/** The open task dialog's tab `name`, chosen. */
	const tab = async (view: ConversationsView, name: string) => {
		const dialog = await waitFor(() => view.getByRole("dialog"));
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("tab", { name: new RegExp(name) }),
			),
		);
		return dialog;
	};

	it("lists no task whose agent runs outside the page, nor counts one asking questions as waiting on you", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", task: "alpha", title: "Fix login" })],
			null,
			{
				tasks: [
					details({ task: "alpha" }),
					details({ task: "beta", lease: "held" }),
					details({ task: "delta" }),
					details({
						task: "gamma",
						lease: "held",
						activeAt: "2026-10-11T10:00:00.000Z",
						plan: PLAN,
					}),
				],
			},
		);

		// Not beta at work, delta orphaned nor gamma asking: those are the
		// Tasks page's, and gamma asks in its own session.
		expect(sidebar(view)).toEqual([["alpha", null]]);
		expect(
			view.getByRole("status", { name: "Nothing waiting on you" }),
		).toBeTruthy();
	});

	it("opens an old link to an external agent's view as its task's dialog", async () => {
		const view = await testing.openConversations([], null, {
			tasks: [details({ task: "beta", lease: "held", plan: PLAN })],
		});

		await go("#conversations/task/beta");

		expect(
			await waitFor(() => view.getByRole("dialog", { name: /beta/ })),
		).toBeTruthy();
		expect(location.hash).toBe("#conversations/task/beta");
	});

	it("marks none of an external agent's questions on the Queue page, and says only what the page knows of its agent", async () => {
		testing.talk = { agents: AGENTS, conversations: [] };
		const view = await testing.openTasks({
			tasks: [
				details({ task: "beta", lease: "held" }),
				details({
					task: "gamma",
					plan: PLAN,
					activeAt: "2026-10-11T10:00:00.000Z",
				}),
			],
		});
		expect(
			within(queueRow(view, "gamma")).queryByRole("status", {
				name: "waiting on you",
			}),
		).toBeNull();
		await openQueueRow(view, "beta");
		const dialog = await tab(view, "Details");
		expect(dialog.textContent).toContain(
			"Outside the page, running a splates command now",
		);
	});

	it("brings a session in from the dialog of a task whose agent runs outside the page, and opens it", async () => {
		testing.sessions = [
			{
				agent: "claude",
				session: "cli-1",
				title: "Fix the upload",
				updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
			},
		];
		const view = await testing.openConversations([], null, {
			tasks: [details({ task: "beta", lease: "held" })],
		});
		await go("#tasks/beta");
		const dialog = await tab(view, "Details");
		const sessions = within(dialog).getByRole("region", { name: "sessions" });
		await waitFor(() =>
			expect(sessions.textContent).toContain("Fix the upload"),
		);
		expect(sessions.textContent).toContain("5m ago");
		testing.reply = conversation({
			id: "c9",
			task: "beta",
			title: "Fix the upload",
			status: "starting",
		});

		await act(async () =>
			fireEvent.click(
				within(sessions).getByRole("button", { name: "Bring in" }),
			),
		);

		await waitFor(() => expect(location.hash).toBe("#conversations/c9"));
		expect(JSON.parse(String(testing.posts.at(-1)?.body))).toEqual({
			agent: "claude",
			session: "cli-1",
			title: "Fix the upload",
			task: "beta",
		});
		await waitFor(() =>
			expect(view.getByRole("heading", { name: "beta" })).toBeTruthy(),
		);
	});

	it("says when no session in a task's tree can be brought in", async () => {
		const view = await testing.openConversations([], null, {
			tasks: [details({ task: "beta", lease: "held" })],
		});
		await go("#tasks/beta");
		const dialog = await tab(view, "Details");

		await waitFor(() =>
			expect(
				within(dialog).getByRole("region", { name: "sessions" }).textContent,
			).toContain("None the page could bring in."),
		);
	});
});
