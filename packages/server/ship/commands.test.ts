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

	it("counts every command's unshipped commits, apart from the plans", async () => {
		const ps = new FakeShipPs({
			"bin/lib ship unshipped": { "@x/lib": 4 },
			"bin/net ship unshipped": { staging: 0, prod: 2 },
		});
		const counts = await new ShipCommands(
			["bin/lib ship", "bin/net ship"],
			ps,
			"/repo",
		).unshipped();
		expect(counts).toEqual({ "@x/lib": 4, staging: 0, prod: 2 });
		expect(ps.lines).toEqual([
			"bin/lib ship unshipped",
			"bin/net ship unshipped",
		]);
	});

	it("reads every command's current versions, and none from one that fails or prints no versions", async () => {
		const ps = new FakeShipPs({
			"bin/lib ship current": { "@x/lib": "1.4.2" },
			"bin/bad ship current": { exitCode: 1, stderr: "boom" },
			"bin/odd ship current": { stdout: "hello" },
			"bin/num ship current": { prod: 3 },
		});
		const current = await new ShipCommands(
			["bin/lib ship", "bin/bad ship", "bin/odd ship", "bin/num ship"],
			ps,
			"/repo",
		).current();
		expect(current).toEqual({ "@x/lib": "1.4.2" });
	});

	it("reads every command's shippable versions, and none from one that fails or prints no versions", async () => {
		const ps = new FakeShipPs({
			"bin/lib ship versions": {
				prod: [
					{ version: "0.1.12", note: "staging now" },
					{ version: "0.1.10" },
				],
			},
			"bin/bad ship versions": { exitCode: 1, stderr: "boom" },
			"bin/odd ship versions": { stdout: "hello" },
			"bin/num ship versions": { prod: [3] },
		});
		const shippable = await new ShipCommands(
			["bin/lib ship", "bin/bad ship", "bin/odd ship", "bin/num ship"],
			ps,
			"/repo",
		).shippable();
		expect(shippable).toEqual({
			prod: [{ version: "0.1.12", note: "staging now" }, { version: "0.1.10" }],
		});
	});

	it("gives no counts for a command that fails, lacks the subcommand or prints no counts", async () => {
		const ps = new FakeShipPs({
			"bin/lib ship unshipped": { "@x/lib": 1 },
			"bin/bad ship unshipped": { exitCode: 1, stderr: "boom" },
			"bin/odd ship unshipped": { stdout: "hello" },
			"bin/neg ship unshipped": { prod: -1 },
		});
		const counts = await new ShipCommands(
			[
				"bin/lib ship",
				"bin/bad ship",
				"bin/odd ship",
				"bin/neg ship",
				"bin/old ship",
			],
			ps,
			"/repo",
		).unshipped();
		expect(counts).toEqual({ "@x/lib": 1 });
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
			{ bump: "minor" },
		);
		expect(plan.name).toBe("my app");
	});

	it("passes resolved upstream versions as --upstream flags when planning", async () => {
		const ps = new FakeShipPs({
			"bin/net ship plan --target prod --upstream staging=1.4.3": {
				...prod,
				steps: [{ id: "prove", does: "Check staging verified v1.4.3" }],
			},
		});
		const plan = await new ShipCommands([], ps, "/repo").plan(
			"bin/net ship",
			"prod",
			{ upstream: { staging: "1.4.3" } },
		);
		expect(plan.steps[0]?.does).toBe("Check staging verified v1.4.3");
	});
});
