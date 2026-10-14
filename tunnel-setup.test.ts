import { describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { MemoryLogger } from "webappwiz/log";
import { MemoryLock } from "webappwiz/system";
import { FakeFs } from "webappwiz/system/testing";
import { Creds } from "./creds";
import { Exit } from "./exit";
import { FakeCloudflare } from "./fake-cloudflare";
import { SavedTunnel, TUNNEL_TOKEN } from "./saved-tunnel";
import { API_TOKEN, tunnelSetup } from "./tunnel-setup";

describe("tunnelSetup", () => {
	it("makes the tunnel, its route and its Access application, and saves them", async () => {
		const { cloudflare, store, creds, saved, setup } = machine();

		await setup();

		expect(cloudflare.changes).toEqual([
			"POST /accounts/acct/cfd_tunnel",
			"POST /zones/zone-example.com/dns_records",
			"POST /accounts/acct/access/policies",
			"POST /accounts/acct/access/apps",
		]);
		const [tunnel] = cloudflare.tunnels;
		expect(tunnel).toMatchObject({ name: "arbor", config_src: "local" });
		expect(cloudflare.records).toMatchObject([
			{
				type: "CNAME",
				name: "arbor.example.com",
				content: `${tunnel?.id}.cfargotunnel.com`,
				proxied: true,
			},
		]);
		expect(cloudflare.policies).toMatchObject([
			{ decision: "allow", include: [{ email: { email: "me@example.com" } }] },
		]);
		const [app] = cloudflare.apps;
		expect(app).toMatchObject({
			type: "self_hosted",
			domain: "arbor.example.com",
			policies: [{ id: cloudflare.policies[0]?.id, precedence: 1 }],
		});
		expect(await saved.read()).toEqual({
			host: "arbor.example.com",
			team: "team",
			aud: app?.aud ?? "",
			tunnel: tunnel?.id ?? "",
		});
		expect(store.values.get(TUNNEL_TOKEN)).toBe(`token-of-${tunnel?.id}`);
		expect(await creds.kept()).toContainEqual({
			name: TUNNEL_TOKEN,
			scope: "device",
			savedBy: "arbor tunnel setup",
		});
		expect([...cloudflare.tokens]).toEqual(["Bearer api-token"]);
	});

	it("changes nothing run again, and only the policy for other emails", async () => {
		const { cloudflare, setup } = machine();
		await setup();
		cloudflare.changes.length = 0;

		await setup();
		expect(cloudflare.changes).toEqual([]);

		await setup("me@example.com,you@example.com");
		expect(cloudflare.changes).toEqual([
			`PUT /accounts/acct/access/policies/${cloudflare.policies[0]?.id}`,
		]);
		expect(cloudflare.tunnels).toHaveLength(1);
		expect(cloudflare.apps).toHaveLength(1);
	});

	it("moves a route from another tunnel, and refuses any other record", async () => {
		const { cloudflare, setup } = machine();
		cloudflare.records.push({
			id: "old",
			type: "CNAME",
			name: "arbor.example.com",
			content: "gone.cfargotunnel.com",
			proxied: true,
		});
		await setup();
		expect(cloudflare.records[0]?.content).toBe(
			`${cloudflare.tunnels[0]?.id}.cfargotunnel.com`,
		);

		cloudflare.records.push({
			id: "site",
			type: "A",
			name: "www.example.com",
			content: "192.0.2.1",
			proxied: true,
		});
		await expect(setup("me@example.com", "www.example.com")).rejects.toThrow(
			"www.example.com already has a A record pointing at 192.0.2.1",
		);
	});

	it("requests the API token with how to make it, when none is kept", async () => {
		const { cloudflare, store, creds, setup } = machine();
		store.values.delete(API_TOKEN);

		await expect(setup()).rejects.toThrow("arbor creds wait");

		const [request] = await creds.requests();
		expect(request).toMatchObject({
			name: API_TOKEN,
			scope: "device",
			status: "open",
		});
		expect(request?.instructions).toContain("Cloudflare Tunnel · Edit");
		expect(request?.instructions).toContain("arbor.example.com");
		expect(cloudflare.changes).toEqual([]);
	});

	it("makes the Zero Trust organization with --team when the account has none", async () => {
		const { cloudflare, saved, setup } = machine();
		cloudflare.team = null;

		await expect(setup()).rejects.toThrow("--team <name>");
		await setup("me@example.com", "arbor.example.com", "my-team");

		expect(cloudflare.changes[0]).toBe(
			"POST /accounts/acct/access/organizations",
		);
		expect((await saved.read())?.team).toBe("my-team");
	});

	it("says what is missing in the account, changing nothing", async () => {
		const { cloudflare, setup } = machine();

		await expect(setup("me@example.com", "arbor.other.com")).rejects.toThrow(
			"no zone the token can read serves arbor.other.com",
		);
		await expect(setup("")).rejects.toThrow(Exit);
		expect(cloudflare.changes).toEqual([]);
	});
});

/** A machine with an API token kept on the device, and an account to set up in. */
function machine() {
	const cloudflare = new FakeCloudflare().zone("example.com");
	const store = new FakeSecretStore({ [API_TOKEN]: "api-token" });
	const fs = new FakeFs();
	const creds = new Creds(
		"/repo/.git/arbor/creds.json",
		new MemoryLock(),
		{ project: new FakeSecretStore(), device: store },
		{ fs },
	);
	const saved = new SavedTunnel("/home/.arbor/tunnel.json", { fs, store });
	const setup = (
		email = "me@example.com",
		host = "arbor.example.com",
		team = "",
	) =>
		tunnelSetup({
			host,
			email,
			name: "arbor",
			team,
			creds,
			task: null,
			saved,
			log: new MemoryLogger(),
			fetch: cloudflare.fetch,
		});
	return { cloudflare, store, creds, saved, setup };
}
