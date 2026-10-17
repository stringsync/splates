import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { OPENAI_KEY } from "./dev-transcriber";
import { Setup, type SetupArea, type SetupMachine } from "./setup";
import { DICTATION_AREA } from "./setup-area-dictation";

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
});
