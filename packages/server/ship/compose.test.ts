import { describe, expect, it } from "bun:test";
import { ShipCommands } from "./commands";
import { ShipComposer } from "./compose";
import { ComposeError } from "./compose-error";
import { FakeShipPs } from "./testing";

describe("ShipComposer", () => {
	it("orders picks by their dependencies, each with its bump and steps", async () => {
		const composed = await composer().compose([
			{ name: "@x/vexml", bump: "minor" },
			{ name: "@x/mdom", bump: "major" },
		]);
		expect(composed.waves).toEqual([["@x/mdom"], ["@x/vexml"]]);
		expect(composed.targets.map((each) => [each.name, each.bump])).toEqual([
			["@x/mdom", "major"],
			["@x/vexml", "minor"],
		]);
		expect(composed.targets[0]?.steps.at(-1)?.does).toBe(
			"Publish at the next major",
		);
		expect(composed.offered).toEqual([]);
	});

	it("marks the targets and steps that run in parallel", async () => {
		const composed = await composer().compose([
			{ name: "@x/mdom" },
			{ name: "net" },
		]);
		expect(composed.waves).toEqual([["@x/mdom", "net"]]);
		expect(composed.targets[0]?.bump).toBe("patch");
		expect(composed.targets[0]?.waves).toEqual([
			["test", "lint"],
			["build"],
			["publish"],
		]);
	});

	it("offers the dependencies a pick brings, through each other", async () => {
		const composed = await composer().compose([{ name: "app" }]);
		expect(composed.waves).toEqual([["app"]]);
		expect(composed.offered).toEqual([
			{ name: "@x/vexml", for: ["app"] },
			{ name: "@x/mdom", for: ["@x/vexml"] },
			{ name: "net", for: ["app"] },
		]);
	});

	it("does not offer a dependency with nothing unshipped", async () => {
		const composed = await composer({
			"bin/app ship unshipped": { net: 0 },
			"bin/vex ship unshipped": { "@x/vexml": 0 },
		}).compose([{ name: "app" }]);
		expect(composed.offered).toEqual([]);
	});

	it("offers a dependency with no changes counted or some unshipped", async () => {
		const composed = await composer({
			"bin/app ship unshipped": { net: 2 },
		}).compose([{ name: "app" }]);
		expect(composed.offered.map((each) => each.name)).toContain("net");
	});

	it("offers a dependency whose count is still out once the plans are in", async () => {
		const never = new Promise(() => {});
		const composed = await composer({
			"bin/app ship unshipped": { after: never, stdout: '{"net":0}' },
		}).compose([{ name: "app" }]);
		expect(composed.offered.map((each) => each.name)).toContain("net");
	});

	it("offers a dependency no command serves with why", async () => {
		const composed = await composer({
			"bin/app ship plan": [{ ...app, dependencies: ["gone"] }, net],
			"bin/app ship plan --target app": { ...app, dependencies: ["gone"] },
		}).compose([{ name: "app" }]);
		expect(composed.offered).toEqual([
			{ name: "gone", for: ["app"], error: 'No ship command serves "gone"' },
		]);
	});

	it("shows a target its command cannot plan as that target's error", async () => {
		const composed = await composer({
			"bin/mdom ship plan --target @x/mdom --bump patch": {
				exitCode: 1,
				stderr: "no",
			},
		}).compose([{ name: "@x/mdom" }, { name: "net" }]);
		expect(composed.targets).toEqual([
			expect.objectContaining({
				name: "@x/mdom",
				steps: [],
				error: '"bin/mdom ship plan" exited 1: no',
			}),
			expect.objectContaining({ name: "net" }),
		]);
	});

	it("keeps a failed command out of the picks but in the errors", async () => {
		const composed = await composer({
			"bin/vex ship plan": { exitCode: 2, stderr: "broken" },
		}).compose([{ name: "@x/mdom" }]);
		expect(composed.errors).toEqual([
			{
				command: "bin/vex ship",
				error: '"bin/vex ship plan" exited 2: broken',
			},
		]);
		expect(
			composer({
				"bin/vex ship plan": { exitCode: 2, stderr: "broken" },
			}).compose([{ name: "@x/vexml" }]),
		).rejects.toThrow(ComposeError);
	});

	it("resolves a versioned target's bump to the version it ships", async () => {
		const composed = await composer().compose([
			{ name: "staging", bump: "minor" },
		]);
		expect(composed.targets[0]).toMatchObject({
			name: "staging",
			bump: "minor",
			version: "1.5.0",
		});
	});

	it("plans a versioned target at an exact version, with no bump", async () => {
		const composed = await composer().compose([
			{ name: "staging", version: "1.2.0" },
			{ name: "prod", version: "1.4.3" },
		]);
		expect(
			composed.targets.map(({ name, bump, version }) => ({
				name,
				bump,
				version,
			})),
		).toEqual([
			{ name: "staging", bump: undefined, version: "1.2.0" },
			{ name: "prod", bump: undefined, version: "1.4.3" },
		]);
	});

	it("shows a versioned target with neither a version nor a bump as its error", async () => {
		const composed = await composer().compose([{ name: "prod" }]);
		expect(composed.targets[0]?.error).toBe("Choose a version or a bump");
	});

	it("refuses a version for a target without versions, and a version with a bump", async () => {
		expect(
			composer().compose([{ name: "net", version: "1.0.0" }]),
		).rejects.toThrow('"net" takes no version');
		expect(
			composer().compose([
				{ name: "staging", version: "1.0.0", bump: "patch" },
			]),
		).rejects.toThrow('"staging" takes a version or a bump, not both');
	});

	it("refuses an unknown pick, a pick twice and a bump a target takes none of", async () => {
		expect(composer().compose([{ name: "nope" }])).rejects.toThrow(
			'No ship command serves "nope"',
		);
		expect(
			composer().compose([{ name: "net" }, { name: "net" }]),
		).rejects.toThrow('"net" is picked twice');
		expect(
			composer().compose([{ name: "net", bump: "minor" }]),
		).rejects.toThrow('"net" takes no bump');
	});

	it("checks picks alone, with the refusal compose gives", async () => {
		await composer().check([{ name: "@x/mdom", bump: "minor" }]);
		expect(composer().check([{ name: "net", bump: "minor" }])).rejects.toThrow(
			'"net" takes no bump',
		);
	});

	it("refuses picks whose dependencies form a cycle", async () => {
		const first = { name: "a", dependencies: ["b"], steps: [] };
		const second = { name: "b", dependencies: ["a"], steps: [] };
		const ps = new FakeShipPs({ "bin/ab ship plan": [first, second] });
		const cyclic = new ShipComposer(
			new ShipCommands(["bin/ab ship"], ps, "/r"),
		);
		expect(cyclic.compose([{ name: "a" }, { name: "b" }])).rejects.toThrow(
			'The targets depend on each other in a cycle: "a" -> "b" -> "a"',
		);
	});
});

