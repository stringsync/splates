import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Exit } from "../lib/exit";
import { Journal } from "../lib/journal";
import { bails, repo } from "../lib/testing";
import { log } from "./log";

async function setup(capacity = 200) {
	const r = await repo();
	await r.fs.mkdir(r.arborDir);
	return {
		...r,
		journal: new Journal(r.fs, join(r.arborDir, "log.jsonl"), capacity),
	};
}

describe("log", () => {
	test("records how each command ended, refusals included", async () => {
		const d = await setup();
		await d.journal.record("create", "alpha", async () => {});
		await bails(
			d.journal.record("graft", "alpha", () =>
				Promise.reject(new Exit("tests_failed", "nope")),
			),
		);

		await log(d);

		const out = d.out();
		expect(out).toContain("create");
		expect(out).toContain("alpha");
		expect(out).toContain("ok");
		expect(out).toContain("tests_failed");

		// Newest last, and --count trims from the front.
		d.log.clear();
		await log(d, { count: 1, json: true });
		expect(JSON.parse(d.out())).toMatchObject([
			{ action: "graft", task: "alpha", reason: "tests_failed" },
		]);
		await d.cleanup();
	});

	test("keeps the log capped and asking for none returns none", async () => {
		const d = await setup(2);
		for (const task of ["a", "b", "c"]) {
			await d.journal.record("create", task, async () => {});
		}

		expect((await d.journal.tail(10)).map((e) => e.task)).toEqual(["b", "c"]);
		expect(await d.journal.tail(0)).toEqual([]);

		await log(d, { json: true });
		expect(JSON.parse(d.out())).toHaveLength(2);
		await d.cleanup();
	});

	test("says so plainly when nothing has happened", async () => {
		const d = await setup();

		await log(d);

		expect(d.out()).toContain("nothing recorded yet");
		await d.cleanup();
	});
});
