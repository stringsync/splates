import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import type { SpawnOptions } from "webappwiz/system";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { HCLOUD_TOKEN } from "../workers";
import { FakeHetzner } from "../workers/testing";
import { COORDINATOR_AREA } from "./area-coordinator";
import type { SetupMachine } from "./setup";

const HOME = "/home/.splates";
const UNIT = "/etc/systemd/system/splates-coordinator.service";

describe("COORDINATOR_AREA's box step", () => {
	const step = COORDINATOR_AREA.steps[0];
	let fs: FakeFs;
	let hetzner: FakeHetzner;
	let machine: SetupMachine;

	beforeEach(async () => {
		fs = new FakeFs();
		hetzner = new FakeHetzner();
		const device = new FakeSecretStore();
		machine = {
			fs,
			ps: new KeygenPs(fs),
			home: HOME,
			device,
			fetch: hetzner.fetch,
		};
		await device.set(HCLOUD_TOKEN, "token");
	});

	it("asks for the Hetzner token on its own page, waiting on no other journey", () => {
		expect(step?.after).toEqual([]);
		expect(step?.fields?.map((field) => [field.kind, field.name])).toEqual([
			["cred", HCLOUD_TOKEN],
		]);
	});

	it("makes no box with a token Hetzner refuses", async () => {
		await machine.device.set(HCLOUD_TOKEN, "wrong");

		await expect(step?.submit?.(machine, {})).rejects.toThrow(
			"Hetzner does not take that token",
		);
		expect(await step?.check(machine)).toBe(false);
	});

	it("is not done without a Hetzner token, without asking Hetzner", async () => {
		await machine.device.delete(HCLOUD_TOKEN);

		expect(await step?.check(machine)).toBe(false);
		expect(hetzner.requests).toEqual([]);
	});

	it("is done once its submit made the box", async () => {
		expect(await step?.check(machine)).toBe(false);

		await step?.submit?.(machine, {});

		expect(await step?.check(machine)).toBe(true);
	});

	it("is done once moved, on the box where none was made", async () => {
		await fs.write(UNIT, "");

		expect(await step?.check(machine)).toBe(true);
		expect(hetzner.requests).toEqual([]);
	});
});

/** An ssh-keygen that writes its public key into a `FakeFs`. */
class KeygenPs extends FakePs {
	constructor(private readonly fs: FakeFs) {
		super();
	}

	override async spawnCapture(argv: string[], opts?: SpawnOptions) {
		await super.spawnCapture(argv, opts);
		await this.fs.write(`${argv.at(-1)}.pub`, "ssh-ed25519 AAAA\n");
		return { exitCode: 0, stdout: "", stderr: "" };
	}
}
