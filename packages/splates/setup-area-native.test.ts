import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { Setup, type SetupArea, type SetupMachine } from "./setup";
import { CLAUDE_AREA, CODEX_AREA } from "./setup-area-native";

const HOME = "/home/.splates";

/** Each step's status, by id. */
async function statuses(machine: SetupMachine, area: SetupArea) {
	const progress = await new Setup(machine, [area]).read();
	return Object.fromEntries(
		(progress.areas[0]?.steps ?? []).map((step) => [step.id, step.status]),
	);
}

describe("CLAUDE_AREA and CODEX_AREA", () => {
	let machine: SetupMachine;

	beforeEach(async () => {
		machine = { fs: new FakeFs(), home: HOME, device: new FakeSecretStore() };
		await machine.fs.mkdir(HOME, { recursive: true });
	});

	it("checks Claude and Codex independently without modifying their roster", async () => {
		const roster = JSON.stringify({
			agents: [
				{ id: "claude", name: "Claude", argv: ["custom-claude"], models: [] },
			],
		});
		await machine.fs.write(`${HOME}/agents.json`, roster);

		expect(await statuses(machine, CLAUDE_AREA)).toEqual({
			"claude-roster": "done",
			"claude-models": "ready",
		});
		expect(await statuses(machine, CODEX_AREA)).toEqual({
			"codex-roster": "ready",
			"codex-models": "waiting",
		});
		expect(await machine.fs.read(`${HOME}/agents.json`)).toBe(roster);
	});
});
