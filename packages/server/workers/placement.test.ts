import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeWallClock } from "webappwiz/time/testing";
import { AgentPlacement } from "./placement";
import { WorkerRegistry } from "./registry";

describe("AgentPlacement", () => {
	let registry: WorkerRegistry;
	let slots: AgentPlacement;
	let paused: boolean;

	beforeEach(() => {
		registry = new WorkerRegistry(new MemoryLogger());
		registry.expect("local", "local");
		paused = false;
		slots = new AgentPlacement(registry, {
			wall: new FakeWallClock(Date.parse("2026-10-11T10:00:00Z")),
			paused: () => paused,
		});
	});

	afterEach(() => {
		slots.dispose();
		registry.dispose();
	});

	const signal = new AbortController().signal;

	it("places every agent on the local worker before it joins, however many", async () => {
		const macos = slots.project("/repo");
		const grants = await Promise.all(
			Array.from({ length: 9 }, (_, at) =>
				macos.take(
					{ id: `c${at}`, task: null, agent: "claude", automatic: true },
					signal,
				),
			),
		);
		expect(new Set(grants.map((grant) => grant.worker))).toEqual(
			new Set(["local"]),
		);
	});

	it("says where an agent waits while the pool is paused", () => {
		paused = true;
		const macos = slots.project("/repo");
		void macos.take(
			{ id: "late", task: "login", agent: "claude", automatic: true },
			signal,
		);
		expect(macos.spot("late")).toEqual({
			position: 1,
			of: 1,
			since: "2026-10-11T10:00:00.000Z",
			reason: "paused",
		});
	});

	it("places on this machine's worker alone, never a registered one", async () => {
		registry.expect("box");
		const any = slots.project("/repo");
		const grants = await Promise.all(
			["a", "b"].map((id) =>
				any.take({ id, task: null, agent: "claude", automatic: true }, signal),
			),
		);
		expect(grants.map((grant) => grant.worker)).toEqual(["local", "local"]);
	});

	it("says what each worker runs, by task or by conversation", async () => {
		const any = slots.project("/repo");
		await any.take(
			{ id: "a", task: "login", agent: "claude", automatic: true },
			signal,
		);
		any.hold(
			{ id: "b", task: null, agent: "claude", automatic: true },
			"local",
		);
		expect(slots.used()).toEqual(new Map([["local", ["login", "b"]]]));
	});
});
