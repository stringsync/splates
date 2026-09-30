import { describe, expect, it } from "bun:test";
import { color } from "webappwiz/log";
import { add } from "./add";
import { merge } from "./merge";
import { PLAN_FILE } from "./plan";
import { remove } from "./remove";
import { Testing } from "./testing";
import { recommend, todoAdd, todoList, todoRemove, todoUpdate } from "./todo";

const DAY = 24 * 60 * 60 * 1000;

/** Backdates a todo, since `merge` sorts and ages them by when they were added. */
async function age(deps: Testing, id: number, days: number): Promise<void> {
	const todo = await deps.todos.find(id);
	await deps.todos.save({
		...todo.state,
		createdAt: new Date(Date.now() - days * DAY).toISOString(),
	});
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
		expect(listed.map((todo: { text: string }) => todo.text)).toEqual([
			"write the docs",
			"third",
		]);
		await expect(todoRemove(deps, 2)).toBail("not_found");
	});

	it("rewords one, keeping its number", async () => {
		await using deps = await Testing.open();
		await todoAdd(deps, "write docs", "alpha");

		const updated = await todoUpdate(deps, 1, {
			text: "  write the arbor docs ",
		});

		expect(updated.state).toMatchObject({
			id: 1,
			text: "write the arbor docs",
			from: "alpha",
		});
		expect((await deps.todos.find(1)).text).toBe("write the arbor docs");
		await expect(todoUpdate(deps, 1, { text: " " })).toBail("usage");
		await expect(todoUpdate(deps, 9, { text: "x" })).toBail("not_found");
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
		const reworded = await todoUpdate(deps, 1, { text: "fix the bar chart" });
		expect(reworded.files).toEqual(todo.files);

		const swapped = await todoUpdate(deps, 1, {
			files: [log],
			removeFiles: ["0-shot.png"],
		});
		expect(swapped.state).toMatchObject({
			text: "fix the bar chart",
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

		await add(deps, "chart", { todo: 1 });

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

	it("refuses a todo with no text", async () => {
		await using deps = await Testing.open();

		await expect(todoAdd(deps, "   ", null)).toBail("usage");
	});

	it("says so plainly when there is nothing to do", async () => {
		await using deps = await Testing.open();

		await todoList(deps);

		expect(deps.out()).toContain("no todos");
	});

	it("seeds the plan's Goal from the todo a task takes up", async () => {
		await using deps = await Testing.open();
		await todoAdd(deps, "support dark mode", null);

		await add(deps, "dark", { todo: 1 });

		const worktree = (await deps.service.find("dark")).path;
		expect(await deps.fs.read(`${worktree}/${PLAN_FILE}`)).toContain(
			"## Goal\n\nsupport dark mode",
		);
		expect((await deps.todos.find(1)).takenBy).toBe("dark");
		await expect(add(deps, "other", { todo: 1 })).toBail("exists", {
			message: "already taken by 'dark'",
		});
		// Refused before anything was made.
		expect((await deps.service.find("other")).gone).toBe(true);
		await expect(add(deps, "missing", { todo: 9 })).toBail("not_found");
	});

	it("puts a removed task's todo back on the list", async () => {
		await using deps = await Testing.open();
		await todoAdd(deps, "support dark mode", null);
		await add(deps, "dark", { todo: 1 });

		await remove(deps, "dark");

		expect((await deps.todos.find(1)).takenBy).toBeNull();
		expect(deps.out()).toContain("todo 1 is open again");
	});

	it("removes a merged task's todo and recommends the next", async () => {
		await using deps = await Testing.open();
		await todoAdd(deps, "support dark mode", null);
		await todoAdd(deps, "older, from elsewhere", "beta");
		await todoAdd(deps, "follow-up from dark", "dark");
		await age(deps, 2, 3);
		await add(deps, "dark", { todo: 1 });
		const worktree = (await deps.service.find("dark")).path;
		await deps.commit(worktree, "dark.txt", "dark\n", "add dark");
		deps.log.clear();

		await merge(deps, worktree);

		await expect(deps.todos.find(1)).toBail("not_found");
		const out = color.strip(deps.out());
		// Its own follow-up beats an older todo from another task.
		expect(out).toContain("next todo 3: follow-up from dark");
		expect(out).toContain("arbor add <task> --todo 3");
	});

	it("sorts a task's own todos first, then oldest, and sets stale ones aside", async () => {
		await using deps = await Testing.open();
		await todoAdd(deps, "newer elsewhere", "beta");
		await todoAdd(deps, "older elsewhere", "beta");
		await todoAdd(deps, "own", "alpha");
		await todoAdd(deps, "ancient", null);
		await age(deps, 1, 1);
		await age(deps, 2, 2);
		await age(deps, 4, 90);

		const own = await recommend(deps.todos, "alpha", 30 * DAY);
		const other = await recommend(deps.todos, "gamma", 30 * DAY);

		expect(own.next?.text).toBe("own");
		expect(other.next?.text).toBe("older elsewhere");
		expect(own.stale.map((todo) => todo.text)).toEqual(["ancient"]);
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
