import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { FsStorage } from "../storage";
import { API_TOKEN, SavedTunnel, TUNNEL_TOKEN } from "../tunnel";
import { FakeCloudflare } from "../tunnel/testing";
import { REMOTE_ACCESS_AREA } from "./area-remote";
import { Setup, type SetupMachine } from "./setup";

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
			await SavedTunnel.in(
				new FsStorage(`${HOME}`, machine.fs),
				machine.device,
			).read(),
		).toMatchObject({ host: "splates.example.com", team: "crew" });
		expect(await machine.device.get(TUNNEL_TOKEN)).toBeDefined();
	});
});
