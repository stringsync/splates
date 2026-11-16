import { describe, expect, it } from "bun:test";
import { ShipCommands } from "./commands";
import { FakeShipPs } from "./testing";

const lib = {
	name: "@x/lib",
	bump: "patch",
	dependencies: [],
	steps: [{ id: "publish", does: "Publish at the next patch" }],
};
const staging = { name: "staging", dependencies: [], steps: [] };
const prod = { name: "prod", dependencies: ["staging"], steps: [] };

describe("ShipCommands", () => {
	it("reads the commands again on each list when given a reader", async () => {
		const ps = new FakeShipPs({ "bin/lib ship plan": lib });
		let commands: string[] = [];
		const ships = new ShipCommands(async () => commands, ps, "/repo");
		expect((await ships.list()).targets).toEqual([]);
		commands = ["bin/lib ship"];
		expect((await ships.list()).targets.map((each) => each.plan.name)).toEqual([
			"@x/lib",
		]);
	});

	it("lists the targets of every command, one plan or several", async () => {
		const ps = new FakeShipPs({
			"bin/lib ship plan": lib,
			"bin/net ship plan": [staging, prod],
		});
		const listing = await new ShipCommands(
			["bin/lib ship", "bin/net ship"],
			ps,
			"/repo",
		).list();
		expect(listing.errors).toEqual([]);
		expect(
			listing.targets.map((each) => [each.command, each.plan.name]),
		).toEqual([
			["bin/lib ship", "@x/lib"],
			["bin/net ship", "staging"],
			["bin/net ship", "prod"],
		]);
	});

	it("carries a target's unshipped count, and none when it gives none", async () => {
		const ps = new FakeShipPs({
			"bin/lib ship plan": { ...lib, unshipped: 4 },
			"bin/net ship plan": staging,
		});
		const listing = await new ShipCommands(
			["bin/lib ship", "bin/net ship"],
			ps,
			"/repo",
		).list();
		expect(listing.targets.map((each) => each.plan.unshipped)).toEqual([
			4,
			undefined,
		]);
	});

	it("shows a command that fails or prints no plan as its error", async () => {
		const ps = new FakeShipPs({
			"bin/lib ship plan": lib,
			"bin/bad ship plan": { exitCode: 1, stderr: "boom\n" },
			"bin/odd ship plan": { stdout: "hello" },
			"bin/wrong ship plan": { nope: true },
		});
		const listing = await new ShipCommands(
			["bin/lib ship", "bin/bad ship", "bin/odd ship", "bin/wrong ship"],
			ps,
			"/repo",
		).list();
		expect(listing.targets.map((each) => each.plan.name)).toEqual(["@x/lib"]);
		expect(listing.errors).toEqual([
			{ command: "bin/bad ship", error: '"bin/bad ship plan" exited 1: boom' },
			{
				command: "bin/odd ship",
				error: '"bin/odd ship plan" did not print JSON',
			},
			{
				command: "bin/wrong ship",
				error: expect.stringContaining('"bin/wrong ship plan" printed no plan'),
			},
		]);
	});

	it("refuses a second command serving a name already served", async () => {
		const ps = new FakeShipPs({
			"bin/a ship plan": lib,
			"bin/b ship plan": lib,
		});
		const listing = await new ShipCommands(
			["bin/a ship", "bin/b ship"],
			ps,
			"/repo",
		).list();
		expect(listing.targets).toHaveLength(1);
		expect(listing.errors).toEqual([
			{
				command: "bin/b ship",
				error: '"@x/lib" is served by "bin/a ship" too',
			},
		]);
	});

	it("plans one target at a bump, quoting what the shell would split", async () => {
		const ps = new FakeShipPs({
			"bin/net ship plan --target 'my app' --bump minor": {
				...staging,
				name: "my app",
			},
		});
		const plan = await new ShipCommands([], ps, "/repo").plan(
			"bin/net ship",
			"my app",
			"minor",
		);
		expect(plan.name).toBe("my app");
	});
});
