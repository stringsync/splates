import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { add } from "./add";
import { eventually, serving } from "./dev-testing";
import { Testing } from "./testing";

describe("a project's kept snapshot", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
		await add(deps, "alpha");
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
			// A watch can still hear of the add made before it began: let that
			// settle into one read first.
			await Bun.sleep(300);
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

			await deps.todos.add("later", null);

			expect(
				await eventually(
					async () => (await snapshot()).todos.length === 1,
					5_000,
				),
			).toBe(true);
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

			expect(
				await eventually(
					async () =>
						((await snapshot()).tasks[0]?.plan ?? "").includes("moved"),
					5_000,
				),
			).toBe(true);
		});
	}, 15_000);
});
