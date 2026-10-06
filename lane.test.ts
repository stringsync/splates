import { describe, expect, it } from "bun:test";
import { color } from "webappwiz/log";
import { Duration } from "webappwiz/time";
import { add } from "./add";
import { escalate } from "./escalate";
import { seed, sound2score } from "./example";
import { laneAdd, laneList, laneRemove, laneShow, laneUpdate } from "./lane";
import { lanes } from "./lanes";
import { merge } from "./merge";
import { Testing } from "./testing";
import {
	todoAdd,
	todoList,
	todoRemove,
	todoShow,
	todoTake,
	todoUpdate,
} from "./todo";
import { todoWait } from "./wait";

/** Each lane's todo ids, top first, as stored. */
async function shape(deps: Testing): Promise<number[][]> {
	const states = (await deps.todos.all()).map((todo) => todo.state);
	return lanes(states, await deps.todos.lanes()).map((found) =>
		found.todos.map((todo) => todo.id),
	);
}

/** Lands `task` with a commit, from its worktree. */
async function land(deps: Testing, task: string): Promise<void> {
	const worktree = (await deps.service.find(task)).path;
	await deps.commit(worktree, `${task}.txt`, `${task}\n`, task);
	await merge(deps, worktree);
	deps.ps.cd(deps.root);
}

