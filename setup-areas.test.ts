import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { OPENAI_KEY } from "./dev-transcriber";
import { SavedTunnel, TUNNEL_TOKEN } from "./saved-tunnel";
import { Setup, type SetupMachine } from "./setup";
import { SETUP_AREAS } from "./setup-areas";
import { API_TOKEN } from "./tunnel-setup";

const HOME = "/home/.arbor";

describe("SETUP_AREAS", () => {
	let machine: SetupMachine;

	beforeEach(() => {
		machine = {
			fs: new FakeFs(),
			home: HOME,
			device: new FakeSecretStore(),
			fetch: (async () =>
				new Response(null, {
					status: 302,
					headers: {
						location: "https://t.cloudflareaccess.com/cdn-cgi/access/login",
					},
				})) as unknown as typeof fetch,
		};
	});

	it("leaves every step on a fresh machine, the agents first", async () => {
		const progress = await new Setup(machine, SETUP_AREAS).read();

		expect(
			progress.areas.flatMap((area) => area.steps.map((step) => step.status)),
		).toEqual([
			"ready",
			"waiting",
			"ready",
			"waiting",
			"waiting",
			"waiting",
			"ready",
			"waiting",
			"ready",
		]);
		expect(progress.next).toBe("agent-roster");
		expect(progress.required).toBe(true);
	});

	it("checks each step against what arbor keeps on the machine", async () => {
		await machine.fs.mkdir(HOME, { recursive: true });
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
		await machine.fs.write(
			`${HOME}/push.json`,
			JSON.stringify({
				keys: {},
				devices: [{ wants: { waiting: true, finished: false } }],
			}),
		);
		await new SavedTunnel(`${HOME}/tunnel.json`, {
			fs: machine.fs,
			store: machine.device,
		}).save({ host: "arbor.example.com", team: "t", aud: "a", tunnel: "i" });
		await machine.device.set(TUNNEL_TOKEN, "token");
		await machine.device.set(API_TOKEN, "api");
		await machine.fs.mkdir(`${HOME}/slots/bee`, { recursive: true });
		await machine.fs.write(`${HOME}/slots/bee/tunnel.json`, "{}");
		await machine.device.set(OPENAI_KEY, "key");

		const progress = await new Setup(machine, SETUP_AREAS).read();

		expect(progress.areas.every((area) => area.left === 0)).toBe(true);
		expect(progress.next).toBeNull();
	});

	it("leaves the models and notices to do when only their first step is", async () => {
		await machine.fs.mkdir(HOME, { recursive: true });
		await machine.fs.write(
			`${HOME}/agents.json`,
			JSON.stringify({
				agents: [{ id: "x", name: "X", argv: ["x"], models: [] }],
			}),
		);
		await machine.fs.write(
			`${HOME}/push.json`,
			JSON.stringify({
				keys: {},
				devices: [{ wants: { waiting: false, finished: false } }],
			}),
		);

		const steps = (await new Setup(machine, SETUP_AREAS).read()).areas.flatMap(
			(area) => area.steps,
		);
		const status = (id: string) => steps.find((step) => step.id === id)?.status;

		expect(status("agent-roster")).toBe("done");
		expect(status("agent-models")).toBe("ready");
		expect(status("notifications-device")).toBe("done");
		expect(status("notifications-notices")).toBe("ready");
	});
});
