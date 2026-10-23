import { beforeEach, describe, expect, it } from "bun:test";
import { FakePs } from "webappwiz/system/testing";
import { preflight } from "./ship-preflight";

describe("the ship preflight", () => {
	let ps: FakePs;

	beforeEach(() => {
		ps = new FakePs();
	});

	it("passes with a gh login", async () => {
		await preflight(ps);
		expect(ps.getCalls()).toEqual(["gh auth status"]);
	});

	it("stops without a terminal when gh is not logged in", async () => {
		ps.simulate(async () => 1);
		await expect(preflight(ps)).rejects.toThrow("gh auth login");
		expect(ps.getCalls()).toEqual(["gh auth status"]);
	});

	it("offers gh's login on a terminal, and stops when it leaves gh logged out", async () => {
		ps.setColumns(80);
		ps.simulate(async () => 1);
		await expect(preflight(ps)).rejects.toThrow("did not log in");
		expect(ps.getCalls()).toEqual(["gh auth status", "gh auth login"]);
	});
});
