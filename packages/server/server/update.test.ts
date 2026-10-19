import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { encodeTask } from "../board";
import { RUNNING } from "./release";
import { UPDATING, update } from "./update";

describe("update", () => {
	let fs: FakeFs;
	let ps: FakePs;
	let log: MemoryLogger;

	beforeEach(() => {
		fs = new FakeFs();
		ps = new FakePs();
		log = new MemoryLogger();
	});

	const run = (latest: string | null) =>
		update({ root: "/repo", fs, ps, log, newest: async () => latest });
	const INSTALL = `bunx skills@1 add stringsync/splates#v${RUNNING} --yes --skill splates`;

	it("runs update on the newer splates npm has, and installs nothing itself", async () => {
		ps.simulate(async () => 3);

		expect(await run("999.0.0")).toBe(3);
		expect(ps.getCalls()).toEqual(["bunx @stringsync/splates@999.0.0 update"]);
	});

	it("installs its own skill when it is the newest", async () => {
		expect(await run(RUNNING)).toBe(0);
		expect(ps.getCalls()).toEqual([INSTALL]);
	});

	it("installs its own skill when npm cannot be reached", async () => {
		expect(await run(null)).toBe(0);
		expect(ps.getCalls()).toEqual([INSTALL]);
	});

	it("installs its own skill when it is the newer splates an update ran", async () => {
		ps.setEnv({ [UPDATING]: "1" });

		expect(await run("999.0.0")).toBe(0);
		expect(ps.getCalls()).toEqual([INSTALL]);
	});

	it("installs the skill of the release it is named, asking npm nothing", async () => {
		expect(
			await update({ root: "/repo", fs, ps, log, release: "999.0.0" }),
		).toBe(0);
		expect(ps.getCalls()).toEqual([
			"bunx skills@1 add stringsync/splates#v999.0.0 --yes --skill splates",
		]);
	});

	it("moves queued tasks saved with tags into a lane a tag", async () => {
		await fs.mkdir("/repo/.git/splates/tasks", { recursive: true });
		await fs.write(
			"/repo/.git/splates/tasks/1.md",
			encodeTask({
				id: 1,
				subject: "retry uploads",
				text: "",
				position: 1,
				from: null,
				createdAt: "2026-01-01T00:00:00.000Z",
				takenBy: null,
				files: [],
				tags: ["uploads"],
			}),
		);

		await run(RUNNING);

		expect(log.entries.map((entry) => String(entry.message))).toContain(
			"moved #1 into lane 1 Uploads, from their tag",
		);
	});
});
