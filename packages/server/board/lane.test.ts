import { describe, expect, it } from "bun:test";
import { color } from "webappwiz/log";
import { Duration } from "webappwiz/time";
import { merge } from "../merge";
import { ASKED_QUIET } from "../plans";
import { add, taskWait } from "../tasks";
import { Testing } from "../testing";
import { seed, sound2score } from "./example";
import { laneAdd, laneList, laneRemove, laneShow, laneUpdate } from "./lane";
import { lanes } from "./lanes";
import { taskAdd, taskRemove, taskUpdate } from "./task-edit";
import { taskList, taskShow } from "./task-list";

/** Each lane's task ids, top first, as stored. */
async function shape(deps: Testing): Promise<number[][]> {
	const states = (await deps.tasks.all()).map((task) => task.state);
	return lanes(states, await deps.tasks.lanes())
		.filter((found) => found.id !== 0)
		.map((found) => found.todos.map((task) => task.id));
}

/** Lands `task` with a commit, from its worktree. */
async function land(deps: Testing, task: string): Promise<void> {
	const worktree = (await deps.service.find(task)).path;
	await deps.commit(worktree, `${task}.txt`, `${task}\n`, task);
	await deps.finish(worktree);
	await merge(deps, worktree);
	deps.ps.cd(deps.root);
}

