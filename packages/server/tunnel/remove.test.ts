import { describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { MemoryLogger } from "webappwiz/log";
import { MemoryLock } from "webappwiz/system";
import { FakeFs } from "webappwiz/system/testing";
import { Creds } from "../creds";
import { slotTunnelSetup } from "../ports";
import { FsStorage } from "../storage";
import { tunnelRemove } from "./remove";
import { SavedTunnel, TUNNEL_TOKEN } from "./saved";
import { API_TOKEN, tunnelSetup } from "./setup";
import { FakeCloudflare } from "./testing";

describe("tunnelRemove", () => {
	it("deletes the machine's tunnel, route, application and policy, and forgets them", async () => {
		const { cloudflare, store, saved, remove } = await account();

		await remove();

		expect(cloudflare.tunnels).toEqual([]);
		expect(cloudflare.records).toEqual([]);
		expect(cloudflare.apps).toEqual([]);
		expect(cloudflare.policies).toEqual([]);
		expect(await saved.read()).toBeNull();
		expect(await saved.read()).toBeNull();
		expect(store.values.has(TUNNEL_TOKEN)).toBe(false);
		expect(store.values.get(API_TOKEN)).toBe("api-token");
	});

	it("removes the slots' tunnels, routes, wildcard application and tokens too", async () => {
		const { cloudflare, store, slot, remove } = await account(["fox", "owl"]);

		await remove();

		expect(cloudflare.tunnels).toEqual([]);
		expect(cloudflare.records).toEqual([]);
		expect(cloudflare.apps).toEqual([]);
		expect(cloudflare.policies).toEqual([]);
		expect(await slot("fox").read()).toBeNull();
		expect([...store.values.keys()]).toEqual([API_TOKEN]);
	});

	it("deletes the workers' policy and the service tokens it lets in, not other tokens", async () => {
		const { cloudflare, remove } = await account();
		const app = cloudflare.apps[0] ?? expect.unreachable();
		const token = (id: string) => ({
			id,
			name: "t",
			duration: "forever",
			client_id: `${id}.access`,
			client_secret: "s",
		});
		cloudflare.serviceTokens.push(token("w1"), token("w2"), token("mine"));
		cloudflare.policies.push({
			id: "workers",
			name: "splates workers",
			decision: "non_identity",
			include: ["w1", "w2"].map((id) => ({ service_token: { token_id: id } })),
		});
		app.policies.push({ id: "workers", precedence: 2 });

		await remove();

		expect(cloudflare.policies).toEqual([]);
		expect(cloudflare.serviceTokens.map(({ id }) => id)).toEqual(["mine"]);
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

/** An account `splates tunnel setup` has set up `example.com` in, with `words` as slots. */
async function account(words: string[] = []) {
	const cloudflare = new FakeCloudflare().zone("example.com");
	const store = new FakeSecretStore({ [API_TOKEN]: "api-token" });
	const fs = new FakeFs();
	const creds = new Creds(
		"/repo/.git/splates/creds.json",
		new MemoryLock(),
		{ project: new FakeSecretStore(), device: store },
		{ fs },
	);
	const log = new MemoryLogger();
	const saved = SavedTunnel.in(new FsStorage("/home/.splates", fs), store);
	await tunnelSetup({
		host: "splates.example.com",
		email: "me@example.com",
		name: "splates",
		team: "",
		creds,
		task: null,
		saved,
		log,
		fetch: cloudflare.fetch,
	});
	const machine = (await saved.read()) ?? expect.unreachable();
	const slot = (word: string) =>
		SavedTunnel.in(new FsStorage(`/home/.splates/slots/${word}`, fs), store);
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
