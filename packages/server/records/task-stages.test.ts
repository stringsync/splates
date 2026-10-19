import { describe, expect, it } from "bun:test";
import { decodeTask, encodeTask } from "../board";
import { Testing } from "../testing";
import { TASK_STAGES } from "./task-stages";

describe("TASK_STAGES", () => {
	it("runs a started task's stage, keeping the one it left, and drops a waiting one's status", async () => {
		await using deps = await Testing.open();
		const store = `${deps.splatesDir}/tasks`;
		await deps.fs.mkdir(store);
		await deps.fs.write(`${store}/1.md`, encodeTask(task(1, "ready")));
		await deps.fs.write(
			`${store}/2.md`,
			encodeTask({ ...task(2, "queued"), status: "merging", task: "alpha" }),
		);
		await deps.fs.write(
			`${store}/3.md`,
			encodeTask({ ...task(3), status: "working", task: "beta" }),
		);

		await TASK_STAGES.run(deps.splatesDir, deps.fs);

		const read = async (id: number) =>
			decodeTask(await deps.fs.read(`${store}/${id}.md`));
		expect(await read(1)).not.toHaveProperty("status");
		expect(await read(1)).toMatchObject({ stage: "ready", text: "Task 1." });
		expect(await read(2)).toMatchObject({
			stage: "running",
			startedFrom: "queued",
			status: "merging",
		});
		expect(await read(3)).toMatchObject({
			stage: "running",
			startedFrom: "backlog",
		});
		expect((await deps.service.find("alpha")).state?.status).toBe("merging");
	});

	it("comes out the same when run again, as after being cut short", async () => {
		await using deps = await Testing.open();
		const store = `${deps.splatesDir}/tasks`;
		await deps.fs.mkdir(store);
		await deps.fs.write(
			`${store}/1.md`,
			encodeTask({ ...task(1, "queued"), status: "working", task: "alpha" }),
		);
		await TASK_STAGES.run(deps.splatesDir, deps.fs);
		const once = await deps.fs.read(`${store}/1.md`);

		await TASK_STAGES.run(deps.splatesDir, deps.fs);

		expect(await deps.fs.read(`${store}/1.md`)).toBe(once);
	});
});

function task(id: number, stage?: string): Record<string, unknown> {
	return {
		id,
		subject: `Task ${id}`,
		text: `Task ${id}.`,
		position: id,
		from: null,
		createdAt: "2026-10-01T00:00:00.000Z",
		takenBy: null,
		files: [],
		blockedBy: [],
		lane: null,
		...(stage === undefined ? {} : { stage }),
		...(stage === undefined || stage === "running" ? {} : { status: "queued" }),
	};
}
