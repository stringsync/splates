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
	resize,
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
		resize(1024, 768);
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
			["Broke", "disconnected"],
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
				.querySelector(".lucide-git-merge"),
		).toBeTruthy();
	});

	it("shows an hourglass for a task held in the queue before its agent starts", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					title: "Queued task",
					heldForTask: 3,
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
		const stuckMark = view.getByRole("status", { name: "possibly stuck" });
		expect(stuckMark.getAttribute("title")).toStartWith(
			"Possibly stuck: no activity for ",
		);
		expect(stuckMark.querySelector(".animate-spin")).toBeNull();
		expect(stuckMark.querySelector(".text-warning")).not.toBeNull();
		expect(
			view
				.getByRole("status", { name: "working" })
				.querySelector(".animate-spin"),
		).not.toBeNull();

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
							"## 🧹 Removed footer: superseded\n\nIt moved the footer.",
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
			["Broke", "disconnected"],
			["Runs", "working"],
		]);
		expect(
			within(agentList(view)).getByRole("img", {
				name: "merged",
			}),
		).toBeDefined();
	});

	// vet-ignore simple-test-setup: only this test opens a task with a plan, which its dialog shows
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
			fireEvent.click(view.getByRole("button", { name: /^Claude alpha/ })),
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

	it("heads a conversation with its title and project, leaving its task's status to the conversation", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", task: "alpha", name: "Fix login" })],
			null,
			{ tasks: [details({ task: "alpha" })] },
		);
		await openRow(view, "Fix login");

		const title = view.getByRole("heading", { name: "Fix login" });
		expect(title.nextElementSibling?.textContent).toBe("wren");
		expect(title.parentElement?.textContent).toBe("Fix loginwren");
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
		expect(document.title).toBe("(1) wren");
	});

	it("marks stopped and failed agents with a gray unplugged icon in the sidebar and inbox", async () => {
		localStorage.clear();
		testing.everywhere = [
			{
				project: "zebra",
				repo: "zebra",
				root: "/code/zebra",
				trunk: "main",
				tasks: [],
				laneNames: [],
				worktreeRoot: "/code/worktrees",
				lanesTaken: {},
				conversations: [
					conversation({
						id: "z1",
						title: "Zebra stopped",
						status: "stopped",
					}),
				],
			},
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
		const shared = [
			conversation({
				id: "c1",
				title: "Idle stopped",
				status: "stopped",
				stoppedIdle: "2026-10-14T10:00:00.000Z",
				pinned: true,
			}),
			conversation({
				id: "c2",
				title: "Restart stopped",
				status: "stopped",
			}),
			conversation({
				id: "c3",
				title: "Crashed",
				status: "failed",
				error: "exited with code 1",
			}),
			conversation({
				id: "c4",
				title: "Connected",
				status: "idle",
			}),
			conversation({
				id: "c5",
				title: "Merged stopped",
				status: "stopped",
				messages: [message("agent", "## ✅ Merged header onto main\n\nDone.")],
			}),
			conversation({
				id: "c6",
				title: "Done before failure",
				status: "failed",
				messages: [message("agent", "## ✅ Done: checked results\n\nDone.")],
			}),
			conversation({
				id: "c7",
				title: "Removed before failure",
				status: "failed",
				messages: [
					message("agent", "## 🧹 Removed footer: superseded\n\nIt moved."),
				],
			}),
		];

		const unplugged = (marks: HTMLElement[]) =>
			marks.map((mark) => {
				const icon = mark.querySelector(".lucide-unplug");
				const classes = icon?.getAttribute("class") ?? "";
				return (
					icon !== null &&
					classes.includes("text-muted-foreground") &&
					!classes.includes("text-warning")
				);
			});

		const desktop = await testing.openConversations(newestFirst(shared), null, {
			tasks: [],
		});
		const sidebar = within(agentList(desktop));
		const sidebarMarks = await sidebar.findAllByRole("status", {
			name: "disconnected",
		});
		// Idle stopped, Restart stopped, Crashed, and Zebra stopped.
		expect(unplugged(sidebarMarks)).toEqual([true, true, true, true]);
		expect(sidebar.getByRole("img", { name: "merged" })).toBeTruthy();
		expect(sidebar.getByRole("img", { name: "done" })).toBeTruthy();
		expect(sidebar.getByRole("img", { name: "removed" })).toBeTruthy();
		expect(
			sidebar
				.getByLabelText("Pinned")
				.getAttribute("class")
				?.split(" ")
				.includes("mr-2"),
		).toBe(true);

		desktop.unmount();
		resize(390, 844);
		const phone = await testing.openConversations(newestFirst(shared), null, {
			tasks: [],
		});
		const inbox = within(phone.getByRole("region", { name: "inbox" }));
		const inboxMarks = await inbox.findAllByRole("status", {
			name: "disconnected",
		});
		expect(unplugged(inboxMarks)).toEqual([true, true, true, true]);
		expect(inbox.getByRole("img", { name: "merged" })).toBeTruthy();
		expect(inbox.getByRole("img", { name: "done" })).toBeTruthy();
		expect(inbox.getByRole("img", { name: "removed" })).toBeTruthy();
	});

	it("shows gray dots ahead of disconnected for waiting conversations in the sidebar and inbox", async () => {
		localStorage.clear();
		const deadline = new Date(Date.now() + 4 * 3_600_000).toISOString();
		const signalWait = {
			id: "w1",
			name: "mdom.released",
			description: "mdom",
			state: "waiting" as const,
			startedAt: "2026-10-14T10:00:00.000Z",
			deadline,
			since: null,
		};
		testing.everywhere = [
			{
				project: "zebra",
				repo: "zebra",
				root: "/code/zebra",
				trunk: "main",
				tasks: [],
				laneNames: [],
				worktreeRoot: "/code/worktrees",
				lanesTaken: {},
				conversations: [
					conversation({
						id: "z1",
						title: "Zebra waiting",
						status: "stopped",
						signals: [signalWait],
					}),
				],
			},
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
		const shared = [
			conversation({
				id: "c1",
				title: "Signal stopped",
				status: "stopped",
				stoppedIdle: "2026-10-14T10:00:00.000Z",
				pinned: true,
				signals: [signalWait],
			}),
			conversation({
				id: "c2",
				title: "Task wait stopped",
				status: "stopped",
				messages: [message("agent", "Waiting.\n[SPLATES WAIT task upstream]")],
			}),
			conversation({
				id: "c3",
				title: "Deferred stopped",
				status: "stopped",
				messages: [
					message(
						"agent",
						"## ⏸ Deferred upload-retry: waiting on #812\n\nWaiting.",
					),
				],
			}),
			conversation({
				id: "c4",
				title: "Idle stopped",
				status: "stopped",
			}),
		];

		const grayDots = (marks: HTMLElement[]) =>
			marks.map((mark) => {
				const icon = mark.querySelector(".mark-ellipsis");
				const classes = icon?.getAttribute("class") ?? "";
				return (
					icon !== null &&
					classes.includes("text-muted-foreground") &&
					!classes.includes("text-warning")
				);
			});

		const desktop = await testing.openConversations(newestFirst(shared), null, {
			tasks: [],
		});
		const sidebar = within(agentList(desktop));
		const waitingSidebar = await sidebar.findAllByRole("status", {
			name: "waiting",
		});
		// Signal stopped, Task wait stopped, and Zebra waiting.
		expect(grayDots(waitingSidebar)).toEqual([true, true, true]);
		expect(grayDots([sidebar.getByRole("img", { name: "deferred" })])).toEqual([
			true,
		]);
		expect(
			sidebar.getAllByRole("status", { name: "disconnected" }),
		).toHaveLength(1);
		expect(
			sidebar
				.getByLabelText("Pinned")
				.getAttribute("class")
				?.split(" ")
				.includes("mr-2"),
		).toBe(true);

		desktop.unmount();
		resize(390, 844);
		const phone = await testing.openConversations(newestFirst(shared), null, {
			tasks: [],
		});
		const inbox = within(phone.getByRole("region", { name: "inbox" }));
		const waitingInbox = await inbox.findAllByRole("status", {
			name: "waiting",
		});
		expect(grayDots(waitingInbox)).toEqual([true, true, true]);
		expect(grayDots([inbox.getByRole("img", { name: "deferred" })])).toEqual([
			true,
		]);
		expect(inbox.getAllByRole("status", { name: "disconnected" })).toHaveLength(
			1,
		);
	});
});
