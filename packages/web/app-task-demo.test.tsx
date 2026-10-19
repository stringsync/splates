import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import type { FinishedPlan } from "@stringsync/splates-server/tasks";
import {
	AGENTS,
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	Testing,
	waitFor,
	within,
} from "./testing";

const PLAN = `# alpha

## Goal

ship alpha

## Verification

Ran the upload tests: all pass.

![the upload done](/tmp/shots/done.webm)

## Demo

Upload a 20 MB file: before, it fails at 413; after, it lands.

## Notes

kept the old flag
`;

describe("App's task demos", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	/** Opens the Tasks page with conversations on, holding `held`. */
	const tasksPage = async (
		held: ConversationState[],
		tasks = [details({ task: "alpha", plan: PLAN, takenBy: "c1" })],
	) => {
		testing.talk = { agents: AGENTS, conversations: held };
		const view = await testing.openTasks({ tasks });
		await waitFor(() =>
			view.getByRole("button", { name: /^(\d+|Nothing) waiting on you$/ }),
		);
		return view;
	};

	/** Opens live task alpha's dialog. */
	const liveDialog = async (view: Awaited<ReturnType<typeof tasksPage>>) => {
		await act(async () =>
			fireEvent.click(
				within(view.getByRole("list", { name: "task list" })).getByRole(
					"button",
					{ name: /alpha/ },
				),
			),
		);
		return waitFor(() => view.getByRole("dialog"));
	};

	/** Opens finished task alpha's dialog, once its plan has come. */
	const finishedDialog = async (
		view: Awaited<ReturnType<typeof tasksPage>>,
	) => {
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /Finished/ })),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() =>
					within(
						view.getByRole("list", { name: "finished task list" }),
					).getByRole("button", { name: /alpha/ }),
				),
			),
		);
		const dialog = await waitFor(() => view.getByRole("dialog"));
		await waitFor(() => within(dialog).getByRole("region", { name: "demo" }));
		return dialog;
	};

	const demo = async (dialog: HTMLElement, point: string) =>
		act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: `Demo ${point}` }),
			),
		);

	const prompts = (id: string) =>
		testing
			.posted(`/api/conversations/${id}/prompt`)
			.map((post) => post.body.text);

	it("shows a task's Verification on its Overview, its recordings too, with its demo buttons", async () => {
		const view = await tasksPage([
			conversation({ id: "c1", task: "alpha", status: "stopped" }),
		]);
		const dialog = await liveDialog(view);

		const verification = within(dialog).getByRole("region", {
			name: "verification",
		});
		expect(verification.textContent).toContain("Ran the upload tests");
		// Shown as SPLATES.md media is everywhere, from the file splates holds.
		expect(verification.querySelector("video")?.getAttribute("src")).toBe(
			`/api/file?${new URLSearchParams({ path: "/tmp/shots/done.webm" })}`,
		);
		const buttons = within(
			within(dialog).getByRole("region", { name: "demo" }),
		).getAllByRole("button");
		expect(buttons.map((each) => each.textContent)).toEqual([
			"Before",
			"After",
			"Main",
		]);
		// Shown once, on the Overview, leaving the Notes tab its notes alone.
		expect(dialog.textContent?.match(/Ran the upload tests/g)).toHaveLength(1);
		expect(dialog.textContent).not.toContain("kept the old flag");
	});

	it("offers no demo for a task whose plan says none", async () => {
		const view = await tasksPage(
			[conversation({ id: "c1", task: "alpha", status: "stopped" })],
			[
				details({
					task: "alpha",
					plan: "# alpha\n\n## Goal\n\nship alpha\n",
					takenBy: "c1",
				}),
			],
		);
		const dialog = await liveDialog(view);

		expect(within(dialog).queryByRole("region", { name: "demo" })).toBeNull();
	});

	it("asks a live task's conversation for its demo, opening it at once", async () => {
		const view = await tasksPage([
			conversation({ id: "c1", task: "alpha", status: "stopped" }),
		]);
		const dialog = await liveDialog(view);

		testing.reply = conversation({ id: "c1", task: "alpha" });
		await demo(dialog, "after");

		await waitFor(() => expect(location.hash).toBe("#conversations/c1"));
		await waitFor(() =>
			expect(prompts("c1")).toEqual(["[SPLATES DEMO alpha after]"]),
		);
		expect(testing.posted("/api/conversations")).toEqual([]);
	});

	it("starts a conversation for a task whose own has moved on to another", async () => {
		testing.finished = [finished({ conversation: "c2" })];
		const view = await tasksPage(
			[conversation({ id: "c2", task: "beta", status: "stopped" })],
			[],
		);
		const dialog = await finishedDialog(view);

		testing.reply = conversation({ id: "c9", status: "starting" });
		await demo(dialog, "after");

		await waitFor(() => expect(location.hash).toBe("#conversations/c9"));
		expect(
			testing.posted("/api/conversations").map((post) => post.body.task),
		).toEqual([null]);
		await waitFor(() =>
			expect(prompts("c9")).toEqual(["[SPLATES DEMO alpha after]"]),
		);
		expect(prompts("c2")).toEqual([]);
	});

	it("asks a conversation already in one of the task's demos again", async () => {
		const view = await tasksPage([
			conversation({ id: "c1", task: "demo-alpha-before", status: "stopped" }),
		]);
		const dialog = await liveDialog(view);

		testing.reply = conversation({ id: "c1", task: "demo-alpha-before" });
		await demo(dialog, "after");

		await waitFor(() =>
			expect(prompts("c1")).toEqual(["[SPLATES DEMO alpha after]"]),
		);
		expect(testing.posted("/api/conversations")).toEqual([]);
	});

	it("puts a finished task's archived conversation back before asking it", async () => {
		testing.finished = [finished({ conversation: "c2" })];
		const view = await tasksPage(
			[conversation({ id: "c2", task: null, archived: true })],
			[],
		);
		const dialog = await finishedDialog(view);

		testing.reply = conversation({ id: "c2", task: null });
		await demo(dialog, "before");

		await waitFor(() => expect(location.hash).toBe("#conversations/c2"));
		await waitFor(() =>
			expect(prompts("c2")).toEqual(["[SPLATES DEMO alpha before]"]),
		);
		expect(testing.posted("/api/conversations/c2/archived")).toEqual([
			{ method: "PUT", body: { archived: false } },
		]);
		const order = testing.posts.map((post) => post.path);
		expect(order.indexOf("/api/conversations/c2/archived")).toBeLessThan(
			order.indexOf("/api/conversations/c2/prompt"),
		);
	});

	it("starts a conversation for a finished task whose own is gone", async () => {
		testing.finished = [finished({ conversation: "gone" })];
		const view = await tasksPage([], []);
		const dialog = await finishedDialog(view);

		testing.reply = conversation({ id: "c9", status: "starting" });
		await demo(dialog, "main");

		await waitFor(() => expect(location.hash).toBe("#conversations/c9"));
		expect(
			testing.posted("/api/conversations").map((post) => post.body.task),
		).toEqual([null]);
		await waitFor(() =>
			expect(prompts("c9")).toEqual(["[SPLATES DEMO alpha main]"]),
		);
	});
});

function finished(more: Partial<FinishedPlan> = {}): FinishedPlan {
	return {
		key: "7-1760000000000",
		id: 7,
		task: "alpha",
		subject: "ship alpha",
		ended: "merged",
		reason: null,
		base: "main",
		commit: "abc1234",
		startedAt: new Date(Date.now() - 7_200_000).toISOString(),
		endedAt: new Date(Date.now() - 3_600_000).toISOString(),
		conversation: null,
		took: [],
		plan: PLAN,
		...more,
	};
}
