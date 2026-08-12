import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { Exit } from "./exit";
import { Journal } from "./journal";
import { log } from "./log";
import { bails, repo } from "./testing";

describe("log", () => {
	let d: Awaited<ReturnType<typeof repo>> & { journal: Journal };

	beforeEach(async () => {
		const r = await repo();
		await r.fs.mkdir(r.arborDir);
		d = {
			...r,
			journal: new Journal(r.fs, join(r.arborDir, "log.jsonl"), 200),
		};
	});

	afterEach(() => d.cleanup());

	it("records how each command ended, refusals included", async () => {
		await d.journal.record("create", "alpha", async () => {});
		await bails(
			d.journal.record("merge", "alpha", () =>
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
			{ action: "merge", task: "alpha", reason: "tests_failed" },
		]);
	});

	it("keeps the log capped and asking for none returns none", async () => {
		d.journal = new Journal(d.fs, join(d.arborDir, "log.jsonl"), 2);
		for (const task of ["a", "b", "c"]) {
			await d.journal.record("create", task, async () => {});
		}

		expect((await d.journal.tail(10)).map((e) => e.task)).toEqual(["b", "c"]);
		expect(await d.journal.tail(0)).toEqual([]);

		await log(d, { json: true });
		expect(JSON.parse(d.out())).toHaveLength(2);
	});

	it("says so plainly when nothing has happened", async () => {
		await log(d);

		expect(d.out()).toContain("nothing recorded yet");
	});
});
