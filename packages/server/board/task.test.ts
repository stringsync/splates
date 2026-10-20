import { describe, expect, it } from "bun:test";
import { color } from "webappwiz/log";
import { merge } from "../merge";
import { PLAN_FILE } from "../plans";
import { add, recommend, remove } from "../tasks";
import { Testing } from "../testing";
import { isReady } from "./lanes";
import type { TaskRecord } from "./task";
import { taskAdd, taskRemove, taskUpdate } from "./task-edit";
import { decodeTask, encodeTask } from "./task-file";
import { taskList, taskShow } from "./task-list";

const DAY = 24 * 60 * 60 * 1000;

/** Backdates a task, since `merge` offers one waiting too long for removal. */
async function age(deps: Testing, id: number, days: number): Promise<void> {
	const task = await deps.tasks.find(id);
	await deps.tasks.save({
		...task.state,
		createdAt: new Date(Date.now() - days * DAY).toISOString(),
	});
}

/** The subjects in list order. */
async function order(deps: Testing): Promise<string[]> {
	return (await deps.tasks.all()).map((task) => task.subject);
}

describe.concurrent("task", () => {
	it("adds, lists and removes, never reusing a number", async () => {
		await using deps = await Testing.open();

		await taskAdd(deps, "  write the docs  ", null);
		await taskAdd(deps, "fix the flake", "alpha");
		await taskRemove(deps, 2);
		const third = await taskAdd(deps, "third", null);

		expect(third.id).toBe(3);
		deps.log.clear();
		await taskList(deps, { json: true });
		const listed = JSON.parse(deps.out());
		expect(
			listed.map(({ subject, position }: TaskRecord) => [subject, position]),
		).toEqual([
			["write the docs", 1],
			["third", 2],
		]);
		await expect(taskRemove(deps, 2)).toBail("not_found");
	});

	it("rewords one, keeping its number", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "write docs", "alpha", { text: "the CLI first" });

		const updated = await taskUpdate(deps, 1, {
			subject: "  write the splates docs ",
		});

		expect(updated.state).toMatchObject({
			id: 1,
			subject: "write the splates docs",
			text: "the CLI first",
			from: "alpha",
		});
		const detailed = await taskUpdate(deps, 1, { text: " and the page " });
		expect(detailed.state).toMatchObject({
			subject: "write the splates docs",
			text: "and the page",
		});
		await expect(taskUpdate(deps, 1, { subject: " " })).toBail("usage");
		await expect(taskUpdate(deps, 9, { subject: "x" })).toBail("not_found");
	});

	it("keeps a subject to one line, the rest leading the detail", async () => {
		await using deps = await Testing.open();

		const task = await deps.tasks.add("fix the flake\nin CI\n", null, {
			text: "seen twice",
		});

		expect(task.state).toMatchObject({
			subject: "fix the flake",
			text: "in CI\n\nseen twice",
		});
	});

	it("puts a new task at the bottom, or where asked, pushing the rest down", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "one", null);
		await taskAdd(deps, "two", null);

		await taskAdd(deps, "urgent", null, { position: 1 });
		await taskAdd(deps, "past the end", null, { position: 99 });

		expect(await order(deps)).toEqual(["urgent", "one", "two", "past the end"]);
		await expect(taskAdd(deps, "nowhere", null, { position: 0 })).toBail(
			"usage",
		);
	});

	it("moves one up or down, and closes the gap a removed one leaves", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "a", null);
		await taskAdd(deps, "b", null);
		await taskAdd(deps, "c", null);
		await taskAdd(deps, "d", null);

		await taskUpdate(deps, 4, { position: 2 });
		expect(await order(deps)).toEqual(["a", "d", "b", "c"]);
		await taskUpdate(deps, 1, { position: 9 });
		expect(await order(deps)).toEqual(["d", "b", "c", "a"]);
		await taskRemove(deps, 2);

		expect(
			(await deps.tasks.all()).map(({ subject, position }) => [
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
			decodeTask(await deps.fs.read(`${deps.tasks.dir}/1.md`)),
		).toMatchObject({ position: 3 });
		// Taking one leaves it where it is.
		await (await deps.tasks.find(3)).take("alpha");
		expect(await order(deps)).toEqual(["d", "c", "a"]);
	});

	it("shows one in full, detail and files below", async () => {
		await using deps = await Testing.open();
		const shot = `${deps.root}/shot.png`;
		await deps.fs.writeBytes(shot, new Uint8Array([1]));
		await taskAdd(deps, "first", null);
		await taskAdd(deps, "fix the chart", "alpha", {
			text: "the bars overlap on a phone",
			files: [shot],
		});
		deps.log.clear();

		await taskShow(deps, 2);

		const out = color.strip(deps.out());
		expect(out).toContain("task 2 fix the chart");
		expect(out).toContain("position:  2");
		expect(out).toContain("from:      alpha");
		expect(out).toContain(`file:      ${deps.tasks.dir}/2/0-shot.png`);
		expect(out).toEndWith("\n\nthe bars overlap on a phone");
		deps.log.clear();
		await taskShow(deps, 2, { json: true });
		expect(JSON.parse(deps.out())).toMatchObject({
			id: 2,
			position: 2,
			text: "the bars overlap on a phone",
		});
		await expect(taskShow(deps, 9)).toBail("not_found");
	});

	it("keeps files beside a task, adds and drops them, and removes them with it", async () => {
		await using deps = await Testing.open();
		const shot = `${deps.root}/shot.png`;
		const log = `${deps.root}/trace.log`;
		await deps.fs.writeBytes(shot, new Uint8Array([1]));
		await deps.fs.writeBytes(log, new Uint8Array([2]));

		const task = await taskAdd(deps, "fix the chart", null, {
			files: [shot],
		});
		const dir = `${deps.tasks.dir}/1`;
		expect(task.files).toEqual([`${dir}/0-shot.png`]);
		expect(await deps.fs.readBytes(`${dir}/0-shot.png`)).toEqual(
			new Uint8Array([1]),
		);

		const reworded = await taskUpdate(deps, 1, {
			subject: "fix the bar chart",
		});
		expect(reworded.files).toEqual(task.files);

		const swapped = await taskUpdate(deps, 1, {
			files: [log],
			removeFiles: ["0-shot.png"],
		});
		expect(swapped.state).toMatchObject({
			subject: "fix the bar chart",
			files: [`${dir}/1-trace.log`],
		});
		expect(await deps.fs.exists(`${dir}/0-shot.png`)).toBe(false);
		await expect(taskUpdate(deps, 1, { removeFiles: ["nope.png"] })).toBail(
			"not_found",
			{ message: "no file 'nope.png'" },
		);

		await taskRemove(deps, 1);
		expect(await deps.fs.exists(dir)).toBe(false);
	});

	it("names a queued task's files in the Goal of the task that takes it up", async () => {
		await using deps = await Testing.open();
		const shot = `${deps.root}/shot.png`;
		await deps.fs.writeBytes(shot, new Uint8Array([1]));
		await taskAdd(deps, "fix the chart", null, { files: [shot] });

		await add(deps, "chart", { tasks: [1] });

		const worktree = (await deps.service.find("chart")).path;
		expect(await deps.fs.read(`${worktree}/${PLAN_FILE}`)).toContain(
			`## Goal\n\nfix the chart\n\nAttached: \`${deps.tasks.dir}/1/0-shot.png\``,
		);
	});

	it("reads one saved before tasks took files as having none", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "old one", null);
		const { files: _, ...older } = (await deps.tasks.find(1)).state;
		await deps.fs.write(`${deps.tasks.dir}/1.md`, encodeTask(older));

		expect((await deps.tasks.find(1)).state.files).toEqual([]);
	});

	it("refuses one saved with tags until they move into lanes, one lane a tag", async () => {
		await using deps = await Testing.open();
		await deps.tasks.addLane("Licensing");
		await taskAdd(deps, "a", null);
		await taskAdd(deps, "b", null);
		await taskAdd(deps, "c", null);
		await taskAdd(deps, "d", null);
		await taskAdd(deps, "e", null);
		await taskAdd(deps, "f", null);
		await taskUpdate(deps, 1, { blockedBy: [6] });
		// Read first: once one has tags, none can be.
		const states = (await deps.tasks.all()).map((task) => task.state);
		const tag = async (id: number, tags: string[]) => {
			const state = states.find((each) => each.id === id);
			await deps.fs.write(
				`${deps.tasks.dir}/${id}.md`,
				encodeTask({ ...state, tags }),
			);
		};
		// An empty list, as every task had, is no tag at all.
		await tag(4, []);
		expect((await deps.tasks.find(4)).lane).toBeNull();
		await tag(1, ["licensing"]);
		await tag(2, ["dark-mode", "licensing"]);
		await tag(3, ["dark-mode"]);
		await tag(6, ["licensing"]);
		await expect(deps.tasks.all()).toBail("outdated", {
			message: [
				"was saved with tags, and splates now groups tasks in lanes instead",
				"Run `splates update` in this repository",
			],
		});

		const moved = await deps.tasks.moveTagsToLanes();

		expect(moved).toEqual([
			{ lane: { id: 1, name: "Licensing" }, tasks: [1, 2, 6] },
			{ lane: { id: 2, name: "Dark mode" }, tasks: [3] },
		]);
		const lanes = (await deps.tasks.all()).map(({ id, lane }) => [id, lane]);
		expect(lanes).toEqual([
			[2, 1],
			[3, 2],
			[4, null],
			[5, null],
			[6, 1],
			[1, 1],
		]);
		expect(
			decodeTask(await deps.fs.read(`${deps.tasks.dir}/2.md`)),
		).not.toHaveProperty("tags");
		expect(await deps.tasks.moveTagsToLanes()).toEqual([]);
	});

	it("reads one saved before subjects and positions, below those with them", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "older", null);
		await taskAdd(deps, "newer", null);
		const {
			subject: _,
			position: __,
			...older
		} = (await deps.tasks.find(1)).state;
		await deps.fs.write(
			`${deps.tasks.dir}/1.md`,
			encodeTask({ ...older, text: "older\n\nwith more to say" }),
		);

		expect((await deps.tasks.all()).map((task) => task.state)).toMatchObject([
			{ id: 2, position: 1 },
			{ id: 1, position: 2, subject: "older", text: "with more to say" },
		]);
	});

	it("keeps the slug it is given to start under, shows it, and renames it", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "Upload retries forever on a 413", null, {
			slug: "upload-413",
		});

		expect((await deps.tasks.find(1)).state.slug).toBe("upload-413");
		expect(deps.out()).toContain("splates add upload-413 --task 1");
		deps.log.clear();
		await taskShow(deps, 1);
		expect(deps.out()).toContain("slug:      upload-413");
		await taskUpdate(deps, 1, { slug: "stop-413-retries" });
		expect((await deps.tasks.find(1)).state.slug).toBe("stop-413-retries");
		await expect(
			taskAdd(deps, "Rename the menu", null, { slug: "Rename menu" }),
		).toBail("usage", {
			data: { subject: "Rename the menu", slug: "Rename menu" },
		});
		await expect(taskUpdate(deps, 1, { slug: "413_" })).toBail("usage");
		expect(await order(deps)).toEqual(["Upload retries forever on a 413"]);
	});

	it("refuses a task with no subject", async () => {
		await using deps = await Testing.open();

		await expect(taskAdd(deps, "   ", null)).toBail("usage");
	});

	it("lists only the queued tasks no task has taken when asked", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "taken", null);
		await taskAdd(deps, "free", null);
		await add(deps, "busy", { tasks: [1] });

		deps.log.clear();
		await taskList(deps, { json: true, open: true });

		expect(
			JSON.parse(deps.out()).map(({ subject }: TaskRecord) => subject),
		).toEqual(["free"]);
		await add(deps, "idle", { tasks: [2] });
		deps.log.clear();
		await taskList(deps, { open: true });
		expect(deps.out()).toContain("no open tasks");
	});

	it("says so plainly when there is nothing to do", async () => {
		await using deps = await Testing.open();

		await taskList(deps, { open: true });

		expect(deps.out()).toContain("no tasks");
	});

	it("seeds the plan's Goal from the queued task a task takes up", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "support dark mode", null, { text: "charts too" });

		await add(deps, "dark", { tasks: [1] });

		const worktree = (await deps.service.find("dark")).path;
		expect(await deps.fs.read(`${worktree}/${PLAN_FILE}`)).toContain(
			"## Goal\n\nsupport dark mode\n\ncharts too\n",
		);
		expect((await deps.tasks.find(1)).takenBy).toBe("dark");
		await expect(add(deps, "other", { tasks: [1] })).toBail("exists", {
			message: "already taken by 'dark'",
		});
		// Refused before anything was made.
		expect((await deps.service.find("other")).gone).toBe(true);
		await expect(add(deps, "missing", { tasks: [9] })).toBail("not_found");
	});

	it("is ready once groomed, whether it names an agent or not, and stays groomed once started", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "rough", null);
		await taskAdd(deps, "groomed", null, { ready: true });
		await taskUpdate(deps, 1, { assignee: { agent: "claude" } });
		const stages = async () =>
			(await deps.tasks.all()).map((task) => task.state.stage);
		expect(await stages()).toEqual(["backlog", "ready"]);

		await taskUpdate(deps, 1, { ready: true });
		expect(await stages()).toEqual(["ready", "ready"]);

		await taskAdd(deps, "started rough", null);
		await add(deps, "rough", { tasks: [3] });
		await taskUpdate(deps, 3, { ready: true });
		const started = (await deps.tasks.find(3)).state;
		expect([started.stage, started.groomed]).toEqual(["running", true]);
		deps.log.clear();
		await taskShow(deps, 3);
		expect(deps.out()).toContain("groomed:   yes");
	});

	it("is claimed for one groomer at a time, until a take or grooming ends the claim", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "rough", null);
		await taskAdd(deps, "taken", null);
		await taskAdd(deps, "groomed", null, { ready: true });
		await add(deps, "work", { tasks: [2] });
		const claim = async (id: number, by: string) =>
			(await deps.tasks.find(id)).groom(by);

		expect(await claim(1, "groomer-a")).toBe(true);
		expect(await claim(1, "groomer-a")).toBe(false);
		expect(await claim(2, "groomer-a")).toBe(false);
		expect(await claim(3, "groomer-a")).toBe(false);
		// A groomer since retired gives way to the one on now.
		expect(await claim(1, "groomer-b")).toBe(true);
		expect((await deps.tasks.find(1)).state.grooming).toBe("groomer-b");

		await (await deps.tasks.find(1)).take("person");
		expect((await deps.tasks.find(1)).state.grooming).toBeUndefined();
		await (await deps.tasks.find(1)).release();
		await claim(1, "groomer-b");
		await taskUpdate(deps, 1, { ready: true });
		expect((await deps.tasks.find(1)).state.grooming).toBeUndefined();
	});

	it("puts a removed task's queued task back on the list", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "support dark mode", null);
		await add(deps, "dark", { tasks: [1] });

		await remove(deps, "dark");

		expect((await deps.tasks.find(1)).takenBy).toBeNull();
		expect(deps.out()).toContain("task 1 is open again");
	});

	it("removes a merged task's queued task and recommends the next", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "support dark mode", null);
		await taskAdd(deps, "older, from elsewhere", "beta");
		await taskAdd(deps, "follow-up from dark", "dark", { position: 2 });
		await add(deps, "dark", { tasks: [1] });
		const worktree = (await deps.service.find("dark")).path;
		await deps.commit(worktree, "dark.txt", "dark\n", "add dark");
		deps.log.clear();

		await deps.finish(worktree);
		await merge(deps, worktree);

		await expect(deps.tasks.find(1)).toBail("not_found");
		const out = color.strip(deps.out());
		expect(out).toContain("next task 3: follow-up from dark");
		expect(out).toContain("splates add <slug> --task 3");
	});

	it("keeps on each task it blocked the commit a merged blocker landed as", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "support dark mode", null);
		await taskAdd(deps, "dark charts", null, { blockedBy: [1] });
		await add(deps, "dark", { tasks: [1] });
		const worktree = (await deps.service.find("dark")).path;
		await deps.commit(worktree, "dark.txt", "dark\n", "add dark");

		await deps.finish(worktree);
		await merge(deps, worktree);

		const head = (
			await deps.git.out(deps.git.root, "rev-parse", "--short", "HEAD")
		).trim();
		const next = await deps.tasks.find(2);
		expect(next.state).toMatchObject({
			blockedBy: [],
			blockersLanded: [{ id: 1, subject: "support dark mode", commit: head }],
		});
		expect(next.state.blockersLost).toBeUndefined();
		deps.log.clear();
		await taskShow(deps, 2);
		expect(color.strip(deps.out())).toContain(
			`landed:    #1 support dark mode, as ${head}`,
		);
	});

	it("holds a task whose blocker was removed for the person, until they let it go", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "support dark mode", null);
		await taskAdd(deps, "dark charts", null, { blockedBy: [1] });

		await taskRemove(deps, 1);

		const held = await deps.tasks.find(2);
		expect(held.state).toMatchObject({
			blockedBy: [],
			blockersLost: [{ id: 1, subject: "support dark mode" }],
		});
		expect(isReady(held.state)).toBe(false);
		deps.log.clear();
		await taskShow(deps, 2);
		expect(color.strip(deps.out())).toContain(
			"splates task update 2 --remove-blocked-by 1",
		);

		const freed = await taskUpdate(deps, 2, { removeBlockedBy: [1] });
		expect(freed.state.blockersLost).toBeUndefined();
		expect(isReady(freed.state)).toBe(true);
	});

	it("recommends the highest open task, and sets stale ones aside", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "taken", null);
		await taskAdd(deps, "ancient", null);
		await taskAdd(deps, "lower", null);
		await taskAdd(deps, "higher", null, { position: 3 });
		await (await deps.tasks.find(1)).take("alpha");
		await age(deps, 2, 90);

		const { next, stale } = await recommend(deps.tasks, null, 30 * DAY);

		expect(next?.subject).toBe("higher");
		expect(stale.map((task) => task.subject)).toEqual(["ancient"]);
	});

	it("recommends what came up in the task that landed before the rest", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "top", null);
		await taskAdd(deps, "from alpha, lower", "alpha");
		await taskAdd(deps, "from alpha, higher", "alpha", { position: 2 });

		const { next } = await recommend(deps.tasks, "alpha", 30 * DAY);

		expect(next?.subject).toBe("from alpha, higher");
	});

	it("recommends nothing once every task is taken or stale", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "taken", null);
		await (await deps.tasks.find(1)).take("alpha");

		const { next, stale } = await recommend(deps.tasks, null, 30 * DAY);

		expect(next).toBeNull();
		expect(stale).toEqual([]);
	});
});
