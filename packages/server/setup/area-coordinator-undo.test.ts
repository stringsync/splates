import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import type { SpawnOptions } from "webappwiz/system";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { infraConfigPath, type Moved, writeInfraConfig } from "../coordinator";
import { FakeBoxCloud } from "../coordinator/testing";
import { coordinatorArea } from "./area-coordinator";
import { REMOTE_ACCESS_AREA } from "./area-remote";
import { Setup, type SetupMachine, type SetupStep } from "./setup";

const HOME = "/home/.splates";
const UNIT = "/etc/systemd/system/splates-coordinator.service";
describe("undoing COORDINATOR_AREA", () => {
	let fs: FakeFs;
	let ps: PulumiPs;
	let cloud: FakeBoxCloud;
	let machine: SetupMachine;
	let area: ReturnType<typeof coordinatorArea>;

	beforeEach(async () => {
		fs = new FakeFs();
		ps = new PulumiPs();
		cloud = new FakeBoxCloud();
		machine = {
			fs,
			ps,
			home: HOME,
			device: new FakeSecretStore(),
		};
		const dryRun: Moved = {
			status: "ready",
			host: "splates.example.com",
			projects: [],
		};
		area = coordinatorArea({
			projects: async () => [
				{
					slug: "app",
					root: "/code/app",
					remote: "origin",
					url: "git@github.com:me/app.git",
				},
			],
			move: () => ({ run: async () => dryRun }),
			cloud: () => cloud,
		});
	});

	function setup() {
		return new Setup(machine, [REMOTE_ACCESS_AREA, area]);
	}

	function step(id: string): SetupStep {
		return area.steps.find((each) => each.id === id) as SetupStep;
	}

	it("plans forgetting the dry run, and leaves the stack and its creds alone", async () => {
		await step("coordinator-creds").submit?.(machine, {});

		const plan = await setup().undoPlan("coordinator");

		expect(plan.steps.map((each) => each.id)).toEqual([
			"coordinator-creds",
			"coordinator-remotes",
			"coordinator-pulumi",
		]);
		expect(plan.steps[0]?.leaves).toEqual([
			"The deploy keys and creds the Pulumi stack put in the box's Parameter Store.",
		]);
		expect(plan.refused).toBeNull();
	});

	it("forgets the last dry run once undone", async () => {
		await step("coordinator-creds").submit?.(machine, {});

		await setup().undo("coordinator", "splates");

		expect(await step("coordinator-creds").check(machine)).toBe(false);
	});

	it("plans destroying the box once the stack has made it, the stack's name typed to confirm", async () => {
		await writeInfraConfig(fs, HOME, { dir: "/code/infra", stack: "prod" });
		await fs.write("/code/infra/Pulumi.yaml", "");
		ps.outputs = OUTPUTS;

		const plan = await setup().undoPlan("coordinator");

		expect(plan.steps.map((each) => each.id)).toEqual([
			"coordinator-up",
			"coordinator-remotes",
			"coordinator-infra",
			"coordinator-pulumi",
		]);
		expect(plan.confirm).toBe("prod");
		expect(plan.steps[0]?.removes[0]).toContain(
			"The box at 203.0.113.7 (i-0abc) and everything the stack made",
		);
		expect(plan.steps[0]?.leaves).toEqual([]);
		expect(plan.steps[2]?.removes).toEqual([
			"The stack prod from Pulumi, and the record of the project here.",
		]);
		expect(plan.steps[2]?.leaves).toEqual([
			"The project's files in /code/infra: delete them yourself.",
		]);
	});

	it("destroys the box, lifting its protection, then removes the stack and forgets the project", async () => {
		await writeInfraConfig(fs, HOME, { dir: "/code/infra", stack: "prod" });
		await fs.write("/code/infra/Pulumi.yaml", "");
		ps.outputs = OUTPUTS;

		await setup().undo("coordinator", "prod");

		expect(cloud.protections).toEqual([["i-0abc", false]]);
		expect(
			ps.commands
				.map((argv) => argv.slice(1, 3).join(" "))
				.filter((command) => !command.startsWith("stack output")),
		).toEqual(["refresh --yes", "destroy --yes", "stack rm"]);
		expect(await fs.exists(infraConfigPath(HOME))).toBe(false);
	});

	it("refuses to destroy the box without the stack's name typed", async () => {
		await writeInfraConfig(fs, HOME, { dir: "/code/infra", stack: "prod" });
		await fs.write("/code/infra/Pulumi.yaml", "");
		ps.outputs = OUTPUTS;

		await expect(setup().undo("coordinator", "splates")).rejects.toThrow(
			"Type prod to undo Cloud server.",
		);
		expect(ps.commands.some((argv) => argv[1] === "destroy")).toBe(false);
	});

	it("refuses every step once the server has moved onto its box", async () => {
		await fs.write(UNIT, "");
		const refusal =
			"splates server runs on its box now, holding the only live records; move it back first (task #385).";

		expect((await setup().undoPlan("coordinator")).refused).toBe(refusal);
		await expect(setup().undo("coordinator", "splates")).rejects.toThrow(
			refusal,
		);
	});
});

const OUTPUTS = {
	instanceId: "i-0abc",
	ipv4: "203.0.113.7",
	roleName: "splates-role",
	tunnelHost: "splates.example.com",
};

/** The `pulumi` commands the box runs, answered with the stack's outputs; the rest answer as a fake does. */
const BOX_COMMANDS = new Set(["stack", "refresh", "destroy", "cancel"]);

/** `pulumi`, answering the stack's outputs and remembering each command the box ran. */
class PulumiPs extends FakePs {
	readonly commands: string[][] = [];
	outputs: unknown = {};

	override async spawnCapture(argv: string[], opts?: SpawnOptions) {
		const ran = await super.spawnCapture(argv, opts);
		if (argv[0] !== "pulumi" || !BOX_COMMANDS.has(argv[1] as string)) {
			return ran;
		}
		this.commands.push(argv);
		return { exitCode: 0, stdout: JSON.stringify(this.outputs), stderr: "" };
	}
}
