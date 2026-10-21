import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import type { SpawnOptions } from "webappwiz/system";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { writeInfraConfig } from "../coordinator";
import { COORDINATOR_AREA } from "./area-coordinator";
import type { SetupMachine } from "./setup";

const HOME = "/home/.splates";
const UNIT = "/etc/systemd/system/splates-coordinator.service";

/** `pulumi stack output --json`, answering what the stack has made. */
class PulumiPs extends FakePs {
	outputs = "{}";

	override async spawnCapture(argv: string[], opts?: SpawnOptions) {
		await super.spawnCapture(argv, opts);
		return { exitCode: 0, stdout: this.outputs, stderr: "" };
	}
}

describe("COORDINATOR_AREA's up step", () => {
	const step = COORDINATOR_AREA.steps.find(
		(each) => each.id === "coordinator-up",
	);
	let fs: FakeFs;
	let ps: PulumiPs;
	let machine: SetupMachine;

	beforeEach(() => {
		fs = new FakeFs();
		ps = new PulumiPs();
		machine = { fs, ps, home: HOME, device: new FakeSecretStore() };
	});

	it("asks for no token", () => {
		expect(step?.fields).toBeUndefined();
	});

	it("walks Pulumi, access, the infra project, remotes, up, creds, move", () => {
		expect(COORDINATOR_AREA.steps.map((each) => each.id)).toEqual([
			"coordinator-pulumi",
			"coordinator-access",
			"coordinator-infra",
			"coordinator-remotes",
			"coordinator-up",
			"coordinator-creds",
			"coordinator-move",
		]);
	});

	it("has the pulumi step done once `pulumi whoami` answers", async () => {
		const pulumi = COORDINATOR_AREA.steps.find(
			(each) => each.id === "coordinator-pulumi",
		);
		expect(await pulumi?.check(machine)).toBe(true);
	});

	it("has the infra step done once the project's files are there", async () => {
		const infra = COORDINATOR_AREA.steps.find(
			(each) => each.id === "coordinator-infra",
		);
		expect(await infra?.check(machine)).toBe(false);
		await writeInfraConfig(fs, HOME, { dir: "/code/infra" });
		expect(await infra?.check(machine)).toBe(false);
		await fs.write("/code/infra/Pulumi.yaml", "name: x\n");
		expect(await infra?.check(machine)).toBe(true);
	});

	it("is not done without an infra project", async () => {
		expect(await step?.check(machine)).toBe(false);
	});

	it("is done once the stack has made the box", async () => {
		await writeInfraConfig(fs, HOME, { dir: "/code/infra" });
		expect(await step?.check(machine)).toBe(false);

		ps.outputs = JSON.stringify({
			instanceId: "i-0abc",
			ipv4: "203.0.113.7",
			roleName: "role",
			tunnelHost: "splates.example.com",
		});

		expect(await step?.check(machine)).toBe(true);
	});

	it("is done once moved, on the box where none was made", async () => {
		await fs.write(UNIT, "");

		expect(await step?.check(machine)).toBe(true);
	});
});
