import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { Setup, type SetupArea, type SetupMachine } from "./setup";
import { AGENTS_AREA } from "./setup-area-agents";

const HOME = "/home/.splates";

/** Each step's status, by id. */
async function statuses(machine: SetupMachine, area: SetupArea) {
	const progress = await new Setup(machine, [area]).read();
	return Object.fromEntries(
		(progress.areas[0]?.steps ?? []).map((step) => [step.id, step.status]),
	);
}

describe("AGENTS_AREA", () => {
	let machine: SetupMachine;

	beforeEach(async () => {
		machine = { fs: new FakeFs(), home: HOME, device: new FakeSecretStore() };
		await machine.fs.mkdir(HOME, { recursive: true });
	});

	it("is done once the roster lists an agent with its models", async () => {
		await machine.fs.write(
			`${HOME}/agents.json`,
			JSON.stringify({
				agents: [
					{
						id: "claude",
						name: "Claude",
						argv: ["claude"],
						models: [{ id: "opus", name: "Opus", strengths: "", cost: "" }],
					},
				],
			}),
		);

		expect(await statuses(machine, AGENTS_AREA)).toEqual({
			"agent-roster": "done",
			"agent-models": "done",
		});
	});

	it("leaves the models to do while an agent lists none", async () => {
		await machine.fs.write(
			`${HOME}/agents.json`,
			JSON.stringify({
				agents: [{ id: "x", name: "X", argv: ["x"], models: [] }],
			}),
		);

		expect(await statuses(machine, AGENTS_AREA)).toEqual({
			"agent-roster": "done",
			"agent-models": "ready",
		});
	});
});