const mdom = (bump = "patch") => ({
	name: "@x/mdom",
	bump,
	dependencies: [],
	steps: [
		{ id: "test", does: "Run the tests" },
		{ id: "lint", does: "Lint" },
		{ id: "build", does: "Build", dependencies: ["test", "lint"] },
		{
			id: "publish",
			does: `Publish at the next ${bump}`,
			dependencies: ["build"],
		},
	],
});
const vexml = (bump = "patch") => ({
	name: "@x/vexml",
	bump,
	dependencies: ["@x/mdom"],
	steps: [{ id: "publish", does: `Publish vexml at the next ${bump}` }],
});
const app = {
	name: "app",
	dependencies: ["@x/vexml", "net"],
	steps: [{ id: "deploy", does: "Deploy the app" }],
};
const net = { name: "net", dependencies: [], steps: [] };
// A deployment that bumps from a current version, and one that takes only an exact one.
const staging = {
	name: "staging",
	versioned: true,
	dependencies: [],
	steps: [{ id: "deploy", does: "Deploy" }],
};
const prod = {
	name: "prod",
	versioned: true,
	dependencies: [],
	steps: [{ id: "deploy", does: "Deploy" }],
};

function composer(extra: Record<string, unknown> = {}) {
	const ps = new FakeShipPs({
		"bin/mdom ship plan": mdom(),
		"bin/mdom ship plan --target @x/mdom --bump patch": mdom(),
		"bin/mdom ship plan --target @x/mdom --bump major": mdom("major"),
		"bin/vex ship plan": vexml(),
		"bin/vex ship plan --target @x/vexml --bump minor": vexml("minor"),
		"bin/vex ship plan --target @x/vexml --bump patch": vexml(),
		"bin/app ship plan": [app, net],
		"bin/app ship plan --target app": app,
		"bin/app ship plan --target net": net,
		"bin/stage ship plan": [staging, prod],
		"bin/stage ship plan --target staging --bump patch": {
			...staging,
			version: "1.4.3",
		},
		"bin/stage ship plan --target staging --bump minor": {
			...staging,
			version: "1.5.0",
		},
		"bin/stage ship plan --target staging --version 1.2.0": {
			...staging,
			version: "1.2.0",
		},
		"bin/stage ship plan --target prod": prod,
		"bin/stage ship plan --target prod --version 1.4.3": {
			...prod,
			version: "1.4.3",
		},
		...extra,
	});
	return new ShipComposer(
		new ShipCommands(
			["bin/mdom ship", "bin/vex ship", "bin/app ship", "bin/stage ship"],
			ps,
			"/r",
		),
	);
}
