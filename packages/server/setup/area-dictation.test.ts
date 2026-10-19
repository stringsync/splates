import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { OPENAI_KEY } from "../dictate";
import { DICTATION_AREA } from "./area-dictation";
import { Setup, type SetupArea, type SetupMachine } from "./setup";

const HOME = "/home/.splates";

/** Each step's status, by id. */
async function statuses(machine: SetupMachine, area: SetupArea) {
	const progress = await new Setup(machine, [area]).read();
	return Object.fromEntries(
		(progress.areas[0]?.steps ?? []).map((step) => [step.id, step.status]),
	);
}

describe("DICTATION_AREA", () => {
	let machine: SetupMachine;

	beforeEach(async () => {
		machine = { fs: new FakeFs(), home: HOME, device: new FakeSecretStore() };
		await machine.fs.mkdir(HOME, { recursive: true });
	});

	it("asks for the OpenAI key, and is done once the device keeps it", async () => {
		const setup = new Setup(machine, [DICTATION_AREA]);
		await expect(setup.submit("dictation", {})).rejects.toThrow(
			"Paste the OpenAI API key first.",
		);
		await machine.device.set(OPENAI_KEY, "key");

		expect(await statuses(machine, DICTATION_AREA)).toEqual({
			dictation: "done",
		});
		await setup.submit("dictation", {});
	});

	it("undoes by forgetting the key, leaving its revoking to the person", async () => {
		await machine.device.set(OPENAI_KEY, "key");
		const setup = new Setup(machine, [DICTATION_AREA]);

		expect(await setup.undoPlan("dictation")).toMatchObject({
			steps: [
				{
					id: "dictation",
					removes: ["The OpenAI API key kept on this device"],
					leaves: [
						"The key still works: revoke it at [API keys](https://platform.openai.com/api-keys) if you no longer want it.",
					],
				},
			],
			creds: [{ name: OPENAI_KEY, keptFor: null }],
		});
		await setup.undo("dictation", null);

		expect(await machine.device.get(OPENAI_KEY)).toBeUndefined();
		expect(await statuses(machine, DICTATION_AREA)).toEqual({
			dictation: "ready",
		});
		await setup.undo("dictation", null);
	});
});
