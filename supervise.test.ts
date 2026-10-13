import { describe, expect, it } from "bun:test";
import type { SpawnOptions } from "webappwiz/system";
import { FakePs } from "webappwiz/system/testing";
import { RESTART, supervise, UNBUILT, UPDATE } from "./supervise";

describe("supervise", () => {
	const exiting = (ps: FakePs, ...codes: number[]) => {
		ps.simulate(async () => codes.shift() ?? 0);
	};

	it("serves in a child, starting it again as it was on a restart, and ends as it ends", async () => {
		const ps = new FakePs();
		ps.args = ["dev", "--allow-hosts", "box"];
		exiting(ps, RESTART, 130);

		expect(await supervise(ps)).toBe(130);
		expect(ps.getCalls()).toEqual([
			"bun /fake/entry.ts dev --allow-hosts box",
			"bun /fake/entry.ts dev --allow-hosts box",
		]);
	});

	it("starts the newest arbor when the child asks to update, keeping its arguments", async () => {
		const ps = new FakePs();
		ps.args = ["dev", "--port", "4400"];
		exiting(ps, UPDATE, RESTART, 0);

		expect(await supervise(ps)).toBe(0);
		expect(ps.getCalls()).toEqual([
			"bun /fake/entry.ts dev --port 4400",
			"bunx @webappwiz/arbor@latest dev --port 4400",
			"bunx @webappwiz/arbor@latest dev --port 4400",
		]);
	});

	const build = { argv: ["bun", "install"], cwd: "/fake/arbor" };

	it("builds the page before each start of the same arbor, and no more once it updates", async () => {
		const ps = new FakePs();
		ps.args = ["dev"];
		exiting(ps, 0, RESTART, 0, UPDATE, 0);

		expect(await supervise(ps, { build })).toBe(0);
		expect(ps.getCalls()).toEqual([
			"bun install",
			"bun /fake/entry.ts dev",
			"bun install",
			"bun /fake/entry.ts dev",
			"bunx @webappwiz/arbor@latest dev",
		]);
		expect(ps.getCallDirs()[0]).toBe("/fake/arbor");
	});

	it("still serves when the build fails, telling the server so, and stops telling it once a build passes", async () => {
		const ps = new FakePs();
		ps.args = ["dev"];
		exiting(ps, 1, RESTART, 0, 0);
		const told: (string | undefined)[] = [];
		const spawn = ps.spawn.bind(ps);
		ps.spawn = (argv: string[], opts?: SpawnOptions) => {
			if (argv[1] === "/fake/entry.ts") {
				told.push(opts?.env?.[UNBUILT]);
			}
			return spawn(argv, opts);
		};

		expect(await supervise(ps, { build })).toBe(0);
		expect(told).toEqual(["1", undefined]);
	});
});
