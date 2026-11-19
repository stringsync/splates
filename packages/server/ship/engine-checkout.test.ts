import { describe, expect, it } from "bun:test";
import { CounterIdProvider } from "core/id";
import { MemoryLogger } from "core/log";
import { MemoryStorage } from "../storage/testing";
import { RUNS, type RunCheckouts, ShipEngine } from "./engine";
import type { RunEvent, RunTarget } from "./run-events";
import { FakeStepProcesses } from "./testing";

describe("ShipEngine with run checkouts", () => {
	it("runs every step on the commit it started on, in the run's checkout, and removes it once done", async () => {
		const { engine, processes, checkouts, storage } = setup();
		const state = await engine.start([lib]);
		expect(state.commit).toBe("c1");
		checkouts.head_ = "c2";
		(await processes.started("lib/test")).exit(0);
		const publish = await processes.started("lib/publish");
		expect(publish.request.cwd).toBe("/ships/0");
		expect(processes.asked.map((each) => each.cwd)).toEqual([
			"/ships/0",
			"/ships/0",
		]);
		publish.exit(0);
		await until(async () => (await engine.get("0"))?.status === "done");
		await until(() => checkouts.released.length === 1);
		expect(checkouts.readied).toEqual([["0", "c1"]]);
		expect((await events(storage))[0]).toMatchObject({
			type: "started",
			commit: "c1",
		});
	});

	it("takes a merged fix into the checkout before the retry, and nothing else", async () => {
		const { engine, processes, checkouts, storage } = setup();
		await failedPublish(engine, processes);
		await engine.sent("0", "lib", "publish", 7);
		await engine.fixed("0", "lib", "publish", 7, "merged", "fix1");
		expect(checkouts.applied).toEqual([["0", "c1", "fix1"]]);
		expect((await engine.get("0"))?.commit).toBe("c1+fix1");
		(await processes.started("lib/publish")).exit(0);
		await until(async () => (await engine.get("0"))?.status === "done");
		expect(
			(await events(storage)).find((each) => each.type === "advanced"),
		).toEqual({ type: "advanced", at: 1000, task: 7, commit: "c1+fix1" });
	});

	it("leaves the step failed, saying why, when the merged fix will not apply", async () => {
		const { engine, processes, checkouts } = setup();
		await failedPublish(engine, processes);
		checkouts.refuse = "conflict in a.ts";
		await engine.sent("0", "lib", "publish", 7);
		const after = await engine.fixed("0", "lib", "publish", 7, "merged", "x");
		const publish = after.targets[0]?.steps.find(
			(each) => each.id === "publish",
		);
		expect(publish?.status).toBe("failed");
		expect(publish?.error).toContain("conflict in a.ts");
		expect(publish?.retries).toBeUndefined();
		expect(after.commit).toBe("c1");
	});

	it("fails a step whose checkout cannot be made", async () => {
		const { engine, checkouts } = setup();
		checkouts.broken = "bun install exited 1";
		await engine.start([lib]);
		await until(async () => (await engine.get("0"))?.status === "failed");
		const test = (await engine.get("0"))?.targets[0]?.steps[0];
		expect(test?.error).toContain("bun install exited 1");
	});

	it("removes a stopped run's checkout once its steps are gone", async () => {
		const { engine, processes, checkouts } = setup();
		await engine.start([lib]);
		await processes.started("lib/test");
		await engine.stop("0");
		await until(() => checkouts.released.length === 1);
	});
});

class FakeCheckouts implements RunCheckouts {
	head_ = "c1";
	readied: [string, string][] = [];
	applied: [string, string, string][] = [];
	released: string[] = [];
	refuse?: string;
	broken?: string;

	async head(): Promise<string> {
		return this.head_;
	}

	async ready(run: string, commit: string): Promise<string> {
		if (this.broken !== undefined) {
			throw new Error(this.broken);
		}
		this.readied.push([run, commit]);
		return `/ships/${run}`;
	}

	async apply(run: string, commit: string, landed: string): Promise<string> {
		if (this.refuse !== undefined) {
			throw new Error(this.refuse);
		}
		this.applied.push([run, commit, landed]);
		return `${commit}+${landed}`;
	}

	async release(run: string): Promise<void> {
		this.released.push(run);
	}
}

const lib: RunTarget = {
	name: "lib",
	command: "bin/lib ship",
	bump: "patch",
	dependencies: [],
	steps: [
		{ id: "test", does: "Test lib" },
		{ id: "publish", does: "Publish lib", dependencies: ["test"] },
	],
};

function setup() {
	const storage = new MemoryStorage();
	const processes = new FakeStepProcesses();
	const checkouts = new FakeCheckouts();
	const engine = new ShipEngine({
		storage,
		processes,
		checkouts,
		clock: { now: () => 1000 },
		ids: new CounterIdProvider(),
		log: new MemoryLogger(),
		wait: () => Bun.sleep(1),
	});
	return { storage, processes, checkouts, engine };
}

async function failedPublish(
	engine: ShipEngine,
	processes: FakeStepProcesses,
): Promise<void> {
	await engine.start([lib]);
	(await processes.started("lib/test")).exit(0);
	(await processes.started("lib/publish")).exit(1);
	await until(async () => (await engine.get("0"))?.status === "failed");
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

async function events(storage: MemoryStorage): Promise<RunEvent[]> {
	return storage.log<RunEvent>(`${RUNS}/0.jsonl`).replay();
}
