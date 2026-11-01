import { describe, expect, it } from "bun:test";
import { decodeTask, encodeTask } from "../board";
import { Testing } from "../testing";
import { AVAILABLE_STAGE } from "./available-stage";

describe("AVAILABLE_STAGE", () => {
	it("merges the backlog and ready into available, and drops the groomed and sorted marks", async () => {
		await using deps = await Testing.open();
		const tasks = deps.storage.collection("tasks");
		const removed = deps.storage.collection("tasks/removed");
		await tasks.write("1.md", encodeTask(task(1, { stage: "backlog" })));
		await tasks.write(
			"2.md",
			encodeTask(task(2, { stage: "ready", groomed: true, sorted: true })),
		);
		await tasks.write("3.md", encodeTask(task(3, { stage: "queued" })));
		await tasks.write(
			"4.md",
			encodeTask(
				task(4, {
					stage: "running",
					startedFrom: "ready",
					task: "alpha",
					groomed: true,
				}),
			),
		);
		await removed.write("5.md", encodeTask(task(5, { stage: "ready" })));

		await AVAILABLE_STAGE.run(deps.splatesDir, deps.fs, into(deps));

		const read = async (id: number, from = tasks) =>
			decodeTask((await from.read(`${id}.md`)) ?? "");
		expect(await read(1)).toMatchObject({ stage: "available" });
		expect(await read(2)).toMatchObject({ stage: "available" });
		expect(await read(2)).not.toHaveProperty("groomed");
		expect(await read(2)).not.toHaveProperty("sorted");
		expect(await read(3)).toMatchObject({ stage: "queued" });
		expect(await read(4)).toMatchObject({
			stage: "running",
			startedFrom: "available",
			task: "alpha",
		});
		expect(await read(4)).not.toHaveProperty("groomed");
		expect(await read(5, removed)).toMatchObject({ stage: "available" });
		expect(await read(1)).toMatchObject({ text: "Task 1." });
	});

	it("comes out the same when run again, as after being cut short", async () => {
		await using deps = await Testing.open();
		const tasks = deps.storage.collection("tasks");
		await tasks.write(
			"1.md",
			encodeTask(task(1, { stage: "ready", groomed: true })),
		);
		await AVAILABLE_STAGE.run(deps.splatesDir, deps.fs, into(deps));
		const once = await tasks.read("1.md");

		await AVAILABLE_STAGE.run(deps.splatesDir, deps.fs, into(deps));

		expect(await tasks.read("1.md")).toBe(once);
	});
});

/** What `Format` hands a step once the records are in the database. */
function into(deps: Testing) {
	return { import: async () => {}, storage: async () => deps.storage };
}

function task(id: number, more: Record<string, unknown>) {
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
		...more,
	} as Parameters<typeof encodeTask>[0];
}
