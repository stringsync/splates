import { describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { TestTimings } from "./timings";

const TIMINGS = JSON.stringify({ version: 1, files: { "a.test.ts": 900 } });
const MEASURED = JSON.stringify({ version: 1, files: { "a.test.ts": 400 } });

describe("TestTimings", () => {
	it("orders a run by the kept timings without measuring them", async () => {
		const fs = new FakeFs();
		const timings = new TestTimings(fs, "/repo/.git");
		await fs.write(timings.path("server"), TIMINGS);
		const run = await timings.forRun("server");
		expect(run.args).toEqual([
			"--timings=/repo/.git/splates-test-timings-server.json",
		]);
	});

	it("leaves a run in path order when none are kept or they are unreadable", async () => {
		const fs = new FakeFs();
		const timings = new TestTimings(fs, "/repo/.git");
		expect((await timings.forRun("server")).args).toEqual([]);
		await fs.write(timings.path("server"), "garbage");
		expect((await timings.forRun("server")).args).toEqual([]);
	});

	it("keeps a passing gate's measured timings in place of the old", async () => {
		const fs = new FakeFs();
		const timings = new TestTimings(fs, "/repo/.git");
		await fs.write(timings.path("page"), TIMINGS);
		const run = await timings.forRun("page", "/scratch");
		expect(run.args).toEqual([
			"--timings=/scratch/timings-page.json",
			"--update-timings",
		]);
		expect(await fs.read("/scratch/timings-page.json")).toBe(TIMINGS);
		await fs.write("/scratch/timings-page.json", MEASURED);
		await run.kept(true);
		expect(await fs.read(timings.path("page"))).toBe(MEASURED);
	});

	it("keeps the old timings when the gate's run failed", async () => {
		const fs = new FakeFs();
		const timings = new TestTimings(fs, "/repo/.git");
		await fs.write(timings.path("page"), TIMINGS);
		const run = await timings.forRun("page", "/scratch");
		await fs.write("/scratch/timings-page.json", MEASURED);
		await run.kept(false);
		expect(await fs.read(timings.path("page"))).toBe(TIMINGS);
	});

	it("keeps nothing when a passing run wrote no timings", async () => {
		const fs = new FakeFs();
		const timings = new TestTimings(fs, "/repo/.git");
		const run = await timings.forRun("server", "/scratch");
		await run.kept(true);
		expect(await fs.exists(timings.path("server"))).toBe(false);
	});

	it("keeps the old entries of the files a passing run left out", async () => {
		const fs = new FakeFs();
		const timings = new TestTimings(fs, "/repo/.git");
		const old = JSON.stringify({
			version: 1,
			files: { "a.test.ts": 900, "b.test.ts": 700 },
		});
		await fs.write(timings.path("page"), old);
		const run = await timings.forRun("page", "/scratch", ["b.test.ts"]);
		await fs.write("/scratch/timings-page.json", MEASURED);
		await run.kept(true);
		expect(JSON.parse(await fs.read(timings.path("page")))).toEqual({
			version: 1,
			files: { "a.test.ts": 400, "b.test.ts": 700 },
		});
	});
});
