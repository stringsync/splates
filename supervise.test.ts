import { describe, expect, it } from "bun:test";
import { FakePs } from "webappwiz/system/testing";
import { RESTART, supervise, UPDATE } from "./supervise";

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

	it("builds the page before each start of the same arbor, and no more once it updates", async () => {
		const ps = new FakePs();
		ps.args = ["dev"];
		exiting(ps, 0, RESTART, 0, UPDATE, 0);

		expect(await supervise(ps, { build: ["bun", "/fake/build.ts"] })).toBe(0);
		expect(ps.getCalls()).toEqual([
			"bun /fake/build.ts",
			"bun /fake/entry.ts dev",
			"bun /fake/build.ts",
			"bun /fake/entry.ts dev",
			"bunx @webappwiz/arbor@latest dev",
		]);
	});
});
