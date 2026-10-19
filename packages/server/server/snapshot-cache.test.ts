import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { dirname } from "node:path";
import { FakeFs } from "webappwiz/system/testing";
import { add } from "../tasks";
import { Testing } from "../testing";
import { eventually, post, serving, taskForm } from "./testing";

describe("a project's kept snapshot", () => {
	let deps: Testing;
	let changes: FakeFs;

	beforeEach(async () => {
		deps = await Testing.open();
		await add(deps, "alpha");
		// Keep real git reads, but deliver changes synchronously: native watch
		// startup and event coalescing are covered by watching.test.ts.
		changes = new FakeFs();
		await changes.mkdir(`${dirname(deps.splatesDir)}/refs`);
		await changes.mkdir(`${deps.splatesDir}/tasks`);
		await changes.mkdir((await deps.service.find("alpha")).path);
		deps.fs.watch = changes.watch.bind(changes);
	});

	afterEach(() => deps.disposeAsync());

	it("answers a reopen without reading the repo again", async () => {
		// Reading the repo lists its tasks first.
		let reads = 0;
		const list = deps.service.list.bind(deps.service);
		deps.service.list = () => {
			reads++;
			return list();
		};

		await serving(deps, async (snapshot) => {
			await snapshot();
			const before = reads;

			expect((await snapshot()).tasks.map((task) => task.task)).toEqual([
				"alpha",
			]);
			expect(reads).toBe(before);
		});
	});

	it("reads again once a record moves, with no page listening", async () => {
		await serving(deps, async (snapshot) => {
			await snapshot();

			await deps.tasks.add("later", null);
			await changes.write(`${deps.splatesDir}/tasks/changed`, "");

			expect((await snapshot()).todos.map((each) => each.subject)).toEqual([
				"later",
			]);
		});
	}, 15_000);

	it("sees an SPLATES.md written while no page listens", async () => {
		const tree = (await deps.service.find("alpha")).path;

		await serving(deps, async (snapshot) => {
			await snapshot();

			await deps.fs.write(
				`${tree}/SPLATES.md`,
				"# alpha\n\n## Goal\n\nmoved\n",
			);
			await changes.write(`${tree}/SPLATES.md`, "");

			expect((await snapshot()).tasks[0]?.plan).toContain("moved");
		});
	}, 15_000);

	it("sees a worktree's edit, which git says, once it settles", async () => {
		const tree = (await deps.service.find("alpha")).path;

		await serving(deps, async (snapshot) => {
			const before = (await snapshot()).tasks[0]?.added ?? 0;

			await deps.fs.write(`${tree}/new.txt`, "one\ntwo\n");
			await changes.write(`${tree}/new.txt`, "");

			expect(
				await eventually(
					async () => (await snapshot()).tasks[0]?.added === before + 2,
					5_000,
				),
			).toBe(true);
		});
	}, 15_000);

	it("answers a board write without asking git of its tasks again", async () => {
		await serving(deps, async (snapshot, port) => {
			await snapshot();
			let asked = 0;
			const list = deps.service.list.bind(deps.service);
			deps.service.list = async () =>
				(await list()).map((worktree) => {
					const size = worktree.size.bind(worktree);
					worktree.size = () => {
						asked++;
						return size();
					};
					return worktree;
				});

			const response = await post(port, "/api/todos", taskForm("later"));
			expect(response.ok).toBe(true);

			expect((await snapshot()).todos.map((each) => each.subject)).toEqual([
				"later",
			]);
			expect(asked).toBe(0);
		});
	}, 15_000);
});
