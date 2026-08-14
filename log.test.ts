import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { Exit } from "./exit";
import { Journal } from "./journal";
import { log } from "./log";
import { bails, repo } from "./testing";

describe("log", () => {
	let deps: Awaited<ReturnType<typeof repo>> & { journal: Journal };

	beforeEach(async () => {
		const fixture = await repo();
		await fixture.fs.mkdir(fixture.arborDir);
		deps = {
			...fixture,
			journal: new Journal(
				join(fixture.arborDir, "log.jsonl"),
				200,
				fixture.fs,
			),
		};
	});

	afterEach(() => deps.cleanup());

	it("records how each command ended, refusals included", async () => {
		await deps.journal.record("create", "alpha", async () => {});
		await bails(
			deps.journal.record("merge", "alpha", () =>
				Promise.reject(new Exit("tests_failed", "nope")),
			),
		);

		await log(deps);

		const out = deps.out();
		expect(out).toContain("create");
		expect(out).toContain("alpha");
		expect(out).toContain("ok");
		expect(out).toContain("tests_failed");

		// Newest last, and --count trims from the front.
		deps.log.clear();
		await log(deps, { count: 1, json: true });
		expect(JSON.parse(deps.out())).toMatchObject([
			{ action: "merge", task: "alpha", reason: "tests_failed" },
		]);
	});

	it("keeps the log capped and asking for none returns none", async () => {
		deps.journal = new Journal(join(deps.arborDir, "log.jsonl"), 2, deps.fs);
		for (const task of ["a", "b", "c"]) {
			await deps.journal.record("create", task, async () => {});
		}

		expect((await deps.journal.tail(10)).map((entry) => entry.task)).toEqual([
			"b",
			"c",
		]);
		expect(await deps.journal.tail(0)).toEqual([]);

		await log(deps, { json: true });
		expect(JSON.parse(deps.out())).toHaveLength(2);
	});

	it("says so plainly when nothing has happened", async () => {
		await log(deps);

		expect(deps.out()).toContain("nothing recorded yet");
	});
});
