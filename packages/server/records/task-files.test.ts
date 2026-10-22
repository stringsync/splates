import { describe, expect, it } from "bun:test";
import { decodeTask } from "../board";
import { Testing } from "../testing";
import { TASK_FILES } from "./task-files";

describe("TASK_FILES", () => {
	it("makes each task a markdown file, its text the body, staged as groomed or not", async () => {
		await using deps = await Testing.open();
		const store = `${deps.splatesDir}/tasks`;
		await deps.fs.mkdir(store);
		await deps.fs.write(
			`${store}/1.json`,
			json(queued(1, { lane: 2, assignee: { agent: "claude" } })),
		);
		await deps.fs.write(`${store}/2.json`, json(queued(2, { lane: 2 })));
		await deps.fs.write(
			`${store}/3.json`,
			json({ ...queued(3), status: "working", task: "alpha" }),
		);

		await TASK_FILES.run(deps.splatesDir, deps.fs);

		expect(await deps.fs.exists(`${store}/1.json`)).toBeFalse();
		expect(await deps.fs.read(`${store}/2.md`)).toStartWith("---\n{");
		expect(await deps.fs.read(`${store}/2.md`)).toEndWith(
			"---\nWhat is left of task 2.\n",
		);
		const [one, two] = await deps.legacyRecords().tasks.all();
		expect(one?.state).toMatchObject({
			id: 1,
			stage: "ready",
			text: "What is left of task 1.",
		});
		expect(two?.state.stage).toBe("backlog");
		expect(decodeTask(await deps.fs.read(`${store}/3.md`))).not.toHaveProperty(
			"stage",
		);
		expect((await deps.legacyRecords().service.find("alpha")).state?.id).toBe(
			3,
		);
	});

	it("comes out the same when run again, as after being cut short", async () => {
		await using deps = await Testing.open();
		const store = `${deps.splatesDir}/tasks`;
		await deps.fs.mkdir(store);
		await deps.fs.write(`${store}/1.json`, json(queued(1)));
		await TASK_FILES.run(deps.splatesDir, deps.fs);
		const once = await deps.fs.read(`${store}/1.md`);
		// Cut short after writing the markdown, before the JSON went.
		await deps.fs.write(`${store}/1.json`, json(queued(1)));

		await TASK_FILES.run(deps.splatesDir, deps.fs);

		expect(await deps.fs.read(`${store}/1.md`)).toBe(once);
		expect(await deps.fs.exists(`${store}/1.json`)).toBeFalse();
	});

	it("finds nothing to move in a repository with no tasks yet", async () => {
		await using deps = await Testing.open();

		await TASK_FILES.run(deps.splatesDir, deps.fs);

		expect(await deps.legacyRecords().tasks.all()).toEqual([]);
	});
});

function queued(id: number, more: Record<string, unknown> = {}) {
	return {
		id,
		subject: `Task ${id}`,
		text: `What is left of task ${id}.`,
		position: id,
		from: null,
		createdAt: "2026-10-01T00:00:00.000Z",
		takenBy: null,
		files: [],
		blockedBy: [],
		lane: null,
		status: "queued",
		...more,
	};
}

function json(value: unknown): string {
	return `${JSON.stringify(value, null, "\t")}\n`;
}
