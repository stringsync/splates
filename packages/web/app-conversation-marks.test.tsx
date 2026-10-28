import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	agentList,
	type ConversationsView,
	cleanup,
	clickShown,
	conversation,
	details,
	fireEvent,
	message,
	newestFirst,
	openRow,
	second,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's marks on its agents", () => {
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

	/** The sidebar's rows, where every agent is. */
	const items = (view: ConversationsView) =>
		within(agentList(view)).getAllByRole("listitem");

	/** A row's name, first of what it truncates. */
	const nameOf = (row: HTMLElement) =>
		row.querySelector("span.truncate")?.textContent;

	const rows = (view: ConversationsView) =>
		items(view).map((row) => [
			nameOf(row),
			within(row).queryByRole("status")?.getAttribute("aria-label") ?? null,
		]);

	it("marks each agent waiting on you or working, and an idle one not at all", async () => {
		const view = await testing.openConversations(
			newestFirst([
				conversation({ id: "c1", title: "Asks", status: "running", ask }),
				conversation({ id: "c2", title: "Runs", status: "running" }),
				conversation({ id: "c3", title: "Rests" }),
				conversation({ id: "c4", title: "Broke", status: "failed" }),
				conversation({ id: "c5", task: "alpha", title: "Plans" }),
			]),
			null,
		);

		expect(rows(view)).toEqual([
			["Asks", "waiting on you"],
			["Runs", "working"],
			["Rests", null],
			["Broke", "waiting on you"],
			["alpha", null],
		]);
	});

	it("marks an agent whose task is landing as merging", async () => {
		const view = await testing.openConversations(
			newestFirst([
				conversation({
					id: "c1",
					task: "alpha",
					title: "Lands",
					status: "running",
				}),
				conversation({ id: "c2", title: "Runs", status: "running" }),
			]),
			null,
			{ tasks: [details({ task: "alpha", status: "merging" })] },
		);

		expect(rows(view)).toEqual([
			["alpha", "merging"],
			["Runs", "working"],
		]);
		const [lands, runs] = items(view);
		expect(lands?.innerHTML).toContain('aria-label="merging"');
		expect(runs?.innerHTML).not.toContain('aria-label="merging"');
	});

	it("marks a testing merge as merging and a queued merge with an hourglass", async () => {
		const view = await testing.openConversations(
			newestFirst([
				conversation({
					id: "c1",
					task: "alpha",
					title: "Tests",
					status: "running",
				}),
				conversation({
					id: "c2",
					task: "beta",
					title: "Waits",
					status: "running",
				}),
			]),
			null,
			{
				tasks: [
					details({ task: "alpha", gate: "running" }),
					details({ task: "beta", gate: "queued" }),
				],
			},
		);

		expect(rows(view)).toEqual([
			["alpha", "merging"],
			["beta", "waiting to merge"],
		]);
		expect(
			view
				.getByRole("status", { name: "waiting to merge" })
				.querySelector(".lucide-hourglass"),
		).toBeTruthy();
	});

	it("shows an hourglass for a task held in the queue before its agent starts", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					title: "Queued task",
					queued: 3,
					status: "stopped",
				}),
			],
			null,
		);
		const mark = within(agentList(view)).getByRole("status", {
			name: "queued",
		});
		expect(mark.querySelector(".lucide-hourglass")).toBeTruthy();
		expect(
			within(agentList(view)).queryByRole("status", { name: "working" }),
		).toBeNull();
	});

	it("marks an agent quiet long enough to be stuck, and stops its turn from its menu", async () => {
		const quiet = {
			...message("agent", "Looking."),
			at: second(0),
			until: second(1),
		};
		const view = await testing.openConversations(
			newestFirst([
				conversation({
					id: "c1",
					title: "Quiet",
					status: "running",
					messages: [quiet],
				}),
				conversation({
					id: "c2",
					title: "Busy",
					status: "running",
					messages: [{ ...quiet, until: new Date().toISOString() }],
				}),
			]),
			null,
		);
		expect(rows(view)).toEqual([
			["Quiet", "possibly stuck"],
			["Busy", "working"],
		]);
		expect(
			view
				.getByRole("status", { name: "possibly stuck" })
				.getAttribute("title"),
		).toStartWith("Possibly stuck: no activity for ");

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "More for Busy" })),
		);
		expect(view.queryByRole("menuitem", { name: "Stop turn" })).toBeNull();
		await act(async () =>
			fireEvent.keyDown(document.activeElement ?? document.body, {
				key: "Escape",
			}),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "More for Quiet" })),
		);
		await clickShown(() => view.getByRole("menuitem", { name: "Stop turn" }));
		expect(testing.posted("/api/conversations/c1/cancel")).toHaveLength(1);
		// Stopped once the server says so, not before.
		expect(rows(view)).toEqual([
			["Quiet", "possibly stuck"],
			["Busy", "working"],
		]);
	});

	it("marks a conversation whose task merged green and one removed red until the person carries on, and one that asks as waiting on you", async () => {
		const view = await testing.openConversations(
			newestFirst([
				conversation({
					id: "c1",
					title: "Landed",
					messages: [
						message("agent", "## ✅ Merged header onto main\n\nIt wraps."),
					],
				}),
				conversation({
					id: "c2",
					title: "Dropped",
					messages: [
						message(
							"agent",
							"## 🛑 Removed footer: superseded\n\nIt moved the footer.",
						),
					],
				}),
				conversation({
					id: "c3",
					title: "Carried on",
					messages: [
						message("agent", "## ✅ Merged header onto main\n\nIt wraps."),
						message("user", "now the footer"),
					],
				}),
				conversation({
					id: "c4",
					task: "alpha",
					title: "Stuck",
					messages: [
						message(
							"agent",
							"It folds, once you pick how.\n\n1. Which way should it fold?",
						),
					],
				}),
			]),
			null,
			{
				tasks: [
					details({
						task: "alpha",
						plan: "# alpha\n\n## Blocked\n\n- [ ] 1. Which way should it fold?\n",
					}),
				],
			},
		);
		const marks = Object.fromEntries(
			items(view).map((row) => [
				nameOf(row),
				(
					within(row).queryByRole("img", {
						name: /^(merged|removed)$/,
					}) ?? within(row).queryByRole("status")
				)?.getAttribute("aria-label") ?? null,
			]),
		);

		expect(marks).toEqual({
			Landed: "merged",
			Dropped: "removed",
			"Carried on": null,
			alpha: "waiting on you",
		});
	});

	it("marks an agent that answered unseen with a blue dot, though not over a merge, waiting on you, or working", async () => {
		const view = await testing.openConversations(
			newestFirst([
				conversation({ id: "c1", title: "Answered", unread: true }),
				conversation({
					id: "c2",
					title: "Landed",
					unread: true,
					messages: [
						message("agent", "## ✅ Merged header onto main\n\nIt wraps."),
					],
				}),
				conversation({
					id: "c3",
					title: "Broke",
					status: "failed",
					unread: true,
				}),
				conversation({
					id: "c4",
					title: "Runs",
					status: "running",
					unread: true,
				}),
			]),
			null,
			{ tasks: [] },
		);

		expect(rows(view)).toEqual([
			["Answered", "unread"],
			["Landed", null],
			["Broke", "waiting on you"],
			["Runs", "working"],
		]);
		expect(
			within(agentList(view)).getByRole("img", {
				name: "merged",
			}),
		).toBeDefined();
	});

	// scry-ignore simple-test-setup: only this test opens a task with a plan, which its dialog shows
	it("tops a conversation's widgets with its branch, which opens its task", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					task: "alpha",
					title: "Fix login",
					status: "running",
				}),
			],
			null,
			{ tasks: [details({ task: "alpha", plan: PLAN })] },
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Claude alpha" })),
		);
		const about = within(
			view.getByRole("navigation", { name: "actions" }),
		).getByRole("button", { name: "task/alpha" });

		await act(async () => fireEvent.click(about));
		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "alpha" }),
		);
		expect(dialog.textContent).toContain("Cap upload retries");
	});

	it("heads a conversation with its title alone, leaving its task's status to the conversation", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", task: "alpha", name: "Fix login" })],
			null,
			{ tasks: [details({ task: "alpha" })] },
		);
		await openRow(view, "Fix login");

		const title = view.getByRole("heading", { name: "Fix login" });
		expect(title.parentElement?.textContent).toBe("Fix login");
	});

	it("counts the agents waiting on you in the title, as the sidebar does, an external agent's ask never", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Asks", status: "running", ask })],
			null,
			{
				tasks: [
					details({
						task: "beta",
						activeAt: "2026-10-11T10:00:00.000Z",
						plan: "# beta\n\n## Blocked\n\n- [ ] 1. Which way?\n",
					}),
				],
			},
		);

		expect(
			within(
				view.getByRole("button", { name: /^(\d+|Nothing) waiting on you$/ }),
			).getByRole("status", {
				name: "1 waiting on you",
			}),
		).toBeTruthy();
		expect(document.title).toBe("(1) webappwiz");
	});
});
