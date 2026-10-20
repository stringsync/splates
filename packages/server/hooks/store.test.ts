import { describe, expect, it } from "bun:test";
import { MemoryStorage } from "../storage/testing";
import { HookStore } from "./store";

describe("HookStore", () => {
	it("numbers each automation, and takes them away by number or by event", async () => {
		const hooks = new HookStore(new MemoryStorage());
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

	it("turns the groomer on and off as built-in automation groomer, keeping its pause", async () => {
		const hooks = new HookStore(new MemoryStorage());
		await hooks.add({ event: "task.created" }, { kind: "run", command: "x" });

		await hooks.groomer({ agent: "claude", model: "sonnet" });
		await hooks.pause("groomer", true);
		await hooks.groomer({ agent: "codex" });
		expect((await hooks.read()).at(-1)).toMatchObject({
			id: "groomer",
			source: "builtin",
			trigger: { event: "task.created" },
			hook: { kind: "groom", agent: "codex" },
			paused: true,
		});

		// Its event's hooks go without it; numbering skips it.
		await hooks.remove("task.created");
		await hooks.add({ every: "1h" }, { kind: "run", command: "y" });
		expect((await hooks.read()).map(({ id }) => id)).toEqual(["groomer", "1"]);
		await hooks.groomer(null);
		expect((await hooks.read()).map(({ id }) => id)).toEqual(["1"]);
	});

	it("wakes a groomer saved before its trigger changed as it is now", async () => {
		const storage = new MemoryStorage();
		await storage.document("hooks.json").write({
			automations: [
				{
					id: "groomer",
					trigger: { event: "task.created", filter: { stages: ["backlog"] } },
					hook: { kind: "groom", agent: "claude" },
					createdAt: "2026-10-01T00:00:00.000Z",
					source: "builtin",
				},
			],
		});

		expect((await new HookStore(storage).read())[0]?.trigger).toEqual({
			event: "task.created",
		});
	});

	it("turns the notes audit on weekly, keeping its pause and schedule through a new pick", async () => {
		const hooks = new HookStore(new MemoryStorage());

		await hooks.audit({ agent: "claude" });
		expect((await hooks.read())[0]).toMatchObject({
			id: "notes-audit",
			source: "builtin",
			trigger: { every: "7d" },
			hook: { kind: "audit", agent: "claude" },
		});

		await hooks.audit({ agent: "claude" }, { cron: "0 9 * * 1" });
		await hooks.pause("notes-audit", true);
		await hooks.audit({ agent: "codex", model: "gpt" });
		const audit = (await hooks.read())[0];
		expect(audit).toMatchObject({
			trigger: { cron: "0 9 * * 1" },
			hook: { kind: "audit", agent: "codex", model: "gpt" },
			paused: true,
		});
		// The new schedule counts from when it was set.
		expect(audit?.editedAt).toBeString();

		await expect(
			hooks.audit({ agent: "claude" }, { every: "soon" }),
		).rejects.toThrow("no interval");
		await hooks.audit(null);
		expect(await hooks.read()).toEqual([]);
	});

	it("pauses one and lets it run again", async () => {
		const hooks = new HookStore(new MemoryStorage());
		await hooks.add({ every: "1h" }, { kind: "run", command: "tidy" });

		await hooks.pause("1", true);
		expect((await hooks.read())[0]?.paused).toBe(true);
		await hooks.pause("1", false);
		expect((await hooks.read())[0]).not.toHaveProperty("paused");
	});

	it("edits one in place, keeping its number and pause, and stamps a changed trigger", async () => {
		const hooks = new HookStore(new MemoryStorage());
		await hooks.add({ every: "1h" }, { kind: "run", command: "tidy" });
		await hooks.pause("1", true);

		await hooks.edit("1", { every: "1h" }, { kind: "run", command: "sweep" });
		expect((await hooks.read())[0]).toMatchObject({
			id: "1",
			hook: { command: "sweep" },
			paused: true,
		});
		expect((await hooks.read())[0]).not.toHaveProperty("editedAt");

		await hooks.edit(
			"1",
			{ event: "task.done" },
			{ kind: "agent", prompt: "wrap up", agent: "claude" },
		);
		expect((await hooks.read())[0]).toMatchObject({
			id: "1",
			trigger: { event: "task.done" },
			hook: { kind: "agent", prompt: "wrap up" },
			editedAt: expect.any(String),
		});
	});

	it("refuses to edit the groomer, one that is none, or to a trigger that will not read", async () => {
		const hooks = new HookStore(new MemoryStorage());
		await hooks.add({ every: "1h" }, { kind: "run", command: "tidy" });
		await hooks.groomer({ agent: "claude" });
		const run = { kind: "run", command: "x" } as const;

		await expect(hooks.edit("groomer", { every: "1h" }, run)).rejects.toThrow(
			"no automation groomer",
		);
		await expect(hooks.edit("7", { every: "1h" }, run)).rejects.toThrow(
			"no automation 7",
		);
		await expect(hooks.edit("1", { every: "soon" }, run)).rejects.toThrow(
			"no interval",
		);
	});

	it("reads a file of each event's hooks as automations numbered in event order", async () => {
		const storage = new MemoryStorage();
		await storage.document("hooks.json").write({
			"task.done": [{ kind: "run", command: "ship" }],
			"task.created": [{ kind: "run", command: "notify" }],
		});
		const hooks = new HookStore(storage);

		expect(
			(await hooks.read()).map(({ id, trigger }) => [id, trigger]),
		).toEqual([
			["1", { event: "task.created" }],
			["2", { event: "task.done" }],
		]);
	});

	it("refuses an event, a stage, a schedule or a number that is none", async () => {
		const hooks = new HookStore(new MemoryStorage());
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
