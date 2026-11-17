import { describe, expect, it } from "bun:test";
import { CounterIdProvider } from "core/id";
import { MemoryLogger } from "core/log";
import { MemoryStorage } from "../storage/testing";
import { RUNS, ShipEngine } from "./engine";
import { RunError } from "./run-error";
import type { RunEvent, RunTarget } from "./run-events";
import type { RunState, StepStatus } from "./run-state";
import { FakeStepProcesses } from "./testing";

describe("ShipEngine", () => {
	it("runs steps with no order between them together, then what waits on them", async () => {
		const { processes, engine } = setup();
		await engine.start([lib]);
		await until(() => processes.runs.length === 2);
		expect(processes.names().sort()).toEqual(["lib/lint", "lib/test"]);
		(await processes.started("lib/test")).exit(0);
		await Bun.sleep(5);
		expect(processes.names()).not.toContain("lib/publish");
		(await processes.started("lib/lint")).exit(0);
		(await processes.started("lib/publish")).exit(0);
		await until(async () => (await engine.get("0"))?.status === "done");
	});

	it("stops a run: ends each step's process, keeps it stopped and frees the next ship", async () => {
		const { processes, engine } = setup();
		await engine.start([lib]);
		const test = await processes.started("lib/test");
		const stopped = await engine.stop("0");
		expect(stopped.status).toBe("stopped");
		expect(test.stopped).toBe(true);
		await Bun.sleep(5);
		expect(status(await engine.get("0"), "lib/test")).toBe("pending");
		expect(processes.names()).not.toContain("lib/publish");
		expect(engine.stop("0")).rejects.toBeInstanceOf(RunError);
		await engine.start([lib]);
	});

	it("stops a run that stopped on a failure, which frees the next ship", async () => {
		const { processes, engine } = setup();
		await engine.start([lib]);
		(await processes.started("lib/test")).exit(1);
		(await processes.started("lib/lint")).exit(0);
		await until(async () => (await engine.get("0"))?.status === "failed");
		expect((await engine.stop("0")).status).toBe("stopped");
		await engine.start([lib]);
	});

	it("passes each step its target's flags and what its upstream released", async () => {
		const { processes, engine } = setup();
		await engine.start([lib, app]);
		(await processes.started("lib/test")).exit(0);
		(await processes.started("lib/lint")).exit(0);
		const publish = await processes.started("lib/publish");
		expect(publish.request).toEqual({
			command: "bin/lib ship",
			target: "lib",
			step: "publish",
			bump: "patch",
			upstream: {},
		});
		expect(processes.names()).not.toContain("app/pin");
		publish.say({ type: "released", version: "1.5.0" });
		publish.exit(0);
		const pin = await processes.started("app/pin");
		expect(pin.request.upstream).toEqual({ lib: "1.5.0" });
		expect(pin.request.bump).toBeUndefined();
	});

	it("passes on what a step skipped as done found released", async () => {
		const { processes, engine } = setup();
		processes.done_.set("lib/publish", true);
		processes.released_.set("lib/publish", "1.4.0");
		await engine.start([lib, app]);
		(await processes.started("lib/test")).exit(0);
		(await processes.started("lib/lint")).exit(0);
		const pin = await processes.started("app/pin");
		expect(status(await engine.get("0"), "lib/publish")).toBe("skipped");
		expect(pin.request.upstream).toEqual({ lib: "1.4.0" });
	});

	it("skips a step whose done is true", async () => {
		const { processes, engine } = setup();
		processes.done_.set("app/pin", true);
		await engine.start([app]);
		await until(async () => (await engine.get("0"))?.status === "done");
		expect(status(await engine.get("0"), "app/pin")).toBe("skipped");
		expect(processes.runs).toEqual([]);
	});

	it("records output, updates and the error a failed step wrote", async () => {
		const { storage, processes, engine } = setup();
		await engine.start([app]);
		const pin = await processes.started("app/pin");
		pin.say({ type: "output", text: "pinning\nst" });
		pin.say({ type: "output", text: "ill\n" });
		pin.say({ type: "update", line: "Pinned half" });
		pin.say({ type: "error", message: "no lib on npm" });
		pin.exit(1);
		await until(async () => (await engine.get("0"))?.status === "failed");
		const [step] = (await engine.get("0"))?.targets[0]?.steps ?? [];
		expect(step).toMatchObject({
			status: "failed",
			update: "Pinned half",
			output: ["pinning", "still", ""],
			error: "no lib on npm",
		});
		await engine.flushed();
		expect((await events(storage)).map((each) => each.type)).toEqual([
			"started",
			"checking",
			"running",
			"output",
			"output",
			"update",
			"ended",
		]);
	});

	it("stops what depends on a failed step, keeps the rest, and retries it", async () => {
		const { processes, engine } = setup();
		await engine.start([lib, app]);
		(await processes.started("lib/test")).exit(1);
		await until(
			async () => status(await engine.get("0"), "lib/publish") === "blocked",
		);
		expect(status(await engine.get("0"), "app/pin")).toBe("blocked");
		// lint goes on, since it does not wait on test
		(await processes.started("lib/lint")).exit(0);
		await until(async () => (await engine.get("0"))?.status === "failed");
		expect(status(await engine.get("0"), "lib/lint")).toBe("done");

		const retried = await engine.retry("0", "lib", "test");
		expect(status(retried, "lib/publish")).toBe("pending");
		await until(
			() =>
				processes.runs.filter((each) => each.request.step === "test").length ===
				2,
		);
		(await processes.started("lib/test")).exit(0);
		(await processes.started("lib/publish")).exit(0);
		(await processes.started("app/pin")).exit(0);
		await until(async () => (await engine.get("0"))?.status === "done");
	});

	it("refuses to retry a step that has not failed", async () => {
		const { engine } = setup();
		await engine.start([app]);
		expect(engine.retry("0", "app", "pin")).rejects.toThrow(RunError);
	});

	it("fails a step whose done throws", async () => {
		const { processes, engine } = setup();
		processes.done_.set("app/pin", "done exited 2");
		await engine.start([app]);
		await until(async () => (await engine.get("0"))?.status === "failed");
		expect((await engine.get("0"))?.targets[0]?.steps[0]?.error).toBe(
			"done exited 2",
		);
	});

	it("relays a prompt and its answer", async () => {
		const { processes, engine } = setup();
		await engine.start([app]);
		const pin = await processes.started("app/pin");
		pin.say({ type: "prompt", id: "p1", kind: "confirm", question: "Pin?" });
		await until(
			async () => status(await engine.get("0"), "app/pin") === "waiting",
		);
		expect((await engine.get("0"))?.targets[0]?.steps[0]?.prompts).toEqual([
			{ id: "p1", prompt: { kind: "confirm", question: "Pin?" }, at: 1000 },
		]);
		expect(engine.answer("0", "app", "pin", "p1", "yes")).rejects.toThrow(
			"takes a boolean",
		);
		const state = await engine.answer("0", "app", "pin", "p1", true);
		expect(pin.answers).toEqual([{ id: "p1", value: true }]);
		expect(status(state, "app/pin")).toBe("running");
		expect(engine.answer("0", "app", "pin", "p1", true)).rejects.toThrow(
			"is not asking",
		);
	});

	it("drops a withdrawn prompt", async () => {
		const { processes, engine } = setup();
		await engine.start([app]);
		const pin = await processes.started("app/pin");
		pin.say({ type: "prompt", id: "p1", kind: "ask", question: "Token?" });
		pin.say({ type: "withdrawn", id: "p1" });
		await until(
			async () => status(await engine.get("0"), "app/pin") === "running",
		);
		expect((await engine.get("0"))?.targets[0]?.steps[0]?.prompts).toEqual([]);
	});

	it("keeps the sign-in link a step went through until it runs again", async () => {
		const { processes, engine } = setup();
		await engine.start([app]);
		const pin = await processes.started("app/pin");
		pin.say({ type: "prompt", id: "p1", kind: "link", url: "https://x.test" });
		pin.say({ type: "withdrawn", id: "p1" });
		await until(
			async () => status(await engine.get("0"), "app/pin") === "running",
		);
		expect((await engine.get("0"))?.targets[0]?.steps[0]?.signedIn).toBe(
			"https://x.test",
		);
	});

	it("runs one ship at a time", async () => {
		const { engine } = setup();
		await engine.start([app]);
		expect(engine.start([lib])).rejects.toThrow("one runs at a time");
	});

	it("tells a subscriber of each event", async () => {
		const { processes, engine } = setup();
		await engine.start([app]);
		const heard: string[] = [];
		const watch = await engine.subscribe("0", (event) =>
			heard.push(event.type),
		);
		(await processes.started("app/pin")).exit(0);
		await until(() => heard.includes("ended"));
		watch.dispose();
		expect(heard).toEqual(["ended"]);
	});

	it("tells a listener of every run as each event leaves it", async () => {
		const { processes, engine } = setup();
		const heard: string[] = [];
		const listening = engine.listen((id, state) =>
			heard.push(`${id} ${state.status}`),
		);
		await engine.start([app]);
		(await processes.started("app/pin")).exit(0);
		await until(() => heard.length > 0);
		listening.dispose();
		expect(heard[0]).toStartWith("0 ");
	});

	it("asks done again after a restart of a step that was mid-flight, once its old process is gone", async () => {
		const storage = new MemoryStorage();
		const first = setup(storage);
		await first.engine.start([lib]);
		const test = await first.processes.started("lib/test");
		(await first.processes.started("lib/lint")).exit(0);
		await until(
			async () => status(await first.engine.get("0"), "lib/lint") === "done",
		);
		await first.engine.disposeAsync();
		// The server is gone; the old test process lives on a moment.
		const second = setup(storage);
		second.processes.living.add(test.pid);
		second.processes.done_.set("lib/test", true);
		await second.engine.resume();
		expect(status(await second.engine.get("0"), "lib/test")).toBe("pending");
		await Bun.sleep(10);
		expect(second.processes.asked).toEqual([]);
		second.processes.living.delete(test.pid);
		await until(
			async () =>
				status(await second.engine.get("0"), "lib/test") === "skipped",
		);
		// lint finished before the restart, so it is not asked again
		expect(second.processes.asked.map((each) => each.step)).toEqual([
			"test",
			"publish",
		]);
		(await second.processes.started("lib/publish")).exit(0);
		await until(async () => (await second.engine.get("0"))?.status === "done");
		await second.engine.flushed();
		expect((await events(storage)).map((each) => each.type)).toContain(
			"resumed",
		);
	});

	it("runs again after a restart a step stopped while a prompt waited, which asks again", async () => {
		const storage = new MemoryStorage();
		const first = setup(storage);
		await first.engine.start([app]);
		const pin = await first.processes.started("app/pin");
		pin.say({ type: "prompt", id: "p1", kind: "ask", question: "OTP?" });
		await until(
			async () => status(await first.engine.get("0"), "app/pin") === "waiting",
		);
		await first.engine.disposeAsync();

		const second = setup(storage);
		await second.engine.resume();
		const again = await second.processes.started("app/pin");
		expect(
			(await second.engine.get("0"))?.targets[0]?.steps[0]?.prompts,
		).toEqual([]);
		again.say({ type: "prompt", id: "p2", kind: "ask", question: "OTP?" });
		await until(
			async () => status(await second.engine.get("0"), "app/pin") === "waiting",
		);
		await second.engine.answer("0", "app", "pin", "p2", "123456");
		expect(again.answers).toEqual([{ id: "p2", value: "123456" }]);
	});

	it("takes back a step a worker kept through a restart, replaying from the frame written down, with its prompt still open", async () => {
		const storage = new MemoryStorage();
		const first = setup(storage);
		first.processes.worker = true;
		await first.engine.start([app]);
		const pin = await first.processes.started("app/pin");
		pin.say({ type: "output", text: "building\n" }, 3);
		pin.say({ type: "prompt", id: "p1", kind: "ask", question: "OTP?" }, 4);
		await until(
			async () => status(await first.engine.get("0"), "app/pin") === "waiting",
		);
		await first.engine.flushed();
		expect(pin.acked).toEqual([3, 4]);
		expect(await first.engine.detachAsync()).toBe(true);

		const second = setup(storage);
		second.processes.worker = true;
		await second.engine.resume();
		const again = await second.processes.started("app/pin");
		expect(second.processes.taken.map((each) => each.held)).toEqual([4]);
		// Not asked, not run again: the same process carries on.
		expect(second.processes.asked).toEqual([]);
		await until(
			async () => status(await second.engine.get("0"), "app/pin") === "waiting",
		);
		const open = (await second.engine.get("0"))?.targets[0]?.steps[0];
		expect(open?.prompts.map((each) => each.id)).toEqual(["p1"]);
		await second.engine.answer("0", "app", "pin", "p1", "123456");
		expect(again.answers).toEqual([{ id: "p1", value: "123456" }]);
		again.exit(0);
		await until(async () => (await second.engine.get("0"))?.status === "done");
		expect(second.processes.names()).toEqual(["app/pin"]);
	});

	it("checks and runs again a step the worker no longer holds after a restart", async () => {
		const storage = new MemoryStorage();
		const first = setup(storage);
		first.processes.worker = true;
		await first.engine.start([app]);
		await first.processes.started("app/pin");
		await first.engine.detachAsync();

		const second = setup(storage);
		second.processes.worker = true;
		second.processes.lost = true;
		await second.engine.resume();
		await until(() => second.processes.runs.length === 2);
		const again = await second.processes.started("app/pin");
		expect(again.handle).not.toBeNull();
		again.exit(0);
		await until(async () => (await second.engine.get("0"))?.status === "done");
	});

	it("leaves a finished run be after a restart", async () => {
		const storage = new MemoryStorage();
		const first = setup(storage);
		await first.engine.start([app]);
		(await first.processes.started("app/pin")).exit(0);
		await until(async () => (await first.engine.get("0"))?.status === "done");
		await first.engine.disposeAsync();

		const second = setup(storage);
		expect((await second.engine.list()).map((each) => each.status)).toEqual([
			"done",
		]);
		await Bun.sleep(5);
		expect(second.processes.asked).toEqual([]);
	});
});

const lib: RunTarget = {
	name: "lib",
	command: "bin/lib ship",
	bump: "patch",
	dependencies: [],
	steps: [
		{ id: "test", does: "Test lib" },
		{ id: "lint", does: "Lint lib" },
		{ id: "publish", does: "Publish lib", dependencies: ["test", "lint"] },
	],
};

const app: RunTarget = {
	name: "app",
	command: "bin/app ship",
	dependencies: ["lib"],
	steps: [{ id: "pin", does: "Pin lib" }],
};

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
	return { storage, processes, engine };
}

/** Waits until `check` holds, failing the test after a while. */
async function until(check: () => boolean | Promise<boolean>): Promise<void> {
	for (let tries = 0; tries < 2000; tries++) {
		if (await check()) {
			return;
		}
		await Bun.sleep(1);
	}
	throw new Error("never came true");
}

function status(state: RunState | null, name: string): StepStatus | undefined {
	const [target, step] = name.split("/");
	return state?.targets
		.find((each) => each.name === target)
		?.steps.find((each) => each.id === step)?.status;
}

async function events(storage: MemoryStorage, id = "0"): Promise<RunEvent[]> {
	return storage.log<RunEvent>(`${RUNS}/${id}.jsonl`).replay();
}
