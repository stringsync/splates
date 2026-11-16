import { describe, expect, it } from "bun:test";
import { CounterIdProvider } from "core/id";
import { MemoryLogger } from "core/log";
import { MemoryStorage } from "../storage/testing";
import { RUNS, ShipEngine } from "./engine";
import { type FixDesk, ShipFixes } from "./fixes";
import { RunError } from "./run-error";
import type { RunEvent, RunTarget } from "./run-events";
import type { RunState, StepState } from "./run-state";
import { FakeStepProcesses } from "./testing";

describe("ShipFixes", () => {
	it("sends a failed step to an agent as a board task with its plan, error and output", async () => {
		const { fixes, desk } = await failed();
		const { task, state } = await fixes.send("0", "lib", "publish");
		expect(task).toBe(7);
		expect(desk.started).toEqual([7]);
		expect(stepOf(state, "lib/publish").fix).toEqual({ task: 7, at: 1000 });
		const [added] = desk.added;
		expect(added?.subject).toBe(
			"The ship step publish of lib passes, and the ship carries on",
		);
		expect(added?.text).toContain("## Before");
		expect(added?.text).toContain("npm said 403");
		expect(added?.text).toContain(
			"3. `publish`: Publish lib (after test) ← failed",
		);
		expect(added?.text).toContain("+ npm publish");
		expect(added?.text).toContain(
			"splates ships show 0 --target lib --step publish",
		);
	});

	it("refuses a step that has not failed, or is already with an agent", async () => {
		const { fixes, desk } = await failed();
		expect(fixes.send("0", "lib", "test")).rejects.toThrow(RunError);
		await fixes.send("0", "lib", "publish");
		expect(fixes.send("0", "lib", "publish")).rejects.toThrow(
			"already with an agent, as task #7",
		);
		expect(desk.added).toHaveLength(1);
	});

	it("retries the step by itself once its fix merges, and the ship carries on", async () => {
		const { fixes, desk, engine, processes, storage } = await failed();
		await fixes.send("0", "lib", "publish");
		await fixes.settle();
		expect(processes.names()).toEqual(["lib/test", "lib/publish"]);
		desk.endings.set(7, "merged");
		await fixes.settle();
		(await processes.started("lib/publish")).exit(0);
		await until(async () => (await engine.get("0"))?.status === "done");
		const step = stepOf(await engine.get("0"), "lib/publish");
		expect(step.fix).toEqual({ task: 7, at: 1000, ended: "merged" });
		expect(step.retries).toBe(1);
		expect(
			(await events(storage)).filter(
				(each) => each.type === "fixed" || each.type === "retried",
			),
		).toEqual([
			{
				type: "fixed",
				at: 1000,
				target: "lib",
				step: "publish",
				task: 7,
				outcome: "merged",
			},
			{ type: "retried", at: 1000, target: "lib", step: "publish", by: "fix" },
		]);
	});

	it("retries the step too when its fix is removed, and can send again if it fails", async () => {
		const { fixes, desk, engine, processes } = await failed();
		await fixes.send("0", "lib", "publish");
		desk.endings.set(7, "removed");
		await fixes.settle();
		const step = stepOf(await engine.get("0"), "lib/publish");
		expect(step.fix?.ended).toBe("removed");
		expect(step.retries).toBe(1);
		await processes.started("lib/publish");
		expect(processes.runs).toHaveLength(3);
		(await processes.started("lib/publish")).exit(1);
		await until(
			async () =>
				stepOf(await engine.get("0"), "lib/publish").status === "failed",
		);
		desk.next = 8;
		expect((await fixes.send("0", "lib", "publish")).task).toBe(8);
	});

	it("retries a fix that merged while the server was down", async () => {
		const { fixes, desk, engine, storage } = await failed();
		await fixes.send("0", "lib", "publish");
		await engine.disposeAsync();
		desk.endings.set(7, "merged");
		const again = setup(storage);
		const restarted = new ShipFixes(again.engine, desk, new MemoryLogger());
		await again.engine.resume();
		await restarted.settle();
		(await again.processes.started("lib/publish")).exit(0);
		await until(async () => (await again.engine.get("0"))?.status === "done");
	});

	it("lets any task retry a failed step, the run naming it", async () => {
		const { fixes, processes } = await failed();
		const state = await fixes.retry("0", "lib", "publish", "other");
		expect(stepOf(state, "lib/publish").status).not.toBe("failed");
		await processes.started("lib/publish");
		expect(processes.names()).toEqual([
			"lib/test",
			"lib/publish",
			"lib/publish",
		]);
		expect(fixes.retry("0", "lib", "test", "other")).rejects.toThrow(
			"has not failed",
		);
	});
});

const lib: RunTarget = {
	name: "lib",
	command: "bin/lib ship",
	bump: "patch",
	dependencies: [],
	steps: [
		{ id: "test", does: "Test lib" },
		{ id: "skip", does: "Nothing" },
		{ id: "publish", does: "Publish lib", dependencies: ["test"] },
	],
};

class FakeDesk implements FixDesk {
	next = 7;
	readonly added: { subject: string; text: string }[] = [];
	readonly started: number[] = [];
	readonly endings = new Map<number, "merged" | "removed">();
	readonly taken = new Map<number, string>();

	async add(subject: string, text: string): Promise<number> {
		this.added.push({ subject, text });
		return this.next;
	}

	async start(task: number): Promise<void> {
		this.started.push(task);
	}

	async ended(task: number): Promise<"merged" | "removed" | null> {
		return this.endings.get(task) ?? null;
	}

	async takenBy(task: number): Promise<string | null> {
		return this.taken.get(task) ?? null;
	}
}

/** A run of `lib` whose `publish` failed. */
async function failed() {
	const made = setup();
	made.processes.done_.set("lib/skip", true);
	await made.engine.start([lib]);
	(await made.processes.started("lib/test")).exit(0);
	const publish = await made.processes.started("lib/publish");
	publish.say({ type: "output", text: "+ npm publish\n" });
	publish.say({ type: "error", message: "npm said 403" });
	publish.exit(1);
	await until(async () => (await made.engine.get("0"))?.status === "failed");
	return made;
}

function setup(storage = new MemoryStorage()) {
	const processes = new FakeStepProcesses();
	const engine = new ShipEngine({
		storage,
		processes,
		clock: { now: () => 1000 },
		ids: new CounterIdProvider(),
		log: new MemoryLogger(),
		wait: () => Bun.sleep(1),
	});
	const desk = new FakeDesk();
	const fixes = new ShipFixes(engine, desk, new MemoryLogger());
	return { storage, processes, engine, desk, fixes };
}

function stepOf(state: RunState | null, name: string): StepState {
	const [target, step] = name.split("/");
	const found = state?.targets
		.find((each) => each.name === target)
		?.steps.find((each) => each.id === step);
	if (found === undefined) {
		throw new Error(`no step ${name}`);
	}
	return found;
}

async function until(check: () => boolean | Promise<boolean>): Promise<void> {
	for (let tries = 0; tries < 2000; tries++) {
		if (await check()) {
			return;
		}
		await Bun.sleep(1);
	}
	throw new Error("never came true");
}

async function events(storage: MemoryStorage, id = "0"): Promise<RunEvent[]> {
	return storage.log<RunEvent>(`${RUNS}/${id}.jsonl`).replay();
}
