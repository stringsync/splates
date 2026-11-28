import { describe, expect, it } from "bun:test";
import { queuedAddress } from "./conversation-address";
import { foldersOf, hereAlone } from "./project-folders";
import { blockerRowKey, resolveSidebarBlockers } from "./sidebar-blockers";
import { conversation, message, todo } from "./testing";

describe("resolveSidebarBlockers", () => {
	it("highlights conversations holding blockers when hovering a blocked queued row", () => {
		const c1 = conversation({ id: "c1", task: "upstream-a", title: "Alpha" });
		const c2 = conversation({ id: "c2", task: "unrelated", title: "Beta" });
		const c3 = conversation({ id: "c3", task: "upstream-b", title: "Gamma" });
		const todos = [
			todo({
				id: 412,
				subject: "Alpha",
				stage: "running",
				takenBy: "upstream-a",
			}),
			todo({
				id: 415,
				subject: "Gamma",
				stage: "running",
				takenBy: "upstream-b",
			}),
			todo({
				id: 418,
				subject: "Blocked work",
				stage: "queued",
				blockedBy: [412, 415],
			}),
		];
		const folders = hereAlone({
			root: "/repo",
			repo: "mono",
			trunk: "main",
			tasks: [],
			conversations: [c1, c2, c3],
			todos,
		});

		const result = resolveSidebarBlockers(folders, "c2", {
			kind: "queued",
			folder: "",
			todoId: 418,
		});

		expect([...result.conversations.entries()]).toEqual([
			[blockerRowKey("", "c1"), 412],
			[blockerRowKey("", "c3"), 415],
		]);
		expect([...result.queued.entries()]).toEqual([]);
	});

	it("keeps a selected blocked row highlighted while hovering an unblocked row, and switches when hovering another blocked row", () => {
		const c1 = conversation({ id: "c1", task: "upstream-a" });
		const c2 = conversation({ id: "c2", task: "unrelated" });
		const todos = [
			todo({
				id: 412,
				subject: "Alpha",
				stage: "running",
				takenBy: "upstream-a",
			}),
			todo({
				id: 418,
				subject: "First blocked",
				stage: "queued",
				blockedBy: [412],
			}),
			todo({
				id: 419,
				subject: "Chained blocked",
				stage: "queued",
				blockedBy: [418],
			}),
		];
		const folders = hereAlone({
			root: "/repo",
			repo: "mono",
			trunk: "main",
			tasks: [],
			conversations: [c1, c2],
			todos,
		});

		const overUnblocked = resolveSidebarBlockers(folders, queuedAddress(418), {
			kind: "conversation",
			folder: "",
			conversationId: "c2",
		});
		expect([...overUnblocked.conversations.entries()]).toEqual([
			[blockerRowKey("", "c1"), 412],
		]);
		expect(overUnblocked.source).toEqual({
			kind: "queued",
			folder: "",
			todoId: 418,
		});

		const overOtherBlocked = resolveSidebarBlockers(
			folders,
			queuedAddress(418),
			{ kind: "queued", folder: "", todoId: 419 },
		);
		expect([...overOtherBlocked.conversations.entries()]).toEqual([]);
		expect([...overOtherBlocked.queued.entries()]).toEqual([
			[blockerRowKey("", 418), 418],
		]);
		expect(overOtherBlocked.source).toEqual({
			kind: "queued",
			folder: "",
			todoId: 419,
		});
	});

	it("resolves held and deferred conversations as both blocked sources and blocker holders", () => {
		const heldBlocker = conversation({
			id: "c-held",
			heldForTask: 10,
			title: "Held blocker",
		});
		const deferred = conversation({
			id: "c-deferred",
			title: "Deferred child",
			messages: [
				message(
					"agent",
					"## ⏸ Blocked child-task: waiting on #10\n\nNeeds #10 first.",
				),
			],
		});
		const todos = [
			todo({ id: 10, subject: "Upstream", stage: "queued" }),
			todo({
				id: 20,
				subject: "Child",
				stage: "queued",
				slug: "child-task",
				blockedBy: [10],
				deferred: {
					task: "child-task",
					why: "Needs #10",
					at: "2026-01-01T00:00:00Z",
					tasks: [{ id: 10, subject: "Upstream" }],
					questions: [],
					outside: [],
				},
			}),
		];
		const folders = hereAlone({
			root: "/repo",
			repo: "mono",
			trunk: "main",
			tasks: [],
			conversations: [heldBlocker, deferred],
			todos,
		});

		const result = resolveSidebarBlockers(folders, "c-deferred", null);

		expect([...result.conversations.entries()]).toEqual([
			[blockerRowKey("", "c-held"), 10],
		]);
	});

	it("matches cross-project blockers in another folder", () => {
		const otherConv = conversation({
			id: "c-other",
			task: "shared-lib",
			title: "Shared lib",
		});
		const otherTodo = todo({
			id: 77,
			subject: "Shared lib",
			stage: "running",
			takenBy: "shared-lib",
		});
		const hereTodo = todo({
			id: 99,
			subject: "Consumer",
			stage: "queued",
			blockedElsewhere: [
				{
					project: "/other",
					id: 77,
					subject: "Shared lib",
				},
			],
		});
		const folders = foldersOf(
			[
				{
					project: "app",
					repo: "app",
					root: "/app",
					trunk: "main",
					laneNames: [],
					worktreeRoot: "/wt/app",
					lanesTaken: {},
					todos: [hereTodo],
					queueError: null,
				},
				{
					project: "core",
					repo: "core",
					root: "/other",
					trunk: "main",
					laneNames: [],
					worktreeRoot: "/wt/core",
					lanesTaken: {},
					todos: [otherTodo],
					queueError: null,
				},
			],
			[],
			[{ ...otherConv, project: "core" }],
			{
				root: "/app",
				repo: "app",
				trunk: "main",
				tasks: [],
				conversations: [],
				todos: [hereTodo],
			},
		);

		const result = resolveSidebarBlockers(folders, queuedAddress(99), null);

		expect([...result.conversations.entries()]).toEqual([
			[blockerRowKey("core", "c-other"), 77],
		]);
	});
});
