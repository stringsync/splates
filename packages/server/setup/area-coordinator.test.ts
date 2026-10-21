import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { ChosenCloud, DIGITALOCEAN_TOKEN } from "../cloud";
import { FakeDigitalOcean } from "../cloud/testing";
import { KeygenPs } from "../coordinator/testing";
import { COORDINATOR_AREA } from "./area-coordinator";
import type { SetupMachine } from "./setup";

const HOME = "/home/.splates";
const UNIT = "/etc/systemd/system/splates-coordinator.service";

describe("COORDINATOR_AREA's box step", () => {
	const step = COORDINATOR_AREA.steps.find(
		(each) => each.id === "coordinator-box",
	);
	let fs: FakeFs;
	let digitalocean: FakeDigitalOcean;
	let machine: SetupMachine;

	beforeEach(async () => {
		fs = new FakeFs();
		digitalocean = new FakeDigitalOcean();
		digitalocean.actionsRun = true;
		digitalocean.stock = { nyc3: ["s-2vcpu-4gb-intel"] };
		const device = new FakeSecretStore();
		machine = {
			fs,
			ps: new KeygenPs(fs),
			home: HOME,
			device,
			fetch: digitalocean.fetch,
		};
		await device.set(DIGITALOCEAN_TOKEN, "token");
		await new ChosenCloud(HOME, fs).choose("digitalocean");
	});

	it("asks for the chosen cloud's token on its own page, after this journey's own choice of cloud", async () => {
		expect(step?.after.map((each) => each.id)).toEqual(["coordinator-cloud"]);
		const fields =
			typeof step?.fields === "function" ? await step.fields(machine) : [];
		expect(fields.map((field) => [field.kind, field.name])).toEqual([
			["cred", DIGITALOCEAN_TOKEN],
		]);
	});

	it("makes no box with a token DigitalOcean refuses", async () => {
		await machine.device.set(DIGITALOCEAN_TOKEN, "wrong");

		await expect(step?.submit?.(machine, {})).rejects.toThrow(
			"DigitalOcean does not take that token",
		);
		expect(await step?.check(machine)).toBe(false);
	});

	it("is not done without a DigitalOcean token, without asking DigitalOcean", async () => {
		await machine.device.delete(DIGITALOCEAN_TOKEN);

		expect(await step?.check(machine)).toBe(false);
		expect(digitalocean.requests).toEqual([]);
	});

	it("is done once its submit made the box", async () => {
		expect(await step?.check(machine)).toBe(false);

		await step?.submit?.(machine, {});

		expect(await step?.check(machine)).toBe(true);
	});

	it("is done once moved, on the box where none was made", async () => {
		await fs.write(UNIT, "");

		expect(await step?.check(machine)).toBe(true);
		expect(digitalocean.requests).toEqual([]);
	});
});
