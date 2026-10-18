import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeWallClock } from "webappwiz/time/testing";
import { WorkerRegistry } from "./registry";
import { DEFAULT_SLOTS, WorkerSlots } from "./slots";

describe("WorkerSlots", () => {
	let registry: WorkerRegistry;
	let slots: WorkerSlots;

	beforeEach(() => {
		registry = new WorkerRegistry(new MemoryLogger());
		registry.expect("local", "local");
		slots = new WorkerSlots(registry, {
			platform: "darwin",
			wall: new FakeWallClock(Date.parse("2026-10-11T10:00:00Z")),
		});
	});

	afterEach(() => {
		slots.dispose();
		registry.dispose();
	});

	const signal = new AbortController().signal;

	it("places on the local worker before it joins, with the default slots on this machine's platform", async () => {
		const macos = slots.project("/repo", "macos");
		const grants = await Promise.all(
			Array.from({ length: DEFAULT_SLOTS }, (_, at) =>
				macos.take({ id: `c${at}`, task: null, agent: "claude" }, signal),
			),
		);
		expect(new Set(grants.map((grant) => grant.worker))).toEqual(
			new Set(["local"]),
		);
		void macos.take({ id: "late", task: "login", agent: "claude" }, signal);
		expect(macos.spot("late")).toEqual({
			position: 1,
			of: 1,
			since: "2026-10-11T10:00:00.000Z",
			reason: "no free slot",
		});
	});

	it("takes the local worker's slots and platform from its hello", async () => {
		registry.expect("local", "local").info = { slots: 1, platform: "linux" };
		const linux = slots.project("/repo", "linux");
		await linux.take({ id: "a", task: "login", agent: "claude" }, signal);
		void linux.take({ id: "b", task: null, agent: "claude" }, signal);
		expect(linux.spot("b")?.reason).toBe("no free slot");
		void slots
			.project("/other", "macos")
			.take({ id: "c", task: null, agent: "claude" }, signal);
		expect(slots.scheduler.spot("c")?.reason).toBe("needs macOS");
	});

	it("leaves a registered worker be until it is up and makes its own checkouts", async () => {
		registry.expect("local", "local").info = { slots: 1 };
		registry.expect("box").info = {
			slots: 4,
			platform: "linux",
			checkouts: true,
		};
		const any = slots.project("/repo", null);
		await any.take({ id: "a", task: "login", agent: "claude" }, signal);
		void any.take({ id: "b", task: null, agent: "claude" }, signal);
		expect(any.spot("b")).not.toBeNull();
	});

	it("says what each worker runs, by task or by conversation", async () => {
		const any = slots.project("/repo", null);
		await any.take({ id: "a", task: "login", agent: "claude" }, signal);
		any.hold({ id: "b", task: null, agent: "claude" }, "local");
		expect(slots.used()).toEqual(new Map([["local", ["login", "b"]]]));
	});
});
