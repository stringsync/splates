import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { Exit } from "./exit";
import { Journal } from "./journal";
import { log } from "./log";
import { Testing } from "./testing";

describe("log", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("records how each command ended, refusals included", async () => {
		await deps.journal.record("create", "alpha", async () => {});
		await expect(
			deps.journal.record("merge", "alpha", () =>
				Promise.reject(new Exit("tests_failed", "nope")),
			),
		).toBail("tests_failed");

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
		// Room for two, so a third entry has to push the first off.
		const journal = new Journal(join(deps.arborDir, "log.jsonl"), 2, {
			fs: deps.fs,
		});
		await journal.record("create", "a", async () => {});
		await journal.record("create", "b", async () => {});
		await journal.record("create", "c", async () => {});

		expect((await journal.tail(10)).map((entry) => entry.task)).toEqual([
			"b",
			"c",
		]);
		expect(await journal.tail(0)).toEqual([]);

		await log({ journal, log: deps.log }, { json: true });
		expect(JSON.parse(deps.out())).toHaveLength(2);
	});

	it("says so plainly when nothing has happened", async () => {
		await log(deps);

		expect(deps.out()).toContain("nothing recorded yet");
	});
});
