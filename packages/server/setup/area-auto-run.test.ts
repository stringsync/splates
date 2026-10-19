import { describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { AutoRunStore } from "../queue";
import { AUTO_RUN_AREA } from "./area-auto-run";
import { Setup, type SetupMachine } from "./setup";

describe("AUTO_RUN_AREA", () => {
	it("turns auto-run on with a yes, and is not done with a no", async () => {
		const machine: SetupMachine = {
			fs: new FakeFs(),
			home: "/home/.splates",
			device: new FakeSecretStore(),
		};
		const setup = new Setup(machine, [AUTO_RUN_AREA]);

		await expect(setup.submit("auto-run", { on: false })).rejects.toThrow(
			"Say yes",
		);
		await setup.submit("auto-run", { on: true });

		expect(
			await new AutoRunStore("/home/.splates/auto-run.json", {
				fs: machine.fs,
			}).on(),
		).toBe(true);
	});
});