describe.concurrent("task links and lanes", () => {
	it("adds a task after others, and lists only the ready ones", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "store licenses", null);
		await taskAdd(deps, "check them", null, { blockedBy: [1] });
		await taskAdd(deps, "unrelated", null);

		deps.log.clear();
		await taskList(deps, { json: true, ready: true });

		expect(
			JSON.parse(deps.out()).map((task: { id: number }) => task.id),
		).toEqual([1, 3]);
		expect((await deps.tasks.find(2)).blockedBy).toEqual([1]);
		await expect(
			taskAdd(deps, "after nothing", null, { blockedBy: [9] }),
		).toBail("not_found");
	});

	it("links and unlinks in one command each, refusing a loop by name", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "a", null);
		await taskAdd(deps, "b", null, { blockedBy: [1] });
		await taskAdd(deps, "c", null, { blockedBy: [2] });

		await expect(taskUpdate(deps, 1, { blockedBy: [3] })).toBail("cycle", {
			message: "#1 → #2 → #3 → #1",
		});
		await expect(taskUpdate(deps, 1, { blockedBy: [1] })).toBail("cycle");
		await taskUpdate(deps, 3, { blockedBy: [1] });
		expect((await deps.tasks.find(3)).blockedBy).toEqual([1, 2]);
		await taskUpdate(deps, 3, { removeBlockedBy: [2] });
		expect((await deps.tasks.find(3)).blockedBy).toEqual([1]);
		await expect(taskUpdate(deps, 3, { removeBlockedBy: [2] })).toBail(
			"not_found",
		);
	});

	it("leaves no link to a task once it goes, by merge or by remove", async () => {
		await using deps = await Testing.open();
		await seed(deps.tasks, sound2score());

		await taskRemove(deps, 187);
		await add(deps, "gate", { tasks: [191] });
		await land(deps, "gate");
		await add(deps, "check", { tasks: [177] });
		await land(deps, "check");

		const all = (await deps.tasks.all()).map((task) => task.state);
		const ids = new Set(all.map((task) => task.id));
		expect(
			all.flatMap((task) => task.blockedBy).every((id) => ids.has(id)),
		).toBe(true);
		expect((await deps.tasks.find(196)).blockedBy).toEqual([]);
		expect((await deps.tasks.find(186)).blockedBy).toEqual([]);
	});

	it("takes a task before what blocks it lands, warning", async () => {
		await using deps = await Testing.open();
		await seed(deps.tasks, sound2score());

		await add(deps, "early", { tasks: [191] });
		expect((await deps.tasks.find(191)).takenBy).toBe("early");
		expect(deps.out()).toContain(
			"task 191 is blocked by task 187 (lane 1, open), which has yet to merge",
		);
		expect(deps.out()).toContain("splates task wait 187");
		await add(deps, "check", { tasks: [177] });
		expect(deps.out()).toContain(
			"task 177 is blocked by task 191 (lane 1, taken by early)",
		);
	});

	it("shows what blocks a task, what it blocks, and what it mentions", async () => {
		await using deps = await Testing.open();
		await seed(deps.tasks, sound2score());
		await taskRemove(deps, 187);
		deps.log.clear();

		await taskShow(deps, 177);

		const out = color.strip(deps.out());
		expect(out).toContain("lane:      1 Licensing, step 2 of 5");
		expect(out).toContain(
			"blocked by: #191 Check the license on every transcription (lane 1)",
		);
		expect(out).toContain(
			"blocking:  #186 Show the license tier on the account page (lane 2)",
		);
		expect(out).toContain("mentions:  #187, gone: merged or removed");
	});

	it("waits for a queued task to land, whichever task takes it", async () => {
		await using deps = await Testing.open();
		await seed(deps.tasks, sound2score());
		await add(deps, "store", { tasks: [187] });

		const waiting = taskWait(deps, 187, { poll: Duration.ms(20) });
		await land(deps, "store");
		await waiting;

		expect(color.strip(deps.out())).toContain("task 187 landed or was removed");
		await expect(
			taskWait(deps, 191, { timeout: Duration.ms(30), poll: Duration.ms(10) }),
		).toBail("timeout");
	});

	it("stops waiting when the task holding the queued task waits on a person", async () => {
		await using deps = await Testing.open();
		await seed(deps.tasks, sound2score());
		await add(deps, "store", { tasks: [187] });
		await deps.fs.write(
			`${(await deps.service.find("store")).path}/SPLATES.md`,
			"# store\n\n## Goal\n\nship it\n\n## Blocked\n\n- [ ] 1. Which table?\n",
		);

		await taskWait(deps, 187, {
			poll: Duration.ms(10),
			now: () => Date.now() + ASKED_QUIET.ms,
		});

		const out = color.strip(deps.out());
		expect(out).toContain("with store, which waits on a person");
		expect(out).toContain("asks: Which table?");
	});

	it("reshapes lanes: move, reorder, join and drop, never out of order", async () => {
		await using deps = await Testing.open();
		await seed(deps.tasks, sound2score());

		await taskUpdate(deps, 209, { lane: 3 });
		expect((await shape(deps))[2]).toEqual([207, 211, 201, 206, 198, 209]);
		await deps.tasks.arrange(209, 3, { before: 207 });
		expect((await shape(deps))[2]).toEqual([209, 207, 211, 201, 206, 198]);
		await expect(deps.tasks.arrange(196, 1, { before: 177 })).toBail("usage", {
			message: "task 196 comes after task 177 in lane 1",
		});
		await expect(
			taskUpdate(deps, 177, {
				position: (await deps.tasks.find(196)).position,
			}),
		).toBail("usage");

		await deps.tasks.joinLanes(3, 2);
		expect(await shape(deps)).toEqual([
			[187, 191, 177, 196, 197, 184],
			[200, 186, 208, 189, 209, 207, 211, 201, 206, 198],
		]);
		await taskUpdate(deps, 209, { lane: "new" });
		// Lane 3 is never handed out again.
		expect((await deps.tasks.find(209)).lane).toBe(4);
		await deps.tasks.dropLane(4);
		expect(await shape(deps)).toEqual([
			[187, 191, 177, 196, 197, 184],
			[200, 186, 208, 189, 207, 211, 201, 206, 198],
		]);
		await taskUpdate(deps, 197, { lane: "new" });
		expect((await deps.tasks.find(197)).lane).toBe(5);
	});

	it("names a lane started for a task, refusing a name another lane has", async () => {
		await using deps = await Testing.open();
		await seed(deps.tasks, sound2score());

		await expect(deps.tasks.arrange(209, "new", { name: "licensing" })).toBail(
			"exists",
		);
		await deps.tasks.arrange(209, "new", { name: "Retries" });

		const lane = (await deps.tasks.find(209)).lane;
		expect(
			(await deps.tasks.lanes()).find((each) => each.id === lane)?.name,
		).toBe("Retries");
	});

	it("moves a follower down when a link puts it above what it waits on", async () => {
		await using deps = await Testing.open();
		await seed(deps.tasks, sound2score());

		await taskUpdate(deps, 197, { blockedBy: [184] });

		expect((await shape(deps))[0]).toEqual([187, 191, 177, 196, 184, 197]);
	});

	it("lists lanes and shows one step by step, saying what blocks it", async () => {
		await using deps = await Testing.open();
		await seed(deps.tasks, sound2score());
		await add(deps, "decoder", { tasks: [200] });
		deps.ps.cd(deps.root);
		deps.log.clear();

		await laneList(deps);
		await laneShow(deps, 2);

		const out = color.strip(deps.out());
		expect(out).toMatch(
			/2\s+Audio, uploads and pricing\s+200,209,186,208,189\s+decoder\s+209\n/,
		);
		expect(out).toContain(
			"3. #186 Show the license tier on the account page  (blocked by #177 in Licensing)",
		);
		expect(out).toContain(
			"next: `splates queue add 209 186 208 189` queues them",
		);
		await expect(laneShow(deps, 9)).toBail("not_found");
	});

	it("shows the untriaged tasks and how to place them in lanes", async () => {
		await using deps = await Testing.open();
		await seed(
			deps.tasks,
			sound2score().map((task) =>
				task.id === 198 || task.id === 201
					? { ...task, lane: null, blockedBy: task.id === 201 ? [177] : [] }
					: task,
			),
		);
		deps.log.clear();

		await laneShow(deps, null);

		const out = color.strip(deps.out());
		expect(out).toContain("untriaged: 2 tasks in no lane");
		expect(out).toContain("2. #198 Detect tempo in swing rhythms");
		expect(out).toContain(
			"1. #201 Rename the export menu  (blocked by #177 in Licensing)",
		);
		expect(out).toContain(
			"next: place each in a lane, if one fits, linking what blocks each:",
		);
		expect(out).toContain("splates task update <id> --lane new");

		await taskUpdate(deps, 198, { lane: 3 });
		await taskUpdate(deps, 201, { lane: 3 });
		deps.log.clear();
		await laneShow(deps, null);
		expect(color.strip(deps.out())).toContain("Nothing to place.");
	});

	it("goes on down the lane after a merge, waiting on another lane when it must", async () => {
		await using deps = await Testing.open();
		await seed(deps.tasks, sound2score());
		await add(deps, "decoder", { tasks: [200] });
		deps.log.clear();

		await land(deps, "decoder");
		expect(color.strip(deps.out())).toContain(
			"next in lane 2 Audio, uploads and pricing task 209: Retry failed uploads",
		);

		await add(deps, "retries", { tasks: [209] });
		deps.log.clear();
		await land(deps, "retries");
		const out = color.strip(deps.out());
		expect(out).toContain(
			"next in lane 2 Audio, uploads and pricing task 186: Show the license tier on the account page",
		);
		expect(out).toContain(
			"blocked by #177 in Licensing, not taken yet: splates task wait 177",
		);
	}, 20_000);

	it("says a lane is done once its last task lands, and the lane goes", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "only step", null, { lane: "new" });
		await taskAdd(deps, "elsewhere", null);
		await add(deps, "only", { tasks: [1] });
		deps.log.clear();

		await land(deps, "only");

		const out = color.strip(deps.out());
		expect(out).toContain("lane 1 only step is done");
		expect(out).toContain("next task 2: elsewhere");
		expect(await deps.tasks.lanes()).toEqual([{ id: 0, name: "Backlog" }]);
		expect(await deps.tasks.laneNames()).toEqual([
			{ id: 0, name: "Backlog" },
			{ id: 1, name: "only step" },
		]);
	});

	it("keeps the name of every lane there has been, as it was last called", async () => {
		await using deps = await Testing.open();
		await laneAdd(deps, "Licensing");
		await laneAdd(deps, "Billing");
		await laneUpdate(deps, 1, { name: "Licenses" });

		await deps.tasks.dropLane(1);

		expect(await deps.tasks.lanes()).toEqual([
			{ id: 0, name: "Backlog" },
			{ id: 2, name: "Billing" },
		]);
		expect(await deps.tasks.laneNames()).toEqual([
			{ id: 0, name: "Backlog" },
			{ id: 2, name: "Billing" },
			{ id: 1, name: "Licenses" },
		]);
	});

	it("keeps a lane whose last task is removed by hand, empty", async () => {
		await using deps = await Testing.open();
		await laneAdd(deps, "Licensing");
		await taskAdd(deps, "only step", null, { lane: 1 });

		await taskRemove(deps, 1);

		expect(await deps.tasks.lanes()).toEqual([
			{ id: 0, name: "Backlog" },
			{ id: 1, name: "Licensing" },
		]);
	});

	it("ends a lane whose last task an agent took is removed, done or moot", async () => {
		await using deps = await Testing.open();
		await laneAdd(deps, "Licensing");
		await taskAdd(deps, "first step", null, { lane: 1 });
		await taskAdd(deps, "last step", null, { lane: 1 });
		await add(deps, "first", { tasks: [1] });
		await add(deps, "last", { tasks: [2] });

		await taskRemove(deps, 1);
		expect(await deps.tasks.lanes()).toEqual([
			{ id: 0, name: "Backlog" },
			{ id: 1, name: "Licensing" },
		]);
		deps.log.clear();
		await taskRemove(deps, 2);

		expect(await deps.tasks.lanes()).toEqual([{ id: 0, name: "Backlog" }]);
		expect(color.strip(deps.out())).toContain(
			"lane 1 Licensing is done: nothing is left in it, so it is gone",
		);
	});

	it("adds, renames and removes lanes, keeping an empty one, refusing a name in use", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "first", null);

		await laneAdd(deps, "  Licensing ");
		await laneAdd(deps, "Editor");
		await expect(laneAdd(deps, "licensing")).toBail("exists");
		await expect(laneAdd(deps, " ")).toBail("usage");
		await taskUpdate(deps, 1, { lane: 2 });
		await laneUpdate(deps, 2, { name: "Score editor" });
		await expect(laneUpdate(deps, 9, { name: "x" })).toBail("not_found");

		expect(await deps.tasks.lanes()).toEqual([
			{ id: 0, name: "Backlog" },
			{ id: 1, name: "Licensing" },
			{ id: 2, name: "Score editor" },
		]);
		await laneRemove(deps, 2);
		expect(await deps.tasks.all()).toEqual([]);
		expect(color.strip(deps.out())).toContain("its 1 task, kept to restore");
		await laneRemove(deps, 1);
		// Numbers are never handed out again.
		expect((await laneAdd(deps, "Again")).id).toBe(3);
	});

	it("moves a lane among the others, keeping its tasks", async () => {
		await using deps = await Testing.open();
		await laneAdd(deps, "Licensing");
		await laneAdd(deps, "Editor");
		await laneAdd(deps, "Docs");
		await taskAdd(deps, "first", null, { lane: 3 });
		const order = async () => (await deps.tasks.lanes()).map((each) => each.id);

		deps.log.clear();
		await laneUpdate(deps, 3, { position: 1 });
		expect(await order()).toEqual([0, 3, 1, 2]);
		expect(color.strip(deps.out())).toContain(
			"lanes in order: 0 Backlog, 3 Docs, 1 Licensing, 2 Editor",
		);
		await laneUpdate(deps, 3, { position: 99 });
		expect(await order()).toEqual([0, 1, 2, 3]);
		await laneUpdate(deps, 1, { name: "Licenses", position: 2 });
		expect(await deps.tasks.lanes()).toEqual([
			{ id: 0, name: "Backlog" },
			{ id: 1, name: "Licenses" },
			{ id: 2, name: "Editor" },
			{ id: 3, name: "Docs" },
		]);
		expect((await deps.tasks.find(1)).lane).toBe(3);

		await expect(laneUpdate(deps, 9, { position: 1 })).toBail("not_found");
		await expect(laneUpdate(deps, 1, { position: 0 })).toBail("usage");
		await expect(laneUpdate(deps, 0, { position: 2 })).toBail("usage");
		await expect(laneUpdate(deps, 1)).toBail("usage");
	});

	it("says which agent should work a task in a lane, keeping it until cleared", async () => {
		await using deps = await Testing.open();
		await laneAdd(deps, "Licensing");
		await taskAdd(deps, "first", null, {
			lane: 1,
			assignee: { agent: "codex" },
		});
		deps.log.clear();
		await taskShow(deps, 1);
		expect(color.strip(deps.out())).toContain("assignee:  codex");

		await taskUpdate(deps, 1, { subject: "the first" });
		expect((await deps.tasks.find(1)).state.assignee).toEqual({
			agent: "codex",
		});
		await taskUpdate(deps, 1, { assignee: null });
		expect((await deps.tasks.find(1)).state.assignee).toBeUndefined();
	});

	it("drops the agent a lane was once assigned, since lanes have none", async () => {
		await using deps = await Testing.open();
		await laneAdd(deps, "Licensing");
		await deps.writeRecord(
			"tasks/lanes",
			JSON.stringify([
				{ id: 1, name: "Licensing", assignee: { agent: "claude" } },
			]),
		);
		await laneUpdate(deps, 1, { name: "Licenses" });

		expect(await deps.tasks.lanes()).toEqual([
			{ id: 0, name: "Backlog" },
			{ id: 1, name: "Licenses" },
		]);
		expect(await deps.readRecord("tasks/lanes")).not.toContain("assignee");
	});
});
