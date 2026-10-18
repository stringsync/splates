import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { WORKER_KEYS_FILE, WorkerKeys } from "../workers";
import { WORKER_KEY_STEPS } from "./area-worker-keys";
import { Setup, type SetupMachine } from "./setup";

const HOME = "/home/.splates";

const AREA = { id: "keys", title: "Keys", steps: WORKER_KEY_STEPS };

describe("WORKER_KEY_STEPS", () => {
	let machine: SetupMachine;

	beforeEach(async () => {
		machine = { fs: new FakeFs(), home: HOME, device: new FakeSecretStore() };
		await machine.fs.mkdir(HOME, { recursive: true });
	});

	it("is done for a provider once a worker holds its key", async () => {
		const setup = new Setup(machine, [AREA]);
		await expect(setup.submit("worker-key-anthropic", {})).rejects.toThrow(
			"No worker holds a key from Anthropic yet",
		);
		const keys = await WorkerKeys.open(
			`${HOME}/${WORKER_KEYS_FILE}`,
			machine.fs,
			machine.device,
		);
		await keys.add({ type: "small" }, "anthropic", "sk-ant");

		const progress = await setup.read();
		expect(
			progress.areas[0]?.steps.map((step) => [step.id, step.status]),
		).toEqual([
			["worker-key-anthropic", "done"],
			["worker-key-openai", "ready"],
		]);
	});
});
