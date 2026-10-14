import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeFs, FakePs } from "webappwiz/system/testing";
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
	const INSTALL = `bunx skills@1 add jaredjj3/webappwiz#v${RUNNING} --yes --skill arbor`;

	it("runs update on the newer arbor npm has, and installs nothing itself", async () => {
		ps.simulate(async () => 3);

		expect(await run("999.0.0")).toBe(3);
		expect(ps.getCalls()).toEqual(["bunx @webappwiz/arbor@999.0.0 update"]);
	});

	it("installs its own skill when it is the newest", async () => {
		expect(await run(RUNNING)).toBe(0);
		expect(ps.getCalls()).toEqual([INSTALL]);
	});

	it("installs its own skill when npm cannot be reached", async () => {
		expect(await run(null)).toBe(0);
		expect(ps.getCalls()).toEqual([INSTALL]);
	});

	it("installs its own skill when it is the newer arbor an update ran", async () => {
		ps.setEnv({ [UPDATING]: "1" });

		expect(await run("999.0.0")).toBe(0);
		expect(ps.getCalls()).toEqual([INSTALL]);
	});
});
