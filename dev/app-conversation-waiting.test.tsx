import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	type ConversationsView,
	cleanup,
	conversation,
	details,
	fireEvent,
	message,
	newestFirst,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's going to the next waiting agent", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const ask = {
		type: "permission" as const,
		id: "t1",
		at: "2026-10-11T10:00:00.000Z",
		title: "rm -rf build",
		options: [{ id: "yes", name: "Allow", kind: "allow_once" as const }],
	};

	const PLAN = `# a task

## Goal

Cap upload retries

## Done

- [x] find the retry loop

## Next

- [ ] cap retries
- [ ] tell the user

## Blocked

- [ ] 1. How many retries?
`;

	const _rows = (view: ConversationsView) =>
		within(view.getByRole("navigation", { name: "conversations" }))
			.getAllByRole("listitem")
			.map((row) => [
				row.textContent,
				within(row).queryByRole("status")?.getAttribute("aria-label") ?? null,
			]);

	it("passes over an agent asking only in its plan as it works on ⌥⌘M, though not one stopped on its questions", async () => {
		const plan = PLAN.replace(
			"- [ ] 1. How many retries?",
			"- [ ] 3. Cap at three?",
		);
		const view = await testing.openConversations(
			newestFirst([
				conversation({
					id: "c1",
					task: "alpha",
					status: "running",
					messages: [message("user", "cap the retries")],
				}),
				conversation({
					id: "c2",
					task: "beta",
					messages: [message("user", "fix the header")],
				}),
			]),
			null,
			{
				tasks: [
					details({ task: "alpha", plan }),
					details({ task: "beta", plan }),
				],
			},
		);
		await act(async () =>
			fireEvent.keyDown(document.body, {
				altKey: true,
				metaKey: true,
				code: "KeyM",
			}),
		);

		expect(location.hash).toBe("#conversations/c2");
		expect(view.queryByRole("dialog")).toBeNull();
		expect(
			view.getByRole("button", { name: /waiting on you/ }).textContent,
		).toContain("1 waiting on you");
	});

	it("goes on ⌥⌘M to the question an external agent asks as it works, on its card", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Idle" })],
			null,
			{ tasks: [details({ task: "alpha", plan: PLAN })] },
		);
		await act(async () =>
			fireEvent.keyDown(document.body, {
				altKey: true,
				metaKey: true,
				code: "KeyM",
			}),
		);

		expect(location.hash).toBe("#conversations/task/alpha");
		await waitFor(() =>
			expect(
				view
					.getByRole("region", { name: "questions for you" })
					.contains(document.activeElement),
			).toBe(true),
		);
	});

	it("goes on ⌥⌘M to what the agent asks as it works", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					task: "alpha",
					status: "running",
					messages: [message("user", "cap the retries")],
					ask,
				}),
			],
			null,
			{ tasks: [details({ task: "alpha", plan: PLAN })] },
		);
		await act(async () =>
			fireEvent.keyDown(document.body, {
				altKey: true,
				metaKey: true,
				code: "KeyM",
			}),
		);

		expect(location.hash).toBe("#conversations/c1");
		await waitFor(() =>
			expect(
				view
					.getByRole("generic", { name: "permission" })
					.contains(document.activeElement),
			).toBe(true),
		);
		expect(view.queryByRole("dialog")).toBeNull();
	});

	it("moves between rows with the arrow keys, and opens the next one waiting with ⌥⌘M", async () => {
		const view = await testing.openConversations(
			newestFirst([
				conversation({ id: "c1", title: "Runs", status: "running" }),
				conversation({ id: "c2", title: "Asks", status: "running", ask }),
				conversation({ id: "c3", title: "Broke", status: "failed" }),
			]),
			null,
		);
		const nav = view.getByRole("navigation", { name: "conversations" });
		const runs = within(nav).getByRole("button", {
			name: "Claude Runs",
		});
		runs.focus();

		await act(async () => fireEvent.keyDown(runs, { key: "ArrowDown" }));
		expect(document.activeElement?.textContent).toBe("Asks");
		// Alt+N alone types a tilde on a Mac, so it opens nothing.
		const before = location.hash;
		await act(async () =>
			fireEvent.keyDown(document.body, { altKey: true, code: "KeyN" }),
		);
		expect(location.hash).toBe(before);
		await act(async () =>
			fireEvent.keyDown(document.body, {
				altKey: true,
				metaKey: true,
				code: "KeyM",
			}),
		);
		expect(location.hash).toBe("#conversations/c2");
		await act(async () =>
			fireEvent.keyDown(document.body, {
				altKey: true,
				metaKey: true,
				code: "KeyM",
			}),
		);
		expect(location.hash).toBe("#conversations/c3");
		await act(async () =>
			fireEvent.keyDown(document.body, {
				altKey: true,
				metaKey: true,
				code: "KeyM",
			}),
		);
		expect(location.hash).toBe("#conversations/c2");
	});

	it("opens merged conversations with ⌥⌘M once none but the open one waits on you", async () => {
		const merged = (id: string) =>
			conversation({
				id,
				title: id,
				messages: [
					message("agent", "## ✅ Merged header onto main\n\nIt wraps."),
				],
			});
		await testing.openConversations(
			newestFirst([
				conversation({ id: "c1", title: "Unread", unread: true }),
				merged("c2"),
				conversation({ id: "c3", title: "Asks", status: "running", ask }),
				merged("c4"),
			]),
			null,
		);
		const press = () =>
			act(async () =>
				fireEvent.keyDown(document.body, {
					altKey: true,
					metaKey: true,
					code: "KeyM",
				}),
			);
		await press();
		expect(location.hash).toBe("#conversations/c3");
		// On the one asking, it moves on to a merged one, as from an escalated task.
		await press();
		expect(location.hash).toBe("#conversations/c4");
		// The one asking still comes first from anywhere else.
		await press();
		expect(location.hash).toBe("#conversations/c3");
	});

	it("goes round the merged conversations with ⌥⌘M, then the unread ones", async () => {
		const merged = (id: string) =>
			conversation({
				id,
				title: id,
				messages: [
					message("agent", "## ✅ Merged header onto main\n\nIt wraps."),
				],
			});
		await testing.openConversations(
			newestFirst([
				conversation({ id: "c1", title: "Unread", unread: true }),
				merged("c2"),
				conversation({ id: "c3", title: "Read" }),
				merged("c4"),
			]),
			null,
		);
		const press = () =>
			act(async () =>
				fireEvent.keyDown(document.body, {
					altKey: true,
					metaKey: true,
					code: "KeyM",
				}),
			);
		await press();
		const first = location.hash;
		expect(["#conversations/c2", "#conversations/c4"]).toContain(first);
		await press();
		expect(location.hash).not.toBe(first);
		expect(["#conversations/c2", "#conversations/c4"]).toContain(location.hash);
	});

	it("opens an unread conversation with ⌥⌘M once none waits on you or merged", async () => {
		await testing.openConversations(
			newestFirst([
				conversation({ id: "c1", title: "Read" }),
				conversation({ id: "c2", title: "Unread", unread: true }),
			]),
			null,
		);
		await act(async () =>
			fireEvent.keyDown(document.body, {
				altKey: true,
				metaKey: true,
				code: "KeyM",
			}),
		);
		expect(location.hash).toBe("#conversations/c2");
	});
});
