import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import {
	API_TOKEN,
	SavedPortsHost,
	SavedTunnel,
	TUNNEL_TOKEN,
} from "../tunnel";
import { FakeCloudflare } from "../tunnel/testing";
import { REMOTE_ACCESS_AREA } from "./area-remote";
import { Setup, type SetupMachine } from "./setup";

const HOME = "/home/.splates";

describe("the tunnel setup step's undo", () => {
	let machine: SetupMachine;

	beforeEach(async () => {
		const cloudflare = new FakeCloudflare().zone("example.com");
		machine = {
			fs: new FakeFs(),
			home: HOME,
			device: new FakeSecretStore({ [API_TOKEN]: "api" }),
			fetch: cloudflare.fetch,
		};
		await machine.fs.mkdir(HOME, { recursive: true });
		await new SavedTunnel(`${HOME}/tunnel.json`, {
			fs: machine.fs,
			store: machine.device,
		}).save({
			host: "splates.example.com",
			team: "crew",
			aud: "a",
			tunnel: "i",
		});
		await machine.device.set(TUNNEL_TOKEN, "token");
		await new SavedPortsHost(`${HOME}/ports.json`, machine.fs).save(
			"ports.example.com",
		);
		// What `splates tunnel remove` leaves: no saved tunnel, nor its token.
		machine.removeTunnel = async () => {
			await machine.fs.rm(`${HOME}/tunnel.json`, { force: true });
			await machine.device.delete(TUNNEL_TOKEN);
		};
	});

	it("plans removing the tunnel by its host, which it asks to have typed", async () => {
		const plan = await new Setup(machine, [REMOTE_ACCESS_AREA]).undoPlan(
			"remote-access",
		);

		expect(plan.steps.map((step) => step.id)).toEqual([
			"ports-host",
			"tunnel",
			"cloudflare-token",
		]);
		expect(plan.steps[1]?.removes).toEqual([
			"The tunnel to splates.example.com, and the DNS record routing splates.example.com to it",
			"The Access application in front of splates.example.com, and its policy",
			"The workers' Access policy and its service tokens: workers joined through the tunnel lose their access",
			"Each slot's tunnel, and the Access application in front of every slot",
		]);
		expect(plan.steps[2]?.leaves[0]).toContain(
			"https://dash.cloudflare.com/profile/api-tokens",
		);
		expect(plan.creds).toEqual([{ name: API_TOKEN, keptFor: null }]);
		expect(plan.confirm).toBe("splates.example.com");
		expect(plan.refused).toBeNull();
	});

	it("removes the tunnel and forgets the API token once the host is typed", async () => {
		let removed = 0;
		const removeTunnel = machine.removeTunnel;
		machine.removeTunnel = async () => {
			removed++;
			await removeTunnel?.();
		};
		const setup = new Setup(machine, [REMOTE_ACCESS_AREA]);

		await expect(setup.undo("remote-access", null)).rejects.toThrow(
			"Type splates.example.com to undo Remote access.",
		);
		const progress = await setup.undo("remote-access", "splates.example.com");

		expect(removed).toBe(1);
		expect(
			await new SavedPortsHost(`${HOME}/ports.json`, machine.fs).read(),
		).toBeNull();
		expect(await machine.device.get(API_TOKEN)).toBeUndefined();
		expect(progress.areas[0]?.done).toBe(0);
	});

	it("refuses to remove the tunnel outside a project", async () => {
		delete machine.removeTunnel;

		const plan = await new Setup(machine, [REMOTE_ACCESS_AREA]).undoPlan(
			"remote-access",
		);

		expect(plan.refused).toContain("Open Setup from a project");
	});

	it("forgets the ports host, again with nothing saved", async () => {
		const step = REMOTE_ACCESS_AREA.steps.find(
			(each) => each.id === "ports-host",
		);

		expect(await step?.undo?.removes(machine)).toEqual([
			"The saved base host ports.example.com, which a running `splates server` serves until it restarts",
		]);
		expect(await step?.undo?.leaves?.(machine)).toEqual([
			"The DNS and TLS routing `*.ports.example.com` to `splates server`, which you made: remove it where you made it.",
		]);
		await step?.undo?.run(machine);
		expect(await step?.check(machine)).toBe(false);
		await step?.undo?.run(machine);
	});
});
