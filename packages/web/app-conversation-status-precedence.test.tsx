import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	cleanup,
	conversation,
	details,
	message,
	Testing,
	within,
} from "./testing";

describe("conversation status precedence", () => {
	let testing: Testing;
	beforeEach(() => {
		testing = new Testing();
	});
	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const report = message("agent", "## ✅ Merged alpha onto main\n\nFixed.");
	const background = {
		id: "b1",
		name: "Check the change",
		command: "bun check",
		subagent: null,
		state: "running" as const,
		output: "/tmp/b1.output",
	};

	it("shows only merging, then active work, then completion, then a new reply, then nothing", async () => {
		const state = conversation({
			id: "c1",
			task: "alpha",
			unread: true,
			status: "starting",
			messages: [report],
			background: [background],
		});
		const view = await testing.openConversations(
			[conversation({ id: "open" }), state],
			"open",
			{ tasks: [details({ task: "alpha", gate: "running" })] },
		);
		const sidebar = within(
			view.getByRole("navigation", { name: "conversations" }),
		);
		const marks = () =>
			sidebar
				.queryAllByRole("status")
				.map((mark) => mark.getAttribute("aria-label"));
		expect(marks()).toEqual(["merging"]);
		expect(sidebar.queryByRole("img", { name: "merged" })).toBeNull();

		// Landing removes the task, while its agent still wraps up.
		await testing.say({ ...state, task: null, status: "running" });
		expect(marks()).toEqual(["working"]);
		expect(sidebar.queryByRole("img", { name: "merged" })).toBeNull();

		const idle = { ...state, task: null, status: "idle" as const };
		await testing.say(idle);
		expect(marks()).toEqual(["background commands running"]);
		expect(sidebar.queryByRole("img", { name: "merged" })).toBeNull();

		const ended = {
			...idle,
			background: [{ ...background, state: "completed" as const }],
		};
		await testing.say(ended);
		expect(marks()).toEqual([]);
		expect(sidebar.getByRole("img", { name: "merged" })).toBeTruthy();

		const answered = {
			...ended,
			messages: [message("agent", "Here is the answer.")],
		};
		await testing.say(answered);
		expect(marks()).toEqual(["unread"]);
		expect(sidebar.queryByRole("img", { name: "merged" })).toBeNull();

		await testing.say({ ...answered, unread: false });
		expect(marks()).toEqual([]);
		expect(sidebar.queryByRole("img", { name: "merged" })).toBeNull();
	});

	it("shows running evals over an escalated report", async () => {
		const state = conversation({
			id: "c1",
			messages: [
				message("agent", "## ⚠️ Escalated alpha: needs a decision\n\nWaiting."),
			],
			background: [{ ...background, name: "Run evals" }],
		});
		const view = await testing.openConversations([state], null);
		const sidebar = within(
			view.getByRole("navigation", { name: "conversations" }),
		);

		expect(
			sidebar.getByRole("status", { name: "background commands running" }),
		).toBeTruthy();
		expect(
			sidebar.queryByRole("status", { name: "waiting on you" }),
		).toBeNull();

		await testing.say({
			...state,
			background: [{ ...background, state: "completed" as const }],
		});
		expect(
			sidebar.getByRole("status", { name: "waiting on you" }),
		).toBeTruthy();
	});

	it("keeps a completion report while a child conversation works", async () => {
		const child = conversation({
			id: "child",
			parent: { id: "host" },
			status: "running",
		});
		const view = await testing.openConversations(
			[
				conversation({
					id: "host",
					title: "Host",
					messages: [report],
					unread: true,
				}),
				child,
			],
			null,
		);
		const sidebar = within(
			view.getByRole("navigation", { name: "conversations" }),
		);
		expect(sidebar.getByRole("img", { name: "merged" })).toBeTruthy();
		expect(sidebar.getAllByRole("status", { name: "working" })).toHaveLength(1);

		await testing.say({ ...child, status: "stopped" });
		expect(sidebar.queryByRole("status", { name: "working" })).toBeNull();
		expect(sidebar.getByRole("img", { name: "merged" })).toBeTruthy();
	});

	it("keeps a completion report while a task-only child works", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "host",
					title: "Host",
					messages: [report],
				}),
			],
			null,
			{
				tasks: [
					details({
						task: "child",
						status: "working",
						caller: "host",
						takenBy: "host",
					}),
				],
			},
		);
		const sidebar = within(
			view.getByRole("navigation", { name: "conversations" }),
		);
		expect(sidebar.getByRole("img", { name: "merged" })).toBeTruthy();
		expect(sidebar.queryByRole("status", { name: "working" })).toBeNull();
	});
});
