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
		ps.args = ["server", "--allow-hosts", "box"];
		exiting(RESTART, 130);

		expect(await supervise(ps)).toBe(130);
		expect(ps.getCalls()).toEqual([
			"bun /fake/entry.ts server --allow-hosts box",
			"bun /fake/entry.ts server --allow-hosts box",
		]);
	});

	it("starts the newest splates when the child asks to update, keeping its arguments", async () => {
		ps.args = ["server", "--port", "4400"];
		exiting(UPDATE, RESTART, 0);

		expect(await supervise(ps)).toBe(0);
		expect(ps.getCalls()).toEqual([
			"bun /fake/entry.ts server --port 4400",
			"bunx splates@latest server --port 4400",
			"bunx splates@latest server --port 4400",
		]);
	});

	const build = { argv: ["bun", "install"], cwd: "/fake/splates" };

	it("builds the page before each start of the same splates, and no more once it updates", async () => {
		ps.args = ["server"];
		exiting(0, RESTART, 0, UPDATE, 0);

		expect(await supervise(ps, { build })).toBe(0);
		expect(ps.getCalls()).toEqual([
			"bun install",
			"bun /fake/entry.ts server",
			"bun install",
			"bun /fake/entry.ts server",
			"bunx splates@latest server",
		]);
		expect(ps.getCallDirs()[0]).toBe("/fake/splates");
	});

	it("still serves when the build fails, telling the server so, and stops telling it once a build passes", async () => {
		ps.args = ["server"];
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
			["bun /fake/entry.ts server", "1"],
			["bun install", undefined],
			["bun /fake/entry.ts server", undefined],
		]);
	});

	it("serves where it is told, with what it is told added, as a slot's server", async () => {
		ps.args = ["server", "--slot"];
		exiting(RESTART, 0);
		const told: (string | undefined)[] = [];
		const spawn = ps.spawn.bind(ps);
		ps.spawn = (argv: string[], opts?: SpawnOptions) => {
			told.push(opts?.env?.SPLATES_HOME);
			return spawn(argv, opts);
		};

		await supervise(ps, {
			env: { SPLATES_HOME: "/home/.splates/slots/fox" },
			cwd: "/home/.splates/slots/fox/project",
		});
		expect(told).toEqual([
			"/home/.splates/slots/fox",
			"/home/.splates/slots/fox",
		]);
		expect(ps.getCallDirs()).toEqual([
			"/home/.splates/slots/fox/project",
			"/home/.splates/slots/fox/project",
		]);
	});
});
