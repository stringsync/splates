import { describe, expect, it } from "bun:test";
import { color } from "webappwiz/log";
import { add } from "./add";
import { merge } from "./merge";
import { PLAN_FILE } from "./plan";
import { remove } from "./remove";
import { Testing } from "./testing";
import {
	recommend,
	type TodoState,
	todoAdd,
	todoList,
	todoRelease,
	todoRemove,
	todoShow,
	todoTake,
	todoUpdate,
} from "./todo";

const DAY = 24 * 60 * 60 * 1000;

/** Backdates a todo, since `merge` offers one waiting too long for removal. */
async function age(deps: Testing, id: number, days: number): Promise<void> {
	const todo = await deps.todos.find(id);
	await deps.todos.save({
		...todo.state,
		createdAt: new Date(Date.now() - days * DAY).toISOString(),
	});
}

/** The subjects in list order. */
async function order(deps: Testing): Promise<string[]> {
	return (await deps.todos.all()).map((todo) => todo.subject);
}

describe.concurrent("todo", () => {
	it("adds, lists and removes, never reusing a number", async () => {
		await using deps = await Testing.open();

		await todoAdd(deps, "  write the docs  ", null);
		await todoAdd(deps, "fix the flake", "alpha");
		await todoRemove(deps, 2);
		const third = await todoAdd(deps, "third", null);

		expect(third.id).toBe(3);
		deps.log.clear();
		await todoList(deps, { json: true });
		const listed = JSON.parse(deps.out());
		expect(
			listed.map(({ subject, position }: TodoState) => [subject, position]),
		).toEqual([
			["write the docs", 1],
			["third", 2],
		]);
		await expect(todoRemove(deps, 2)).toBail("not_found");
	});

	it("rewords one, keeping its number", async () => {
		await using deps = await Testing.open();
		await todoAdd(deps, "write docs", "alpha", { text: "the CLI first" });

		const updated = await todoUpdate(deps, 1, {
			subject: "  write the arbor docs ",
		});

		expect(updated.state).toMatchObject({
			id: 1,
			subject: "write the arbor docs",
			text: "the CLI first",
			from: "alpha",
		});
		const detailed = await todoUpdate(deps, 1, { text: " and the page " });
		expect(detailed.state).toMatchObject({
			subject: "write the arbor docs",
			text: "and the page",
		});
		await expect(todoUpdate(deps, 1, { subject: " " })).toBail("usage");
		await expect(todoUpdate(deps, 9, { subject: "x" })).toBail("not_found");
	});

	it("keeps a subject to one line, the rest leading the detail", async () => {
		await using deps = await Testing.open();

		const todo = await deps.todos.add("fix the flake\nin CI\n", null, {
			text: "seen twice",
		});

		expect(todo.state).toMatchObject({
			subject: "fix the flake",
			text: "in CI\n\nseen twice",
		});
	});

	it("puts a new todo at the bottom, or where asked, pushing the rest down", async () => {
		await using deps = await Testing.open();
		await todoAdd(deps, "one", null);
		await todoAdd(deps, "two", null);

		await todoAdd(deps, "urgent", null, { position: 1 });
		await todoAdd(deps, "past the end", null, { position: 99 });

		expect(await order(deps)).toEqual(["urgent", "one", "two", "past the end"]);
		await expect(todoAdd(deps, "nowhere", null, { position: 0 })).toBail(
			"usage",
		);
	});

	it("moves one up or down, and closes the gap a removed one leaves", async () => {
		await using deps = await Testing.open();
		for (const subject of ["a", "b", "c", "d"]) {
			await todoAdd(deps, subject, null);
		}

		await todoUpdate(deps, 4, { position: 2 });
		expect(await order(deps)).toEqual(["a", "d", "b", "c"]);
		await todoUpdate(deps, 1, { position: 9 });
		expect(await order(deps)).toEqual(["d", "b", "c", "a"]);
		await todoRemove(deps, 2);

		expect(
			(await deps.todos.all()).map(({ subject, position }) => [
				subject,
				position,
			]),
		).toEqual([
			["d", 1],
			["c", 2],
			["a", 3],
		]);
		// Written down, not only counted again on reading.
		expect(
			JSON.parse(await deps.fs.read(`${deps.todos.dir}/1.json`)),
		).toMatchObject({ position: 3 });
		// Taking one leaves it where it is.
		await (await deps.todos.find(3)).take("alpha");
		expect(await order(deps)).toEqual(["d", "c", "a"]);
	});

	it("shows one in full, detail and files below", async () => {
		await using deps = await Testing.open();
		const shot = `${deps.root}/shot.png`;
		await deps.fs.writeBytes(shot, new Uint8Array([1]));
		await todoAdd(deps, "first", null);
		await todoAdd(deps, "fix the chart", "alpha", {
			text: "the bars overlap on a phone",
			files: [shot],
		});
		deps.log.clear();

		await todoShow(deps, 2);

		const out = color.strip(deps.out());
		expect(out).toContain("todo 2 fix the chart");
		expect(out).toContain("position:  2");
		expect(out).toContain("from:      alpha");
		expect(out).toContain(`file:      ${deps.todos.dir}/2/0-shot.png`);
		expect(out).toEndWith("\n\nthe bars overlap on a phone");
		deps.log.clear();
		await todoShow(deps, 2, { json: true });
		expect(JSON.parse(deps.out())).toMatchObject({
			id: 2,
			position: 2,
			text: "the bars overlap on a phone",
		});
		await expect(todoShow(deps, 9)).toBail("not_found");
	});

	it("keeps files beside a todo, adds and drops them, and removes them with it", async () => {
		await using deps = await Testing.open();
		const shot = `${deps.root}/shot.png`;
		const log = `${deps.root}/trace.log`;
		await deps.fs.writeBytes(shot, new Uint8Array([1]));
		await deps.fs.writeBytes(log, new Uint8Array([2]));

		const todo = await todoAdd(deps, "fix the chart", null, {
			files: [shot],
		});
		const dir = `${deps.todos.dir}/1`;
		expect(todo.files).toEqual([`${dir}/0-shot.png`]);
		expect(await deps.fs.readBytes(`${dir}/0-shot.png`)).toEqual(
			new Uint8Array([1]),
		);

		// Words alone leave the files be.
		const reworded = await todoUpdate(deps, 1, {
			subject: "fix the bar chart",
		});
		expect(reworded.files).toEqual(todo.files);

		const swapped = await todoUpdate(deps, 1, {
			files: [log],
			removeFiles: ["0-shot.png"],
		});
		expect(swapped.state).toMatchObject({
			subject: "fix the bar chart",
			files: [`${dir}/1-trace.log`],
		});
		expect(await deps.fs.exists(`${dir}/0-shot.png`)).toBe(false);
		await expect(todoUpdate(deps, 1, { removeFiles: ["nope.png"] })).toBail(
			"not_found",
			{ message: "no file 'nope.png'" },
		);

		await todoRemove(deps, 1);
		expect(await deps.fs.exists(dir)).toBe(false);
	});

	it("names a todo's files in the Goal of the task that takes it up", async () => {
		await using deps = await Testing.open();
		const shot = `${deps.root}/shot.png`;
		await deps.fs.writeBytes(shot, new Uint8Array([1]));
		await todoAdd(deps, "fix the chart", null, { files: [shot] });

		await add(deps, "chart", { todos: [1] });

		const worktree = (await deps.service.find("chart")).path;
		expect(await deps.fs.read(`${worktree}/${PLAN_FILE}`)).toContain(
			`## Goal\n\nfix the chart\n\nAttached: \`${deps.todos.dir}/1/0-shot.png\``,
		);
	});

	it("reads one saved before todos took files as having none", async () => {
		await using deps = await Testing.open();
		await todoAdd(deps, "old one", null);
		const { files: _, ...older } = (await deps.todos.find(1)).state;
		await deps.fs.write(`${deps.todos.dir}/1.json`, JSON.stringify(older));

		expect((await deps.todos.find(1)).state.files).toEqual([]);
	});

	it("reads one saved before subjects and positions, below those with them", async () => {
		await using deps = await Testing.open();
		await todoAdd(deps, "older", null);
		await todoAdd(deps, "newer", null);
		const {
			subject: _,
			position: __,
			...older
		} = (await deps.todos.find(1)).state;
		await deps.fs.write(
			`${deps.todos.dir}/1.json`,
			JSON.stringify({ ...older, text: "older\n\nwith more to say" }),
		);

		expect((await deps.todos.all()).map((todo) => todo.state)).toMatchObject([
			{ id: 2, position: 1 },
			{ id: 1, position: 2, subject: "older", text: "with more to say" },
		]);
	});

	it("refuses a todo with no subject", async () => {
		await using deps = await Testing.open();

		await expect(todoAdd(deps, "   ", null)).toBail("usage");
	});

	it("lists only the todos no task has taken when asked", async () => {
		await using deps = await Testing.open();
		await todoAdd(deps, "taken", null);
		await todoAdd(deps, "free", null);
		await add(deps, "busy", { todos: [1] });

		deps.log.clear();
		await todoList(deps, { json: true, open: true });

		expect(
			JSON.parse(deps.out()).map(({ subject }: TodoState) => subject),
		).toEqual(["free"]);
		await todoTake(deps, [2], "busy");
		deps.log.clear();
		await todoList(deps, { open: true });
		expect(deps.out()).toContain("no open todos");
	});

	it("says so plainly when there is nothing to do", async () => {
		await using deps = await Testing.open();

		await todoList(deps, { open: true });

		expect(deps.out()).toContain("no todos");
	});

	it("seeds the plan's Goal from the todo a task takes up", async () => {
		await using deps = await Testing.open();
		await todoAdd(deps, "support dark mode", null, { text: "charts too" });

		await add(deps, "dark", { todos: [1] });

		const worktree = (await deps.service.find("dark")).path;
		expect(await deps.fs.read(`${worktree}/${PLAN_FILE}`)).toContain(
			"## Goal\n\nsupport dark mode\n\ncharts too\n\n## Files",
		);
		expect((await deps.todos.find(1)).takenBy).toBe("dark");
		await expect(add(deps, "other", { todos: [1] })).toBail("exists", {
			message: "already taken by 'dark'",
		});
		// Refused before anything was made.
		expect((await deps.service.find("other")).gone).toBe(true);
		await expect(add(deps, "missing", { todos: [9] })).toBail("not_found");
	});

	it("takes up several todos at once, naming each in the Goal", async () => {
		await using deps = await Testing.open();
		await todoAdd(deps, "support dark mode", null);
		await todoAdd(deps, "dark charts too", "beta");

		await add(deps, "dark", { todos: [1, 2] });

		const worktree = (await deps.service.find("dark")).path;
		expect(await deps.fs.read(`${worktree}/${PLAN_FILE}`)).toContain(
			"## Goal\n\nTodo 1: support dark mode\n\nTodo 2: dark charts too",
		);
		expect((await deps.todos.takenBy("dark")).map((todo) => todo.id)).toEqual([
			1, 2,
		]);
	});

	it("takes todos for a task already under way, all or none", async () => {
		await using deps = await Testing.open();
		await todoAdd(deps, "support dark mode", null);
		await todoAdd(deps, "dark charts too", null);
		await todoAdd(deps, "someone else's", null);
		await add(deps, "other", { todos: [3] });

		await todoTake(deps, [1, 2, 1], "dark");

		expect((await deps.todos.takenBy("dark")).map((todo) => todo.id)).toEqual([
			1, 2,
		]);
		expect(color.strip(deps.out())).toContain("took todo 2: dark charts too");
		await todoRelease(deps, [2], "dark");
		await expect(todoTake(deps, [2, 3], "dark")).toBail("exists", {
			message: "already taken by 'other'",
		});
		// Refused as a whole: 2 was not taken on the way.
		expect((await deps.todos.find(2)).takenBy).toBeNull();
		await expect(todoTake(deps, [9], "dark")).toBail("not_found");
		await expect(todoTake(deps, [2], null)).toBail("usage");
		await expect(todoTake(deps, [], "dark")).toBail("usage");
	});

	it("releases only its own task's todos from a worktree", async () => {
		await using deps = await Testing.open();
		await todoAdd(deps, "support dark mode", null);
		await add(deps, "dark", { todos: [1] });

		await expect(todoRelease(deps, [1], "other")).toBail("exists", {
			message: "taken by 'dark'",
		});
		await todoRelease(deps, [1], "dark");
		expect((await deps.todos.find(1)).takenBy).toBeNull();

		await todoTake(deps, [1], "dark");
		// From the main tree, anyone's.
		await todoRelease(deps, [1], null);
		expect((await deps.todos.find(1)).takenBy).toBeNull();
	});

	it("leaves a released todo on the list when its task lands", async () => {
		await using deps = await Testing.open();
		await todoAdd(deps, "support dark mode", null);
		await todoAdd(deps, "dark charts too", null);
		await add(deps, "dark", { todos: [1, 2] });
		const worktree = (await deps.service.find("dark")).path;
		await deps.commit(worktree, "dark.txt", "dark\n", "add dark");
		await todoUpdate(deps, 2, { subject: "dark tooltips on charts" });
		await todoRelease(deps, [2], "dark");
		deps.log.clear();

		await merge(deps, worktree);

		await expect(deps.todos.find(1)).toBail("not_found");
		const out = color.strip(deps.out());
		expect(out).toContain("done todo 1: support dark mode");
		expect(out).toContain("next todo 2: dark tooltips on charts");
	});

	it("puts a removed task's todo back on the list", async () => {
		await using deps = await Testing.open();
		await todoAdd(deps, "support dark mode", null);
		await add(deps, "dark", { todos: [1] });

		await remove(deps, "dark");

		expect((await deps.todos.find(1)).takenBy).toBeNull();
		expect(deps.out()).toContain("todo 1 is open again");
	});

	it("removes a merged task's todo and recommends the next", async () => {
		await using deps = await Testing.open();
		await todoAdd(deps, "support dark mode", null);
		await todoAdd(deps, "older, from elsewhere", "beta");
		await todoAdd(deps, "follow-up from dark", "dark", { position: 2 });
		await add(deps, "dark", { todos: [1] });
		const worktree = (await deps.service.find("dark")).path;
		await deps.commit(worktree, "dark.txt", "dark\n", "add dark");
		deps.log.clear();

		await merge(deps, worktree);

		await expect(deps.todos.find(1)).toBail("not_found");
		const out = color.strip(deps.out());
		expect(out).toContain("next todo 3: follow-up from dark");
		expect(out).toContain("arbor add <task> --todo 3");
	});

	it("recommends the highest open todo, and sets stale ones aside", async () => {
		await using deps = await Testing.open();
		await todoAdd(deps, "taken", null);
		await todoAdd(deps, "ancient", null);
		await todoAdd(deps, "lower", null);
		await todoAdd(deps, "higher", null, { position: 3 });
		await (await deps.todos.find(1)).take("alpha");
		await age(deps, 2, 90);

		const { next, stale } = await recommend(deps.todos, null, 30 * DAY);

		expect(next?.subject).toBe("higher");
		expect(stale.map((todo) => todo.subject)).toEqual(["ancient"]);
	});

	it("recommends what came up in the task that landed before the rest", async () => {
		await using deps = await Testing.open();
		await todoAdd(deps, "top", null);
		await todoAdd(deps, "from alpha, lower", "alpha");
		await todoAdd(deps, "from alpha, higher", "alpha", { position: 2 });

		const { next } = await recommend(deps.todos, "alpha", 30 * DAY);

		expect(next?.subject).toBe("from alpha, higher");
	});

	it("recommends nothing once every todo is taken or stale", async () => {
		await using deps = await Testing.open();
		await todoAdd(deps, "taken", null);
		await (await deps.todos.find(1)).take("alpha");

		const { next, stale } = await recommend(deps.todos, null, 30 * DAY);

		expect(next).toBeNull();
		expect(stale).toEqual([]);
	});
});
