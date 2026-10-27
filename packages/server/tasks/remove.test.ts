import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { taskShow } from "../board";
import { queueAdd } from "../queue";
import { LIVE_PID, Testing } from "../testing";
import { add } from "./add";
import { remove } from "./remove";

describe("remove", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("removes everything and says what was thrown away", async () => {
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "unlanded work");
		const record = await deps.recordOf("alpha");

		await remove(deps, "alpha");

		expect(deps.out()).toContain("discarded 1 commit(s)");
		expect(await deps.fs.exists(worktree)).toBe(false);
		expect(
			await deps.storage
				.collection("tasks")
				.read(record.slice("tasks/".length)),
		).toBeNull();
		expect(await deps.gitCli(deps.root, "branch", "--list", "task/alpha")).toBe(
			"",
		);
	});

	it("releases the slot server before deleting its worktree", async () => {
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		const release = deps.slots.release.bind(deps.slots);
		const existsAtRelease: boolean[] = [];
		deps.slots.release = async (tree) => {
			existsAtRelease.push(await deps.fs.exists(worktree));
			return release(tree);
		};

		await remove(deps, "alpha");

		expect(existsAtRelease).toEqual([true]);
	});

	it("keeps the removed task, and why, among the finished", async () => {
		await add(deps, "alpha");

		await remove(deps, "alpha", { reason: "moot" });

		expect(await deps.service.finished.list()).toEqual([
			expect.objectContaining({
				task: "alpha",
				ended: "removed",
				reason: "moot",
				commit: null,
			}),
		]);
	});

	it("keeps the screenshots its plan shows past its conversation and record", async () => {
		await add(deps, "alpha");
		const shots = [
			...((await (
				await deps.service.files("alpha")
			)?.store([{ name: "own.png", bytes: new Uint8Array([1]) }])) ?? []),
			...(await deps.service
				.attached("c1", "alpha")
				.store([{ name: "shot.png", bytes: new Uint8Array([2]) }])),
		];
		await deps.fs.write(
			`${(await deps.service.find("alpha")).path}/SPLATES.md`,
			shots.map((path) => `![shot](${path})`).join("\n"),
		);

		await remove(deps, "alpha");
		await deps.storage.remove("conversations/c1");

		const plan =
			(
				await deps.service.finished.read(
					(await deps.service.finished.list())[0]?.key ?? "",
				)
			)?.plan ?? "";
		expect(await deps.fs.exists(shots[0] ?? "")).toBe(false);
		expect(plan).not.toContain(shots[0] ?? "");
		expect(plan).not.toContain(shots[1] ?? "");
		const shown = plan.split("\n").map((line) => line.slice(8, -1));
		expect(shown.every((path) => deps.service.finished.owns(path))).toBe(true);
		expect(
			await Promise.all(shown.map((path) => deps.fs.readBytes(path))),
		).toEqual([new Uint8Array([1]), new Uint8Array([2])]);
	});

	it("returns the tasks it put back", async () => {
		await add(deps, "alpha");

		expect(await remove(deps, "alpha")).toEqual({ released: [] });
	});

	it("removes every board task it took and frees tasks that depended on them", async () => {
		const lane = await deps.tasks.addLane("Fixes");
		const first = await deps.tasks.add("Retry on 413", null, { lane: lane.id });
		const second = await deps.tasks.add("Log retries", null, { lane: lane.id });
		const dependent = await deps.tasks.add("Ship retries", null);
		await deps.tasks.link(dependent.id, { add: [first.id, second.id] });
		await add(deps, "alpha", { tasks: [first.id] });
		await (await deps.tasks.find(second.id)).take("alpha");

		expect(await remove(deps, "alpha", { reason: "moot" })).toEqual({
			released: [],
		});

		expect((await deps.tasks.all()).map(({ id }) => id)).toEqual([
			dependent.id,
		]);
		expect((await deps.tasks.find(dependent.id)).state).toMatchObject({
			blockedBy: [],
		});
		expect(
			(await deps.tasks.find(dependent.id)).state.blockersLost,
		).toBeUndefined();
		expect(await deps.tasks.lanes()).toEqual([{ id: 0, name: "Backlog" }]);
		expect((await deps.service.finished.list())[0]?.took).toEqual([
			{ id: first.id, subject: first.subject },
			{ id: second.id, subject: second.subject },
		]);
	});

	it("removes the board task when no removal reason is given", async () => {
		const task = await deps.tasks.add("Retry on 413", null);
		await add(deps, "alpha", { tasks: [task.id] });

		await remove(deps, "alpha");

		expect(await deps.tasks.all()).toEqual([]);
		expect((await deps.service.find("alpha")).status).toBe("removed");
	});

	it("takes what it took out of the queue, so the runner does not start it again", async () => {
		const started = await deps.tasks.add("Retry on 413", null);
		const taken = await deps.tasks.add("Log the retries", null);
		await queueAdd(deps, [started.id, taken.id]);
		await add(deps, "alpha", { tasks: [started.id] });
		await (await deps.tasks.find(taken.id)).take("alpha");

		await remove(deps, "alpha", {
			reason: "blocked",
			deferral: { why: "It needs a key.", outside: ["a key"] },
		});

		expect((await deps.tasks.all()).map((task) => task.state)).toMatchObject([
			{ id: started.id, stage: "backlog", takenBy: null },
			{ id: taken.id, stage: "backlog", takenBy: null },
		]);
	});

	it("leaves what it took out of its queued lane, so the lane does not queue it again", async () => {
		const lane = await deps.tasks.addLane("Fixes");
		const started = await deps.tasks.add("Retry on 413", null, {
			lane: lane.id,
			ready: true,
		});
		await deps.tasks.queueLane(lane.id, true);
		expect(await deps.tasks.queueFromLanes()).toMatchObject([
			{ id: started.id },
		]);
		await add(deps, "alpha", { tasks: [started.id] });

		await remove(deps, "alpha", {
			reason: "blocked",
			deferral: { why: "It needs a key.", outside: ["a key"] },
		});

		expect(await deps.tasks.queueFromLanes()).toEqual([]);
		expect((await deps.tasks.find(started.id)).state.stage).toBe("ready");
	});

	it("refuses a deferral with no why or no blocker, saying how to name them, and keeps the tree", async () => {
		await add(deps, "alpha");

		await expect(remove(deps, "alpha", { reason: "blocked" })).toBail("usage", {
			message: "--why",
		});
		await expect(
			remove(deps, "alpha", {
				reason: "blocked",
				deferral: { why: "It needs a key." },
			}),
		).toBail("usage", { message: "--waiting-on" });
		await expect(
			remove(deps, "alpha", {
				reason: "blocked",
				deferral: { why: "It needs #99.", blockedBy: [99] },
			}),
		).toBail("not_found");

		expect((await deps.service.find("alpha")).status).not.toBe("removed");
	});

	it("keeps why the work stopped and each blocker on the task it took, linking the tasks", async () => {
		const blocker = await deps.tasks.add("Build the upload client", null);
		const started = await deps.tasks.add("Retry on 413", null);
		await add(deps, "alpha", { tasks: [started.id] });

		await remove(deps, "alpha", {
			reason: "blocked",
			conversation: "c1",
			deferral: {
				why: "The fix needs the new upload client.",
				blockedBy: [blocker.id],
				questions: ["Keep the 413 retry for old clients?"],
				outside: ["an upstream release"],
				detail: "Stopped: the client is half built.",
			},
		});

		const state = (await deps.tasks.find(started.id)).state;
		expect(state).toMatchObject({
			takenBy: null,
			blockedBy: [blocker.id],
			text: "Stopped: the client is half built.",
			deferred: {
				why: "The fix needs the new upload client.",
				task: "alpha",
				conversation: "c1",
				tasks: [{ id: blocker.id, subject: "Build the upload client" }],
				questions: [{ text: "Keep the 413 retry for old clients?" }],
				outside: [{ what: "an upstream release" }],
			},
		});
		expect(deps.out()).toContain(`waits on: task ${blocker.id} merging`);
		await taskShow(deps, started.id);
		expect(deps.out()).toContain(
			"deferred:  from alpha, 0m ago: The fix needs the new upload client.",
		);
		expect(deps.out()).toContain(
			`[ ] #${blocker.id} Build the upload client (backlog)`,
		);
		expect(deps.out()).toContain(
			"[ ] the person: Keep the 413 retry for old clients? (open)",
		);
	});

	it("gives work started with no board task one of its own to hold its deferral", async () => {
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.fs.write(
			`${worktree}/SPLATES.md`,
			"# alpha\n\n## Goal\n\nStop uploads retrying a 413\n",
		);

		const { released } = await remove(deps, "alpha", {
			reason: "blocked",
			deferral: { why: "It needs a key.", outside: ["a key"] },
		});

		const [held] = await deps.tasks.all();
		expect(released).toEqual([
			{ id: held?.id ?? 0, subject: "Stop uploads retrying a 413" },
		]);
		expect(held?.state).toMatchObject({
			subject: "Stop uploads retrying a 413",
			slug: "alpha",
			from: "alpha",
			stage: "ready",
			takenBy: null,
			deferred: { why: "It needs a key.", outside: [{ what: "a key" }] },
		});
		expect(held?.text).toContain("## Goal");
		expect(deps.out()).toContain("holds the deferred work");
	});

	it("tells 'already removed' apart from 'never existed'", async () => {
		await add(deps, "alpha");
		await remove(deps, "alpha");

		await expect(remove(deps, "alpha")).toBail("already_removed");
		await expect(remove(deps, "never")).toBail("not_found");
	});

	it("cleans up leftovers when the worktree directory is already gone", async () => {
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.fs.rm(worktree, { recursive: true, force: true });

		await remove(deps, "alpha");

		expect(deps.out()).toContain("already gone");
		expect(await deps.gitCli(deps.root, "branch", "--list", "task/alpha")).toBe(
			"",
		);
	});

	it("cleans up leftovers when the worktree registration is already gone", async () => {
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		const record = await deps.recordOf("alpha");
		const registration = (await deps.fs.read(`${worktree}/.git`))
			.slice("gitdir: ".length)
			.trim();
		await deps.fs.rm(registration, { recursive: true, force: true });

		await remove(deps, "alpha");

		expect(await deps.fs.exists(worktree)).toBe(false);
		expect(await deps.gitCli(deps.root, "branch", "--list", "task/alpha")).toBe(
			"",
		);
		expect(
			await deps.storage
				.collection("tasks")
				.read(record.slice("tasks/".length)),
		).toBeNull();
	});

	it("refuses a tree another agent is driving, unless forced", async () => {
		await add(deps, "alpha");
		const worktree = await (await deps.service.find("alpha")).save({
			lease: {
				pid: LIVE_PID,
				hostname: deps.ps.hostname,
				heartbeatAt: new Date().toISOString(),
			},
		});

		await expect(remove(deps, "alpha")).toBail("lease_held", {
			message: "--force",
		});

		await remove(deps, "alpha", { force: true });
		expect(await deps.fs.exists(worktree.path)).toBe(false);
	});
});
