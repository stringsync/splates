import { describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { MemoryLogger } from "webappwiz/log";
import { MemoryLock } from "webappwiz/system";
import { FakeFs } from "webappwiz/system/testing";
import { Creds } from "./creds";
import { FakeCloudflare } from "./fake-cloudflare";
import { SavedTunnel, TUNNEL_TOKEN } from "./saved-tunnel";
import { slotTunnelSetup } from "./slot-tunnel";
import { tunnelRemove } from "./tunnel-remove";
import { API_TOKEN, tunnelSetup } from "./tunnel-setup";

describe("tunnelRemove", () => {
	it("deletes the machine's tunnel, route, application and policy, and forgets them", async () => {
		const { cloudflare, store, fs, saved, remove } = await account();

		await remove();

		expect(cloudflare.tunnels).toEqual([]);
		expect(cloudflare.records).toEqual([]);
		expect(cloudflare.apps).toEqual([]);
		expect(cloudflare.policies).toEqual([]);
		expect(await saved.read()).toBeNull();
		expect(await fs.exists(saved.path)).toBe(false);
		expect(store.values.has(TUNNEL_TOKEN)).toBe(false);
		expect(store.values.get(API_TOKEN)).toBe("api-token");
	});

	it("removes the slots' tunnels, routes, wildcard application and tokens too", async () => {
		const { cloudflare, store, fs, slot, remove } = await account([
			"fox",
			"owl",
		]);

		await remove();

		expect(cloudflare.tunnels).toEqual([]);
		expect(cloudflare.records).toEqual([]);
		expect(cloudflare.apps).toEqual([]);
		expect(cloudflare.policies).toEqual([]);
		expect(await fs.exists(slot("fox").path)).toBe(false);
		expect([...store.values.keys()]).toEqual([API_TOKEN]);
	});

	it("leaves another record and application alone", async () => {
		const { cloudflare, remove } = await account();
		cloudflare.records.push({
			id: "site",
			type: "A",
			name: "www.example.com",
			content: "192.0.2.1",
			proxied: true,
		});
		cloudflare.apps.push({
			id: "other",
			type: "self_hosted",
			name: "other",
			domain: "other.example.com",
			aud: "x",
			policies: [],
		});

		await remove();

		expect(cloudflare.records.map(({ id }) => id)).toEqual(["site"]);
		expect(cloudflare.apps.map(({ id }) => id)).toEqual(["other"]);
	});

	it("changes nothing when nothing was saved", async () => {
		const { cloudflare, saved, remove } = await account();
		await remove();
		cloudflare.changes.length = 0;

		await remove();
		expect(cloudflare.changes).toEqual([]);
		expect(await saved.read()).toBeNull();
	});

	it("finishes what is left when run again after Cloudflare forgot a part", async () => {
		const { cloudflare, saved, remove } = await account();
		cloudflare.apps.length = 0;

		await remove();

		expect(cloudflare.tunnels).toEqual([]);
		expect(await saved.read()).toBeNull();
	});
});

/** An account `arbor tunnel setup` has set up `example.com` in, with `words` as slots. */
async function account(words: string[] = []) {
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
	const saved = new SavedTunnel("/home/.arbor/tunnel.json", { fs, store });
	await tunnelSetup({
		host: "arbor.example.com",
		email: "me@example.com",
		name: "arbor",
		team: "",
		creds,
		task: null,
		saved,
		log,
		fetch: cloudflare.fetch,
	});
	const machine = (await saved.read()) ?? expect.unreachable();
	const slot = (word: string) =>
		new SavedTunnel(`/home/.arbor/slots/${word}/tunnel.json`, { fs, store });
	for (const word of words) {
		await slotTunnelSetup({
			slot: { word, emoji: "" },
			machine,
			creds,
			saved: slot(word),
			log,
			fetch: cloudflare.fetch,
		});
	}
	const remove = () =>
		tunnelRemove({
			saved,
			slots: ["fox", "owl", "cat"].map(slot),
			creds,
			task: null,
			fs,
			log,
			fetch: cloudflare.fetch,
		});
	return { cloudflare, store, fs, saved, slot, remove };
}
