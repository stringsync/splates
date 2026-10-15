import { beforeEach, describe, expect, it } from "bun:test";
import type { SpawnOptions } from "webappwiz/system";
import { FakePs } from "webappwiz/system/testing";
import { RESTART, supervise, UNBUILT, UPDATE } from "./supervise";

describe("supervise", () => {
	let ps: FakePs;
	beforeEach(() => {
		ps = new FakePs();
	});

	const exiting = (...codes: number[]) => {
		ps.simulate(async () => codes.shift() ?? 0);
	};

	it("serves in a child, starting it again as it was on a restart, and ends as it ends", async () => {
		ps.args = ["dev", "--allow-hosts", "box"];
		exiting(RESTART, 130);

		expect(await supervise(ps)).toBe(130);
		expect(ps.getCalls()).toEqual([
			"bun /fake/entry.ts dev --allow-hosts box",
			"bun /fake/entry.ts dev --allow-hosts box",
		]);
	});

	it("starts the newest arbor when the child asks to update, keeping its arguments", async () => {
		ps.args = ["dev", "--port", "4400"];
		exiting(UPDATE, RESTART, 0);

		expect(await supervise(ps)).toBe(0);
		expect(ps.getCalls()).toEqual([
			"bun /fake/entry.ts dev --port 4400",
			"bunx @webappwiz/arbor@latest dev --port 4400",
			"bunx @webappwiz/arbor@latest dev --port 4400",
		]);
	});

	const build = { argv: ["bun", "install"], cwd: "/fake/arbor" };

	it("builds the page before each start of the same arbor, and no more once it updates", async () => {
		ps.args = ["dev"];
		exiting(0, RESTART, 0, UPDATE, 0);

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
		ps.args = ["dev"];
		exiting(1, RESTART, 0, 0);
		const told: [string, string | undefined][] = [];
		const spawn = ps.spawn.bind(ps);
		ps.spawn = (argv: string[], opts?: SpawnOptions) => {
			told.push([argv.join(" "), opts?.env?.[UNBUILT]]);
			return spawn(argv, opts);
		};

		expect(await supervise(ps, { build })).toBe(0);
		expect(told).toEqual([
			["bun install", undefined],
			["bun /fake/entry.ts dev", "1"],
			["bun install", undefined],
			["bun /fake/entry.ts dev", undefined],
		]);
	});

	it("serves where it is told, with what it is told added, as a slot's server", async () => {
		ps.args = ["dev", "--slot"];
		exiting(RESTART, 0);
		const told: (string | undefined)[] = [];
		const spawn = ps.spawn.bind(ps);
		ps.spawn = (argv: string[], opts?: SpawnOptions) => {
			told.push(opts?.env?.ARBOR_HOME);
			return spawn(argv, opts);
		};

		await supervise(ps, {
			env: { ARBOR_HOME: "/home/.arbor/slots/fox" },
			cwd: "/home/.arbor/slots/fox/project",
		});
		expect(told).toEqual(["/home/.arbor/slots/fox", "/home/.arbor/slots/fox"]);
		expect(ps.getCallDirs()).toEqual([
			"/home/.arbor/slots/fox/project",
			"/home/.arbor/slots/fox/project",
		]);
	});
});
