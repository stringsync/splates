import { describe, expect, it } from "bun:test";
import { dirname } from "node:path";
import { Testing } from "../testing";
import { BACKUP, ONE_TASK_STORE } from "./one-task-store";
import { TASK_FILES } from "./task-files";

describe("ONE_TASK_STORE", () => {
	it("makes each todo a queued task under its number, its files beside it", async () => {
		await using deps = await Testing.open();
		const old = await formatOne(deps);

		await toFormatThree(deps);

		const [first, second] = await deps.legacyRecords().tasks.all();
		expect(first?.state).toMatchObject({
			id: 3,
			subject: "Three",
			lane: 1,
			files: [`${deps.splatesDir}/tasks/3/a-shot.png`],
		});
		expect(await deps.fs.read(`${deps.splatesDir}/tasks/3/a-shot.png`)).toBe(
			"png",
		);
		expect(second?.state).toMatchObject({ id: 4, takenBy: "alpha" });
		expect(
			(await deps.legacyRecords().tasks.lanes()).map((lane) => lane.name),
		).toEqual(["Backlog", "Uploads"]);
		expect(
			await deps.fs.read(`${deps.splatesDir}/tasks/removed/2.json`),
		).toContain(`${deps.splatesDir}/tasks/2/b-gone.png`);
		expect(await deps.fs.read(`${deps.splatesDir}/lane-tasks.json`)).toBe(
			"[]\n",
		);
		expect(
			await deps.fs.exists(`${deps.splatesDir}/groomed-tasks/3`),
		).toBeTrue();
		// The old records stay as they were, as a backup.
		expect(
			await deps.fs.read(`${deps.splatesDir}/${BACKUP}/todos/3.json`),
		).toBe(old.todo3);
		expect(await deps.fs.exists(`${deps.splatesDir}/todos`)).toBeFalse();
		expect(await deps.fs.exists(`${deps.splatesDir}/lane-todos.json`)).toBe(
			false,
		);
	});

	it("starts each task under the lowest todo it took, or a number of its own off the list", async () => {
		await using deps = await Testing.open();
		await formatOne(deps);

		await toFormatThree(deps);

		const alpha = await deps.legacyRecords().service.find("alpha");
		expect(alpha.state).toMatchObject({
			id: 4,
			task: "alpha",
			// Escalated before escalating was retired, so at work again.
			status: "working",
			createdAt: "2026-10-01T00:00:00.000Z",
			mergeAttempts: 2,
		});
		const beta = await deps.legacyRecords().service.find("beta");
		expect(beta.state).toMatchObject({ id: 8, task: "beta" });
		expect(
			(await deps.legacyRecords().service.list()).map(({ task }) => task),
		).toEqual(["alpha", "beta"]);
		// Todo 4 is alpha now, still on the list; 5 waits on alpha to land.
		expect(
			(await deps.legacyRecords().tasks.all()).map((todo) => todo.id),
		).toEqual([3, 4, 5]);
		expect(await deps.fs.read(`${deps.splatesDir}/tasks/last`)).toBe("8");
		expect(await deps.fs.read(`${deps.splatesDir}/tasks/4/started/q.png`)).toBe(
			"question",
		);
	});

	it("comes out the same when run again, as after being cut short", async () => {
		await using deps = await Testing.open();
		await formatOne(deps);
		await ONE_TASK_STORE.run(deps.splatesDir, deps.fs);
		const once = await deps.fs.read(`${deps.splatesDir}/tasks/4.json`);

		await ONE_TASK_STORE.run(deps.splatesDir, deps.fs);

		expect(await deps.fs.read(`${deps.splatesDir}/tasks/4.json`)).toBe(once);
		expect(await deps.fs.read(`${deps.splatesDir}/tasks/last`)).toBe("8");
	});

	it("finds nothing to move in a repository with no records yet", async () => {
		await using deps = await Testing.open();

		await toFormatThree(deps);

		expect(await deps.legacyRecords().tasks.all()).toEqual([]);
		expect(await deps.legacyRecords().service.list()).toEqual([]);
	});
});

/**
 * Lays out records as format 1 kept them: todos 3, 4 and 5, 2 removed, last
 * handed out 7; task alpha holding 4 and 5, beta holding none.
 */
async function formatOne(deps: Testing): Promise<{ todo3: string }> {
	const dir = deps.splatesDir;
	await deps.fs.rm(`${dir}/tasks`, { recursive: true, force: true });
	const write = deps.fs.write.bind(deps.fs);
	const fs = {
		write: async (path: string, data: string) => {
			await deps.fs.mkdir(dirname(path));
			await write(path, data);
		},
	};
	const todo = (id: number, extra: object = {}) =>
		`${JSON.stringify(
			{
				id,
				subject: ["", "", "Two", "Three", "Four", "Five"][id],
				text: "",
				position: id - 2,
				from: null,
				createdAt: "2026-09-01T00:00:00.000Z",
				takenBy: null,
				files: [],
				blockedBy: [],
				lane: null,
				...extra,
			},
			null,
			"\t",
		)}\n`;
	const todo3 = todo(3, {
		lane: 1,
		files: [`${dir}/todos/3/a-shot.png`],
	});
	await fs.write(`${dir}/todos/3.json`, todo3);
	await fs.write(`${dir}/todos/3/a-shot.png`, "png");
	await fs.write(`${dir}/todos/4.json`, todo(4, { takenBy: "alpha" }));
	await fs.write(
		`${dir}/todos/5.json`,
		todo(5, { takenBy: "alpha", blockedBy: [4] }),
	);
	await fs.write(`${dir}/todos/last`, "7");
	await fs.write(
		`${dir}/todos/lanes`,
		`${JSON.stringify([{ id: 1, name: "Uploads" }])}\n`,
	);
	await fs.write(`${dir}/todos/last-lane`, "1");
	await fs.write(
		`${dir}/todos/removed/2.json`,
		JSON.stringify({
			state: { id: 2, files: [`${dir}/todos/2/b-gone.png`] },
			removedAt: "2026-09-02T00:00:00.000Z",
		}),
	);
	await fs.write(`${dir}/todos/2/b-gone.png`, "gone");
	const task = (name: string, extra: object = {}) =>
		JSON.stringify({
			task: name,
			branch: `task/${name}`,
			worktree: `${deps.config.worktreeRoot}/${name}`,
			status: "working",
			lease: null,
			mergeAttempts: 0,
			createdAt: "2026-10-01T00:00:00.000Z",
			updatedAt: "2026-10-02T00:00:00.000Z",
			...extra,
		});
	await fs.write(
		`${dir}/tasks/alpha.json`,
		task("alpha", { status: "escalated", mergeAttempts: 2 }),
	);
	await fs.write(`${dir}/tasks/alpha/q.png`, "question");
	await fs.write(`${dir}/tasks/beta.json`, task("beta"));
	await fs.write(`${dir}/lane-todos.json`, "[]\n");
	await fs.write(`${dir}/groomed-todos/3`, "");
	return { todo3 };
}

/** Runs this step, then the one after it, so today's code can read what it wrote. */
async function toFormatThree(deps: Testing): Promise<void> {
	await ONE_TASK_STORE.run(deps.splatesDir, deps.fs);
	await TASK_FILES.run(deps.splatesDir, deps.fs);
}
