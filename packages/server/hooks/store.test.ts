import { describe, expect, it } from "bun:test";
import { callOf, STANDARD_SIGNAL_FUNCTIONS } from "../signals/call";
import { MemoryStorage } from "../storage/testing";
import { GROOM_PROMPT, HookStore } from "./store";

describe("HookStore", () => {
	it("numbers each automation, and takes them away by number or by event", async () => {
		const hooks = new HookStore(new MemoryStorage());
		expect(await hooks.read()).toEqual([]);

		await hooks.add(
			{ event: "task.created", filter: { stages: ["available"] } },
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

	it("takes a signal trigger, and refuses a name that is no <project>.<name>", async () => {
		const hooks = new HookStore(new MemoryStorage());
		const run = { kind: "run" as const, command: "tidy" };
		await hooks.add({ signal: "mdom.released" }, run);
		expect((await hooks.read())[0]?.trigger).toEqual({
			signal: "mdom.released",
		});
		expect(hooks.add({ signal: "released" }, run)).rejects.toThrow();
	});

	it("keeps a call on a signal function in its canonical spelling", async () => {
		const hooks = new HookStore(new MemoryStorage());
		const run = { kind: "run" as const, command: "x" };
		await hooks.add({ signal: "clock.in( '2 days' )" }, run);
		const [added] = await hooks.read();
		expect(added?.trigger).toEqual({
			signal: callOf('clock.in("2 days")', STANDARD_SIGNAL_FUNCTIONS).canonical,
		});
	});

	it("names an automation, trims it, and clears it when edited blank", async () => {
		const hooks = new HookStore(new MemoryStorage());
		const run = { kind: "run" as const, command: "tidy" };
		await hooks.add({ every: "1h" }, run, "  Tidy up ");
		await hooks.add({ every: "2h" }, run);
		const [first, second] = await hooks.read();
		expect(first?.name).toBe("Tidy up");
		expect(second).not.toHaveProperty("name");

		await hooks.edit("1", { every: "1h" }, run, "");
		expect((await hooks.read())[0]).not.toHaveProperty("name");
	});

	it("turns a stored built-in groomer into a regular automation on a task added", async () => {
		const storage = new MemoryStorage();
		await storage.document("hooks.json").write({
			automations: [
				{
					id: "1",
					trigger: { every: "1h" },
					hook: { kind: "run", command: "x" },
					createdAt: "2026-10-01T00:00:00.000Z",
				},
				{
					id: "groomer",
					trigger: { event: "task.created", filter: { stages: ["available"] } },
					hook: { kind: "groom", agent: "claude", model: "sonnet" },
					createdAt: "2026-10-01T00:00:00.000Z",
					paused: true,
					source: "builtin",
				},
			],
		});

		const hooks = new HookStore(storage);
		const [, groomer] = await hooks.read();
		expect(groomer).toEqual({
			id: "2",
			name: "Groom",
			trigger: { event: "task.created" },
			hook: {
				kind: "agent",
				prompt: GROOM_PROMPT,
				agent: "claude",
				model: "sonnet",
			},
			createdAt: "2026-10-01T00:00:00.000Z",
			paused: true,
		});
		await hooks.edit(
			"2",
			{ event: "task.created" },
			{ kind: "run", command: "y" },
		);
		expect((await hooks.read()).map(({ id }) => id)).toEqual(["1", "2"]);
	});

	it("ignores retired notes automations while converting the groomer", async () => {
		const storage = new MemoryStorage();
		await storage.document("hooks.json").write({
			automations: [
				...["notes-audit", "notes-gardener"].map((id) => ({
					id,
					trigger: { every: "7d" },
					hook: {
						kind: id === "notes-audit" ? "audit" : "garden",
						agent: "claude",
					},
					source: "builtin",
					createdAt: "2026-10-20T00:00:00.000Z",
				})),
				{
					id: "groomer",
					trigger: { every: "1d" },
					hook: { kind: "groom", agent: "claude" },
					source: "builtin",
					createdAt: "2026-10-20T00:00:00.000Z",
				},
			],
		});
		expect(await new HookStore(storage).read()).toMatchObject([
			{
				id: "1",
				hook: { kind: "agent", agent: "claude" },
				trigger: { event: "task.created" },
			},
		]);
	});

	it("asks one on a schedule to run now, refusing one on another event", async () => {
		const hooks = new HookStore(new MemoryStorage());
		await hooks.add({ every: "1h" }, { kind: "run", command: "tidy" });
		await hooks.add({ event: "task.done" }, { kind: "run", command: "ship" });

		expect(await hooks.request("1")).toMatchObject({
			requestedAt: expect.any(String),
		});
		expect(hooks.request("2")).rejects.toThrow(
			"runs on task.done, for that event's tasks",
		);
		expect(hooks.request("7")).rejects.toThrow("no automation 7");
	});

	it("pauses one and lets it run again", async () => {
		const hooks = new HookStore(new MemoryStorage());
		await hooks.add({ every: "1h" }, { kind: "run", command: "tidy" });

		await hooks.pause("1", true);
		expect((await hooks.read())[0]?.paused).toBe(true);
		await hooks.pause("1", false);
		expect((await hooks.read())[0]).not.toHaveProperty("paused");
	});

	it("records the signal function a call is on, and drops it when the trigger is no call of one", async () => {
		const hooks = new HookStore(new MemoryStorage(), () => ({
			"aws.ready": { args: {}, main: undefined } as never,
		}));
		await hooks.add({ signal: "aws.ready" }, { kind: "run", command: "x" });
		await hooks.add({ signal: "mdom.released" }, { kind: "run", command: "x" });
		await hooks.add(
			{ signal: 'clock.in("2 days")' },
			{ kind: "run", command: "x" },
		);
		expect((await hooks.read()).map(({ family }) => family)).toEqual([
			"aws.ready",
			undefined,
			"clock.in",
		]);
		await hooks.edit(
			"1",
			{ signal: "mdom.released" },
			{ kind: "run", command: "x" },
		);
		expect((await hooks.read())[0]).not.toHaveProperty("family");
	});

	it("pauses with a notice that resuming clears, and finishes one for good", async () => {
		const hooks = new HookStore(new MemoryStorage());
		await hooks.add({ signal: "mdom.released" }, { kind: "run", command: "x" });
		await hooks.pause("1", true, "Source removed: signal expired");
		expect((await hooks.read())[0]?.notice).toBe(
			"Source removed: signal expired",
		);
		await hooks.pause("1", false);
		expect((await hooks.read())[0]).not.toHaveProperty("notice");
		await hooks.finish("1", "2026-11-19T09:00:00.000Z");
		expect((await hooks.read())[0]?.finishedAt).toBe(
			"2026-11-19T09:00:00.000Z",
		);
	});

	it("resumes a paused-with-notice or finished one when its signal changes", async () => {
		const hooks = new HookStore(new MemoryStorage());
		const run = { kind: "run" as const, command: "x" };
		await hooks.add({ signal: "mdom.released" }, run);
		await hooks.pause("1", true, "Source removed: signal expired");
		await hooks.edit("1", { signal: "mdom.released" }, run);
		expect((await hooks.read())[0]?.paused).toBe(true);
		await hooks.edit("1", { signal: "vexml.released" }, run);
		const [each] = await hooks.read();
		expect(each).not.toHaveProperty("paused");
		expect(each).not.toHaveProperty("notice");
		await hooks.finish("1", "2026-11-19T09:00:00.000Z");
		await hooks.edit("1", { signal: 'clock.in("1 day")' }, run);
		expect((await hooks.read())[0]).not.toHaveProperty("finishedAt");
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

	it("refuses to edit one that is none, or to a trigger that will not read", async () => {
		const hooks = new HookStore(new MemoryStorage());
		await hooks.add({ every: "1h" }, { kind: "run", command: "tidy" });
		const run = { kind: "run", command: "x" } as const;

		expect(hooks.edit("7", { every: "1h" }, run)).rejects.toThrow(
			"no automation 7",
		);
		expect(hooks.edit("1", { every: "soon" }, run)).rejects.toThrow(
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

		expect(
			hooks.add({ event: "task.made" as "task.created" }, run),
		).rejects.toThrow("no task event");
		expect(
			hooks.add(
				{ event: "task.created", filter: { stages: ["done" as "queued"] } },
				run,
			),
		).rejects.toThrow("no stage");
		expect(hooks.add({ every: "soon" }, run)).rejects.toThrow("no interval");
		expect(hooks.add({ cron: "0 25 * * *" }, run)).rejects.toThrow(
			"no cron line",
		);
		expect(hooks.remove("7")).rejects.toThrow("no automation 7");
	});
});
