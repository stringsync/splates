import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Testing } from "../testing";
import { add } from "./add";
import { settleTaken } from "./settle-taken";

describe("settleTaken", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("removes a board task left taken by an already-merged task, records the landing on dependents, and ends its empty lane", async () => {
		const lane = await deps.tasks.addLane("Rig exposure");
		const first = await deps.tasks.add("Add exposure", null, { lane: lane.id });
		const second = await deps.tasks.add("Use exposure", null, {
			blockedBy: [first.id],
		});
		await add(deps, "rig-exposure", { tasks: [first.id] });
		const worktree = await deps.service.find("rig-exposure");

		// Simulate a merge killed right after discard, before finishLanding removes the board task.
		const discarded = await worktree.discard("merged", { commit: "abc1234" });
		expect(discarded.code).toBe(0);
		expect((await deps.tasks.find(first.id)).takenBy).toBe("rig-exposure");

		expect(await settleTaken(deps.tasks, deps.service)).toBe(1);

		expect((await deps.tasks.all()).map((task) => task.id)).toEqual([
			second.id,
		]);
		expect((await deps.tasks.find(second.id)).state.blockersLanded).toEqual([
			{ id: first.id, subject: "Add exposure", commit: "abc1234" },
		]);
		expect((await deps.tasks.lanes()).some((each) => each.id === lane.id)).toBe(
			false,
		);
	});

	it("removes a board task left taken by a removed non-blocked task", async () => {
		const lane = await deps.tasks.addLane("Cleanup");
		const queued = await deps.tasks.add("Drop old flag", null, {
			lane: lane.id,
		});
		await add(deps, "drop-flag", { tasks: [queued.id] });
		const worktree = await deps.service.find("drop-flag");

		const discarded = await worktree.discard("removed", { reason: "moot" });
		expect(discarded.code).toBe(0);

		expect(await settleTaken(deps.tasks, deps.service)).toBe(1);

		expect(await deps.tasks.all()).toEqual([]);
		expect((await deps.tasks.lanes()).some((each) => each.id === lane.id)).toBe(
			false,
		);
	});

	it("leaves live, in-flight, and blocked-deferred tasks alone", async () => {
		const live = await deps.tasks.add("Live work", null);
		await add(deps, "live-work", { tasks: [live.id] });

		const starting = await deps.tasks.add("Starting work", null);
		await starting.take("starting-work");

		const deferred = await deps.tasks.add("Blocked work", null);
		await add(deps, "blocked-work", { tasks: [deferred.id] });
		const worktree = await deps.service.find("blocked-work");
		const discarded = await worktree.discard("removed", {
			reason: "blocked",
			unqueue: true,
		});
		expect(discarded.code).toBe(0);

		expect(await settleTaken(deps.tasks, deps.service)).toBe(0);

		expect((await deps.tasks.all()).map((task) => task.id)).toEqual([
			live.id,
			starting.id,
			deferred.id,
		]);
	});
});
