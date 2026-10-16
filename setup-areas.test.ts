import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { OPENAI_KEY } from "./dev-transcriber";
import { SavedTunnel, TUNNEL_TOKEN } from "./saved-tunnel";
import { Setup, type SetupMachine } from "./setup";
import { SETUP_AREAS } from "./setup-areas";

const HOME = "/home/.arbor";

describe("SETUP_AREAS", () => {
	let machine: SetupMachine;

	beforeEach(() => {
		machine = { fs: new FakeFs(), home: HOME, device: new FakeSecretStore() };
	});

	it("leaves every step on a fresh machine, the agents first", async () => {
		const progress = await new Setup(machine, SETUP_AREAS).read();

		expect(
			progress.areas.flatMap((area) => area.steps.map((step) => step.status)),
		).toEqual(["ready", "ready", "ready", "ready"]);
		expect(progress.next).toBe("agents");
		expect(progress.required).toBe(true);
	});

	it("checks each step against what arbor keeps on the machine", async () => {
		await machine.fs.mkdir(HOME, { recursive: true });
		await machine.fs.write(`${HOME}/agents.json`, "{}");
		await machine.fs.write(
			`${HOME}/push.json`,
			JSON.stringify({ keys: {}, devices: [{}] }),
		);
		await new SavedTunnel(`${HOME}/tunnel.json`, {
			fs: machine.fs,
			store: machine.device,
		}).save({ host: "arbor.example.com", team: "t", aud: "a", tunnel: "i" });
		await machine.device.set(TUNNEL_TOKEN, "token");
		await machine.device.set(OPENAI_KEY, "key");

		const progress = await new Setup(machine, SETUP_AREAS).read();

		expect(progress.areas.every((area) => area.left === 0)).toBe(true);
		expect(progress.next).toBeNull();
	});
});
