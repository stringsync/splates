import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { FakeCloudflare } from "./fake-cloudflare";
import { SavedTunnel, TUNNEL_TOKEN } from "./saved-tunnel";
import { Setup, type SetupMachine } from "./setup";
import { REMOTE_ACCESS_AREA } from "./setup-area-remote";
import { API_TOKEN } from "./tunnel-setup";

const HOME = "/home/.splates";

describe("the tunnel setup step", () => {
	let machine: SetupMachine;
	let cloudflare: FakeCloudflare;

	beforeEach(async () => {
		cloudflare = new FakeCloudflare().zone("example.com");
		cloudflare.team = null;
		machine = {
			fs: new FakeFs(),
			home: HOME,
			device: new FakeSecretStore({ [API_TOKEN]: "api" }),
			fetch: cloudflare.fetch,
		};
		await machine.fs.mkdir(HOME, { recursive: true });
	});

	it("makes the tunnel from the host and emails, asking for a team only when the account has none", async () => {
		const setup = new Setup(machine, [REMOTE_ACCESS_AREA]);
		const answers = { host: "splates.example.com", email: "me@example.com" };

		await expect(setup.submit("tunnel", answers)).rejects.toThrow(
			"give a team name below",
		);
		await setup.submit("tunnel", { ...answers, team: "crew" });

		expect(
			await new SavedTunnel(`${HOME}/tunnel.json`, {
				fs: machine.fs,
				store: machine.device,
			}).read(),
		).toMatchObject({ host: "splates.example.com", team: "crew" });
		expect(await machine.device.get(TUNNEL_TOKEN)).toBeDefined();
	});
});
