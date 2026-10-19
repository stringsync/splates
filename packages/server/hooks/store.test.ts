import { describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { HookStore } from "./store";

describe("HookStore", () => {
	it("keeps each event's hooks in order, and takes them away by place or all", async () => {
		const fs = new FakeFs();
		await fs.mkdir("/repo/.git/splates", { recursive: true });
		const hooks = new HookStore("/repo/.git/splates/hooks.json", fs);
		expect(await hooks.read()).toEqual({});

		await hooks.add("task.created", { kind: "run", command: "notify" });
		await hooks.add("task.created", {
			kind: "agent",
			prompt: "say hi",
			agent: "claude",
		});

		expect(
			(await hooks.read())["task.created"]?.map(({ kind }) => kind),
		).toEqual(["run", "agent"]);

		await hooks.remove("task.created", 1);
		expect(
			(await hooks.read())["task.created"]?.map(({ kind }) => kind),
		).toEqual(["agent"]);
		await hooks.remove("task.created");
		expect(await hooks.read()).toEqual({});
	});

	it("refuses an event that is none", async () => {
		const hooks = new HookStore("/hooks.json", new FakeFs());

		await expect(
			hooks.add("task.made", { kind: "run", command: "x" }),
		).rejects.toThrow("no task event");
	});
});
