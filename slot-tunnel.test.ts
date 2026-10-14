import { describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { MemoryLogger } from "webappwiz/log";
import { MemoryLock } from "webappwiz/system";
import { FakeFs } from "webappwiz/system/testing";
import { Creds } from "./creds";
import { FakeCloudflare } from "./fake-cloudflare";
import { SavedTunnel, TUNNEL_TOKEN } from "./saved-tunnel";
import { slotToken, slotTunnelSetup } from "./slot-tunnel";
import { API_TOKEN, tunnelSetup } from "./tunnel-setup";

describe("slotTunnelSetup", () => {
	it("makes the slot's tunnel and route, and one wildcard Access app for every slot", async () => {
		const { cloudflare, store, fs, machine, setup } = await account();

		const fox = await setup("fox");

		const tunnel = cloudflare.tunnels.find(({ name }) => name === "arbor-fox");
		expect(cloudflare.records).toContainEqual(
			expect.objectContaining({
				name: "fox.example.com",
				content: `${tunnel?.id}.cfargotunnel.com`,
			}),
		);
		const wildcard = cloudflare.apps.find(
			({ domain }) => domain === "*.example.com",
		);
		expect(wildcard).toMatchObject({
			name: "arbor-slots",
			policies: [{ id: cloudflare.policies[0]?.id, precedence: 1 }],
		});
		expect(fox).toEqual({
			host: "fox.example.com",
			team: machine.team,
			aud: wildcard?.aud ?? "",
			tunnel: tunnel?.id ?? "",
			token: "ARBOR_SLOT_FOX_TUNNEL_TOKEN",
		});
		const saved = new SavedTunnel("/home/.arbor/slots/fox/tunnel.json", {
			fs,
			store,
		});
		expect(await saved.read()).toEqual(fox);
		expect(await saved.token()).toBe(`token-of-${tunnel?.id}`);
		// The machine's own tunnel keeps its token.
		expect(store.values.get(TUNNEL_TOKEN)).not.toBe(await saved.token());

		cloudflare.changes.length = 0;
		await setup("owl");
		expect(cloudflare.changes).toEqual([
			"POST /accounts/acct/cfd_tunnel",
			"POST /zones/zone-example.com/dns_records",
		]);
		expect(cloudflare.apps).toHaveLength(2);
	});

	it("changes nothing set up again", async () => {
		const { cloudflare, setup } = await account();
		await setup("fox");
		cloudflare.changes.length = 0;

		await setup("fox");
		expect(cloudflare.changes).toEqual([]);
	});

	it("names each slot's token by its word", () => {
		expect(slotToken({ word: "bear", emoji: "🐻" })).toBe(
			"ARBOR_SLOT_BEAR_TUNNEL_TOKEN",
		);
	});
});

/** An account `arbor tunnel setup` has set up `example.com` in. */
async function account() {
	const cloudflare = new FakeCloudflare().zone("example.com");
	const store = new FakeSecretStore({ [API_TOKEN]: "api-token" });
	const fs = new FakeFs();
	const creds = new Creds(
		"/repo/.git/arbor/creds.json",
		new MemoryLock(),
		{ project: new FakeSecretStore(), device: store },
		{ fs },
	);
	const log = new MemoryLogger();
	const machineTunnel = new SavedTunnel("/home/.arbor/tunnel.json", {
		fs,
		store,
	});
	await tunnelSetup({
		host: "example.com",
		email: "me@example.com",
		name: "arbor",
		team: "",
		creds,
		task: null,
		saved: machineTunnel,
		log,
		fetch: cloudflare.fetch,
	});
	const machine = (await machineTunnel.read()) ?? expect.unreachable();
	const setup = (word: string) =>
		slotTunnelSetup({
			slot: { word, emoji: "" },
			machine,
			creds,
			saved: new SavedTunnel(`/home/.arbor/slots/${word}/tunnel.json`, {
				fs,
				store,
			}),
			log,
			fetch: cloudflare.fetch,
		});
	return { cloudflare, store, fs, machine, setup };
}
