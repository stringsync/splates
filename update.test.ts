import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { RUNNING } from "./release";
import { skill } from "./skill";
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
	const installed = () => fs.exists("/repo/.agents/skills/arbor/SKILL.md");

	it("runs update on the newer arbor npm has, and writes nothing itself", async () => {
		ps.simulate(async () => 3);

		expect(await run("999.0.0")).toBe(3);
		expect(ps.getCalls()).toEqual(["bunx @webappwiz/arbor@999.0.0 update"]);
		expect(await installed()).toBe(false);
	});

	it("writes its own skill when it is the newest", async () => {
		expect(await run(RUNNING)).toBe(0);
		expect(ps.getCalls()).toEqual([]);
		expect(await fs.read("/repo/.agents/skills/arbor/SKILL.md")).toEqual(skill);
	});

	it("writes its own skill when npm cannot be reached", async () => {
		expect(await run(null)).toBe(0);
		expect(await installed()).toBe(true);
	});

	it("writes its own skill when it is the newer arbor an update ran", async () => {
		ps.setEnv({ [UPDATING]: "1" });

		expect(await run("999.0.0")).toBe(0);
		expect(ps.getCalls()).toEqual([]);
		expect(await installed()).toBe(true);
	});
});
