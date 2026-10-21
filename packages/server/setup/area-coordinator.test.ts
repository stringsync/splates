import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { FakeAws } from "../cloud/testing";
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
	let aws: FakeAws;
	let ps: KeygenPs;
	let machine: SetupMachine;

	beforeEach(async () => {
		fs = new FakeFs();
		aws = new FakeAws();
		aws.stock = ["t3.medium"];
		ps = new KeygenPs(fs);
		ps.setEnv({
			AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
			AWS_SECRET_ACCESS_KEY: "secret",
		});
		machine = {
			fs,
			ps,
			home: HOME,
			device: new FakeSecretStore(),
			fetch: aws.fetch,
		};
	});

	it("asks for no token: AWS is read from the CLI's sign-in or the instance role", async () => {
		expect(step?.after).toEqual([]);
		expect(step?.fields).toBeUndefined();
	});

	it("makes no box with an AWS sign-in AWS refuses", async () => {
		ps.setEnv({
			AWS_ACCESS_KEY_ID: "AKIAWRONG",
			AWS_SECRET_ACCESS_KEY: "secret",
		});

		await expect(step?.submit?.(machine, {})).rejects.toThrow(
			"AWS takes no sign-in found here",
		);
		expect(await step?.check(machine)).toBe(false);
		expect(aws.requests).toEqual([]);
	});

	it("is done once its submit made the box", async () => {
		expect(await step?.check(machine)).toBe(false);

		await step?.submit?.(machine, {});

		expect(await step?.check(machine)).toBe(true);
	});

	it("is done once moved, on the box where none was made", async () => {
		await fs.write(UNIT, "");

		expect(await step?.check(machine)).toBe(true);
		expect(aws.requests).toEqual([]);
	});
});
