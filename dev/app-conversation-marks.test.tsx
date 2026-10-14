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

describe("App's sidebar marks", () => {
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

	const rows = (view: ConversationsView) =>
		within(view.getByRole("navigation", { name: "conversations" }))
			.getAllByRole("listitem")
			.map((row) => [
				row.textContent,
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

	it("marks a conversation whose task merged, or whose lanes finished, green and one removed red until the person carries on, and one that escalated as waiting on you", async () => {
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
					id: "c5",
					title: "Orchestrated",
					messages: [
						message(
							"agent",
							"## 🏁 Finished lanes Stats, Licensing\n\nBoth landed.",
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
							"## ⚠️ Escalated sidebar: needs a call\n\nIt folds.",
						),
					],
				}),
			]),
			null,
			{
				tasks: [
					details({
						task: "alpha",
						status: "escalated",
						escalation: "needs a call",
						escalatedAt: "2026-10-11T10:00:00.000Z",
					}),
				],
			},
		);
		const marks = Object.fromEntries(
			within(view.getByRole("navigation", { name: "conversations" }))
				.getAllByRole("listitem")
				.map((row) => [
					row.textContent,
					(
						within(row).queryByRole("img", {
							name: /^(merged|removed|finished)$/,
						}) ?? within(row).queryByRole("status")
					)?.getAttribute("aria-label") ?? null,
				]),
		);

		expect(marks).toEqual({
			Landed: "merged",
			Dropped: "removed",
			Orchestrated: "finished",
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
		expect(view.getByRole("img", { name: "merged" })).toBeDefined();
	});

	it("heads a conversation with its branch, which opens its task", async () => {
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
		const about = view.getByRole("button", { name: "About alpha" });

		expect(about.textContent).toBe("task/alpha");
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
			{ tasks: [details({ task: "alpha", status: "escalated" })] },
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Claude Fix login" })),
		);

		const title = view.getByRole("heading", { name: "Fix login" });
		expect(title.parentElement?.textContent).toBe("Fix login");
	});

	it("counts the agents waiting on you in the title, leaving the tab to the sidebar's list", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Asks", status: "running", ask })],
			null,
			{ tasks: [details({ task: "beta", status: "escalated" })] },
		);

		expect(view.getByRole("tab", { name: /Conversations/ }).textContent).toBe(
			"Conversations",
		);
		expect(document.title).toBe("(2) webappwiz");
	});

	it("counts the agents waiting on you in the sidebar, and blinks the line when a click or ⌥⌘M finds none", async () => {
		const view = await testing.openConversations(
			newestFirst([
				conversation({ id: "c1", title: "Runs", status: "running" }),
				conversation({ id: "c2", title: "Broke", status: "failed" }),
			]),
			null,
		);
		const nav = view.getByRole("navigation", { name: "conversations" });
		// Under New, as ⌥⌘M under ⌥⌘N.
		const line = within(nav).getByRole("button", { name: /waiting on you/ });
		expect(line.previousElementSibling?.textContent).toContain("New");
		expect(line.textContent).toContain("1 waiting on you");

		await act(async () => fireEvent.click(line));
		expect(location.hash).toBe("#conversations/c2");
		expect(line.hasAttribute("data-lit")).toBe(false);

		view.unmount();
		const quiet = await testing.openConversations(
			[conversation({ id: "c1", title: "Runs", status: "running" })],
			null,
		);
		const none = quiet.getByRole("button", { name: /waiting on you/ });
		expect(none.textContent).toContain("Nothing waiting on you");
		const before = location.hash;
		await act(async () => fireEvent.click(none));
		expect(location.hash).toBe(before);
		expect(none.hasAttribute("data-lit")).toBe(true);
		await act(async () =>
			fireEvent.keyDown(document.body, {
				altKey: true,
				metaKey: true,
				code: "KeyM",
			}),
		);
		expect(location.hash).toBe(before);
		expect(none.hasAttribute("data-lit")).toBe(true);
	});
});
