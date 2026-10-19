import { describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { HookStore } from "./store";

describe("HookStore", () => {
	it("numbers each automation, and takes them away by number or by event", async () => {
		const fs = new FakeFs();
		await fs.mkdir("/repo/.git/splates", { recursive: true });
		const hooks = new HookStore("/repo/.git/splates/hooks.json", fs);
		expect(await hooks.read()).toEqual([]);

		await hooks.add(
			{ event: "task.created", filter: { stages: ["backlog"] } },
			{ kind: "run", command: "notify" },
		);
		await hooks.add(
			{ event: "task.created" },
			{ kind: "agent", prompt: "say hi", agent: "claude" },
		);
		await hooks.add({ every: "1h" }, { kind: "run", command: "tidy" });

		expect((await hooks.read()).map(({ id }) => id)).toEqual(["1", "2", "3"]);

		await hooks.remove("1");
		expect((await hooks.read()).map(({ id }) => id)).toEqual(["2", "3"]);
		await hooks.add({ cron: "0 9 * * *" }, { kind: "run", command: "x" });
		expect((await hooks.read()).map(({ id }) => id)).toEqual(["2", "3", "4"]);
		await hooks.remove("task.created");
		expect((await hooks.read()).map(({ id }) => id)).toEqual(["3", "4"]);
	});

	it("pauses one and lets it run again", async () => {
		const hooks = new HookStore("/hooks.json", new FakeFs());
		await hooks.add({ every: "1h" }, { kind: "run", command: "tidy" });

		await hooks.pause("1", true);
		expect((await hooks.read())[0]?.paused).toBe(true);
		await hooks.pause("1", false);
		expect((await hooks.read())[0]).not.toHaveProperty("paused");
	});

	it("reads a file of each event's hooks as automations numbered in event order", async () => {
		const fs = new FakeFs();
		await fs.write(
			"/hooks.json",
			JSON.stringify({
				"task.done": [{ kind: "run", command: "ship" }],
				"task.created": [{ kind: "run", command: "notify" }],
			}),
		);
		const hooks = new HookStore("/hooks.json", fs);

		expect(
			(await hooks.read()).map(({ id, trigger }) => [id, trigger]),
		).toEqual([
			["1", { event: "task.created" }],
			["2", { event: "task.done" }],
		]);
	});

	it("refuses an event, a stage, a schedule or a number that is none", async () => {
		const hooks = new HookStore("/hooks.json", new FakeFs());
		const run = { kind: "run", command: "x" } as const;

		await expect(
			hooks.add({ event: "task.made" as "task.created" }, run),
		).rejects.toThrow("no task event");
		await expect(
			hooks.add(
				{ event: "task.created", filter: { stages: ["done" as "ready"] } },
				run,
			),
		).rejects.toThrow("no stage");
		await expect(hooks.add({ every: "soon" }, run)).rejects.toThrow(
			"no interval",
		);
		await expect(hooks.add({ cron: "0 25 * * *" }, run)).rejects.toThrow(
			"no cron line",
		);
		await expect(hooks.remove("7")).rejects.toThrow("no automation 7");
	});
});
