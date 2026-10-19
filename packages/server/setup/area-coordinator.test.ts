import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { ChosenCloud, HCLOUD_TOKEN } from "../cloud";
import { FakeHetzner } from "../cloud/testing";
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
	let hetzner: FakeHetzner;
	let machine: SetupMachine;

	beforeEach(async () => {
		fs = new FakeFs();
		hetzner = new FakeHetzner();
		hetzner.stock = { ash: ["cpx21"] };
		const device = new FakeSecretStore();
		machine = {
			fs,
			ps: new KeygenPs(fs),
			home: HOME,
			device,
			fetch: hetzner.fetch,
		};
		await device.set(HCLOUD_TOKEN, "token");
		await new ChosenCloud(HOME, fs).choose("hetzner");
	});

	it("asks for the chosen cloud's token on its own page, after this journey's own choice of cloud", async () => {
		expect(step?.after.map((each) => each.id)).toEqual(["coordinator-cloud"]);
		const fields =
			typeof step?.fields === "function" ? await step.fields(machine) : [];
		expect(fields.map((field) => [field.kind, field.name])).toEqual([
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