describe.concurrent("todo links", () => {
	it("adds a todo after others, and lists only the ready ones", async () => {
		await using deps = await Testing.open();
		await todoAdd(deps, "store licenses", null);
		await todoAdd(deps, "check them", null, { blockedBy: [1] });
		await todoAdd(deps, "unrelated", null);

		deps.log.clear();
		await todoList(deps, { json: true, ready: true });

		expect(
			JSON.parse(deps.out()).map((todo: { id: number }) => todo.id),
		).toEqual([1, 3]);
		expect((await deps.todos.find(2)).blockedBy).toEqual([1]);
		await expect(
			todoAdd(deps, "after nothing", null, { blockedBy: [9] }),
		).toBail("not_found");
	});

	it("links and unlinks in one command each, refusing a loop by name", async () => {
		await using deps = await Testing.open();
		await todoAdd(deps, "a", null);
		await todoAdd(deps, "b", null, { blockedBy: [1] });
		await todoAdd(deps, "c", null, { blockedBy: [2] });

		await expect(todoUpdate(deps, 1, { blockedBy: [3] })).toBail("cycle", {
			message: "#1 → #2 → #3 → #1",
		});
		await expect(todoUpdate(deps, 1, { blockedBy: [1] })).toBail("cycle");
		await todoUpdate(deps, 3, { blockedBy: [1] });
		expect((await deps.todos.find(3)).blockedBy).toEqual([1, 2]);
		await todoUpdate(deps, 3, { removeBlockedBy: [2] });
		expect((await deps.todos.find(3)).blockedBy).toEqual([1]);
		await expect(todoUpdate(deps, 3, { removeBlockedBy: [2] })).toBail(
			"not_found",
		);
	});

	it("leaves no link to a todo once it goes, by merge or by remove", async () => {
		await using deps = await Testing.open();
		await seed(deps.todos, sound2score());

		await todoRemove(deps, 187);
		await add(deps, "gate", { todos: [191, 177] });
		await land(deps, "gate");

		const all = (await deps.todos.all()).map((todo) => todo.state);
		const ids = new Set(all.map((todo) => todo.id));
		expect(
			all.flatMap((todo) => todo.blockedBy).every((id) => ids.has(id)),
		).toBe(true);
		expect((await deps.todos.find(196)).blockedBy).toEqual([]);
		expect((await deps.todos.find(186)).blockedBy).toEqual([]);
	});

	it("takes a todo before what blocks it lands, warning, unless taken together", async () => {
		await using deps = await Testing.open();
		await seed(deps.todos, sound2score());

		await add(deps, "early", { todos: [191] });
		expect((await deps.todos.find(191)).takenBy).toBe("early");
		expect(deps.out()).toContain(
			"todo 191 is blocked by todo 187 (lane 1, open), which has yet to merge",
		);
		expect(deps.out()).toContain("arbor todo wait 187");
		await add(deps, "both", { todos: [177, 196] });
		expect(deps.out()).toContain(
			"todo 177 is blocked by todo 191 (lane 1, taken by early)",
		);
		expect(deps.out()).not.toContain("todo 196 is blocked");
		await add(deps, "editor", { todos: [207] });
		deps.ps.cd((await deps.service.find("editor")).path);
		await todoTake(deps, [186], "editor");
		expect(deps.out()).toContain(
			"todo 186 is blocked by todo 177 (lane 1, taken by both)",
		);
	});

	it("shows what blocks a todo, what it blocks, and what it mentions", async () => {
		await using deps = await Testing.open();
		await seed(deps.todos, sound2score());
		await todoRemove(deps, 187);
		deps.log.clear();

		await todoShow(deps, 177);

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

	it("waits for a todo to land, whichever task takes it", async () => {
		await using deps = await Testing.open();
		await seed(deps.todos, sound2score());
		await add(deps, "store", { todos: [187] });

		const waiting = todoWait(deps, 187, { poll: Duration.ms(20) });
		await land(deps, "store");
		await waiting;

		expect(color.strip(deps.out())).toContain("todo 187 landed or was removed");
		await expect(
			todoWait(deps, 191, { timeout: Duration.ms(30), poll: Duration.ms(10) }),
		).toBail("timeout");
	});

	it("stops waiting when the task with the todo is escalated", async () => {
		await using deps = await Testing.open();
		await seed(deps.todos, sound2score());
		await add(deps, "store", { todos: [187] });
		await escalate(deps, "which table?", deps.ps.cwd(), { task: "store" });

		await todoWait(deps, 187, { poll: Duration.ms(10) });

		expect(color.strip(deps.out())).toContain("with store, which is escalated");
	});
});

describe.concurrent("lanes", () => {
	it("reshapes lanes: move, reorder, join and drop, never out of order", async () => {
		await using deps = await Testing.open();
		await seed(deps.todos, sound2score());

		await todoUpdate(deps, 209, { lane: 3 });
		expect((await shape(deps))[2]).toEqual([207, 211, 201, 206, 198, 209]);
		await deps.todos.arrange(209, 3, { before: 207 });
		expect((await shape(deps))[2]).toEqual([209, 207, 211, 201, 206, 198]);
		await expect(deps.todos.arrange(196, 1, { before: 177 })).toBail("usage", {
			message: "todo 196 comes after todo 177 in lane 1",
		});
		await expect(
			todoUpdate(deps, 177, {
				position: (await deps.todos.find(196)).position,
			}),
		).toBail("usage");

		await deps.todos.joinLanes(3, 2);
		expect(await shape(deps)).toEqual([
			[187, 191, 177, 196, 197, 184],
			[200, 186, 208, 189, 209, 207, 211, 201, 206, 198],
		]);
		await todoUpdate(deps, 209, { lane: "new" });
		// Lane 3 is never handed out again.
		expect((await deps.todos.find(209)).lane).toBe(4);
		await deps.todos.dropLane(4);
		expect(await shape(deps)).toEqual([
			[187, 191, 177, 196, 197, 184],
			[200, 186, 208, 189, 207, 211, 201, 206, 198],
		]);
		await todoUpdate(deps, 197, { lane: "new" });
		expect((await deps.todos.find(197)).lane).toBe(5);
	});

	it("names a lane started for a todo, refusing a name another lane has", async () => {
		await using deps = await Testing.open();
		await seed(deps.todos, sound2score());

		await expect(deps.todos.arrange(209, "new", { name: "licensing" })).toBail(
			"exists",
		);
		await deps.todos.arrange(209, "new", { name: "Retries" });

		const lane = (await deps.todos.find(209)).lane;
		expect(
			(await deps.todos.lanes()).find((each) => each.id === lane)?.name,
		).toBe("Retries");
	});

	it("moves a follower down when a link puts it above what it waits on", async () => {
		await using deps = await Testing.open();
		await seed(deps.todos, sound2score());

		await todoUpdate(deps, 197, { blockedBy: [184] });

		expect((await shape(deps))[0]).toEqual([187, 191, 177, 196, 184, 197]);
	});

	it("lists lanes and shows one step by step, saying what blocks it", async () => {
		await using deps = await Testing.open();
		await seed(deps.todos, sound2score());
		await add(deps, "decoder", { todos: [200, 209] });
		deps.ps.cd(deps.root);
		deps.log.clear();

		await laneList(deps);
		await laneShow(deps, 2);

		const out = color.strip(deps.out());
		expect(out).toMatch(
			/2\s+Audio, uploads and pricing\s+200,209,186,208,189\s+decoder\s+186\s+#177 in Licensing/,
		);
		expect(out).toContain(
			"3. #186 Show the license tier on the account page  (blocked by #177 in Licensing)",
		);
		expect(out).toContain("next: todo 186, once #177 in Licensing lands");
		expect(out).toContain("arbor todo wait 177");
		await expect(laneShow(deps, 9)).toBail("not_found");
	});

	it("goes on down the lane after a merge, waiting on another lane when it must", async () => {
		await using deps = await Testing.open();
		await seed(deps.todos, sound2score());
		await add(deps, "decoder", { todos: [200] });
		deps.log.clear();

		await land(deps, "decoder");
		expect(color.strip(deps.out())).toContain(
			"next in lane 2 Audio, uploads and pricing todo 209: Retry failed uploads",
		);

		await add(deps, "retries", { todos: [209] });
		deps.log.clear();
		await land(deps, "retries");
		const out = color.strip(deps.out());
		expect(out).toContain(
			"next in lane 2 Audio, uploads and pricing todo 186: Show the license tier on the account page",
		);
		expect(out).toContain(
			"blocked by #177 in Licensing, not taken yet: arbor todo wait 177",
		);
	}, 20_000);

	it("says a lane is done once its last todo lands, and the lane goes", async () => {
		await using deps = await Testing.open();
		await todoAdd(deps, "only step", null, { lane: "new" });
		await todoAdd(deps, "elsewhere", null);
		await add(deps, "only", { todos: [1] });
		deps.log.clear();

		await land(deps, "only");

		const out = color.strip(deps.out());
		expect(out).toContain("lane 1 only step is done");
		expect(out).toContain("next todo 2: elsewhere");
		expect(await deps.todos.lanes()).toEqual([]);
	});

	it("adds, renames and removes lanes, keeping an empty one, refusing a name in use", async () => {
		await using deps = await Testing.open();
		await todoAdd(deps, "first", null);

		await laneAdd(deps, "  Licensing ");
		await laneAdd(deps, "Editor");
		await expect(laneAdd(deps, "licensing")).toBail("exists");
		await expect(laneAdd(deps, " ")).toBail("usage");
		await todoUpdate(deps, 1, { lane: 2 });
		await laneUpdate(deps, 2, { name: "Score editor" });
		await expect(laneUpdate(deps, 9, { name: "x" })).toBail("not_found");

		expect(await deps.todos.lanes()).toEqual([
			{ id: 1, name: "Licensing" },
			{ id: 2, name: "Score editor" },
		]);
		await laneRemove(deps, 2);
		expect((await deps.todos.find(1)).lane).toBeNull();
		await laneRemove(deps, 1);
		// Numbers are never handed out again.
		expect((await laneAdd(deps, "Again")).id).toBe(3);
	});

	it("moves a lane among the others, keeping its todos", async () => {
		await using deps = await Testing.open();
		await laneAdd(deps, "Licensing");
		await laneAdd(deps, "Editor");
		await laneAdd(deps, "Docs");
		await todoAdd(deps, "first", null, { lane: 3 });
		const order = async () => (await deps.todos.lanes()).map((each) => each.id);

		deps.log.clear();
		await laneUpdate(deps, 3, { position: 1 });
		expect(await order()).toEqual([3, 1, 2]);
		expect(color.strip(deps.out())).toContain(
			"lanes in order: 3 Docs, 1 Licensing, 2 Editor",
		);
		await laneUpdate(deps, 3, { position: 99 });
		expect(await order()).toEqual([1, 2, 3]);
		await laneUpdate(deps, 1, { name: "Licenses", position: 2 });
		expect(await deps.todos.lanes()).toEqual([
			{ id: 2, name: "Editor" },
			{ id: 1, name: "Licenses" },
			{ id: 3, name: "Docs" },
		]);
		expect((await deps.todos.find(1)).lane).toBe(3);

		await expect(laneUpdate(deps, 9, { position: 1 })).toBail("not_found");
		await expect(laneUpdate(deps, 1, { position: 0 })).toBail("usage");
		await expect(laneUpdate(deps, 1)).toBail("usage");
	});
});
