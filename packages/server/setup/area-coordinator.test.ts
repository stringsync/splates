import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import type { SpawnOptions } from "webappwiz/system";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { HCLOUD_TOKEN, PULUMI_PASSPHRASE, pulumiPaths } from "../workers";
import { COORDINATOR_AREA } from "./area-coordinator";
import type { SetupMachine } from "./setup";

const HOME = "/home/.splates";
const PATHS = pulumiPaths(HOME);

describe("COORDINATOR_AREA", () => {
	const step = COORDINATOR_AREA.steps[0];
	let fs: FakeFs;
	let ps: BoxPs;
	let machine: SetupMachine;

	beforeEach(async () => {
		fs = new FakeFs();
		ps = new BoxPs(fs);
		const device = new FakeSecretStore();
		machine = { fs, ps, home: HOME, device };
		await fs.write(PATHS.bin, "");
		await device.set(PULUMI_PASSPHRASE, "pass");
		await device.set(HCLOUD_TOKEN, "token");
	});

	it("comes after the Pulumi state and Hetzner token steps", () => {
		expect(step?.after.map((each) => each.id)).toEqual([
			"pulumi-state",
			"hetzner-token",
		]);
	});

	it("is not done before Pulumi is installed, without asking it", async () => {
		await fs.rm(PATHS.bin);

		expect(await step?.check(machine)).toBe(false);
		expect(ps.made).toBe(false);
	});

	it("is done once its submit made the box", async () => {
		expect(await step?.check(machine)).toBe(false);

		await step?.submit?.(machine, {});

		expect(await step?.check(machine)).toBe(true);
	});
});

/** A Pulumi whose one stack exists once `up` ran, and an ssh-keygen. */
class BoxPs extends FakePs {
	made = false;

	constructor(private readonly fs: FakeFs) {
		super();
	}

	override async spawnCapture(argv: string[], opts?: SpawnOptions) {
		await super.spawnCapture(argv, opts);
		const ok = (stdout = "") => ({ exitCode: 0, stdout, stderr: "" });
		const [bin, ...args] = argv;
		if (bin === "ssh-keygen") {
			await this.fs.write(`${args.at(-1)}.pub`, "ssh-ed25519 AAAA\n");
		} else if (bin === PATHS.bin && args[0] === "up") {
			this.made = true;
		} else if (args[0] === "stack" && args[1] === "ls") {
			return ok(JSON.stringify(this.made ? [{ name: "coordinator" }] : []));
		} else if (args[0] === "stack" && args[1] === "output") {
			return ok(JSON.stringify({ ipv4: "203.0.113.7", serverId: "42" }));
		}
		return ok();
	}
}
