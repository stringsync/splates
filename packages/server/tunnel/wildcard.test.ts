import { describe, expect, it } from "bun:test";
import { FakeSecretStore } from "core/creds/testing";
import { MemoryLogger } from "core/log";
import { FakeFs } from "core/system/testing";
import { FsStorage } from "../storage";
import { API_TOKEN, SavedTunnel } from "./saved";
import { FakeCloudflare } from "./testing";
import { clearWildcardShadow, ensureWildcardTunnel } from "./wildcard";

describe("ensureWildcardTunnel", () => {
	it("provisions wildcard DNS and Access, clears stale unheld slot CNAMEs, and saves wildcard", async () => {
		const { cloudflare, store, saved, log } = await legacyMachine();
		cloudflare.records.push(
			{
				id: "stale-cat",
				type: "CNAME",
				name: "cat.example.com",
				content: "old-slot-cat.cfargotunnel.com",
				proxied: true,
			},
			{
				id: "custom-a",
				type: "A",
				name: "bee.example.com",
				content: "192.0.2.1",
				proxied: true,
			},
		);

		const wildcard = await ensureWildcardTunnel({
			saved,
			store,
			clearWords: ["cat", "bee"],
			log,
			fetch: cloudflare.fetch,
		});

		const wildcardApp = cloudflare.apps.find(
			(app) => app.domain === "*.example.com",
		);
		expect(wildcard).toEqual({
			base: "example.com",
			aud: wildcardApp?.aud ?? "",
		});
		expect(wildcardApp).toMatchObject({
			name: "splates-slots",
			policies: [{ id: "pol-1", precedence: 1 }],
		});
		expect(cloudflare.records).toContainEqual(
			expect.objectContaining({
				type: "CNAME",
				name: "*.example.com",
				content: "tun-main.cfargotunnel.com",
				proxied: true,
			}),
		);
		// Stale tunnel CNAME for unheld slot cleared; non-tunnel A record untouched.
		expect(
			cloudflare.records.find((each) => each.name === "cat.example.com"),
		).toBeUndefined();
		expect(
			cloudflare.records.find((each) => each.id === "custom-a"),
		).toBeDefined();
		expect((await saved.read())?.wildcard).toEqual(wildcard ?? undefined);

		// Calling again returns cached wildcard with zero Cloudflare calls.
		cloudflare.changes.length = 0;
		const second = await ensureWildcardTunnel({
			saved,
			store,
			clearWords: ["cat"],
			log,
			fetch: cloudflare.fetch,
		});
		expect(second).toEqual(wildcard);
		expect(cloudflare.changes).toEqual([]);
	});

	it("returns null without failing when no API token or machine tunnel is present", async () => {
		const { cloudflare, store, saved, log } = await legacyMachine();
		store.values.delete(API_TOKEN);

		expect(
			await ensureWildcardTunnel({
				saved,
				store,
				log,
				fetch: cloudflare.fetch,
			}),
		).toBeNull();
		expect(cloudflare.changes).toEqual([]);

		// Slot tunnels (account set) are never upgraded to wildcard.
		store.values.set(API_TOKEN, "api-token");
		await saved.save({
			host: "cat.example.com",
			team: "team",
			aud: "slot-aud",
			tunnel: "tun-cat",
			account: "acct",
		});
		expect(
			await ensureWildcardTunnel({
				saved,
				store,
				log,
				fetch: cloudflare.fetch,
			}),
		).toBeNull();
	});

	it("clears a shadowing slot CNAME on demand without touching routes to the machine tunnel", async () => {
		const { cloudflare, store, saved, log } = await legacyMachine();
		await saved.save({
			host: "example.com",
			team: "team",
			aud: "main-aud",
			tunnel: "tun-main",
			wildcard: { base: "example.com", aud: "wild-aud" },
		});
		cloudflare.records.push(
			{
				id: "slot-dog",
				type: "CNAME",
				name: "dog.example.com",
				content: "tun-slot-dog.cfargotunnel.com",
				proxied: true,
			},
			{
				id: "main-fox",
				type: "CNAME",
				name: "fox.example.com",
				content: "tun-main.cfargotunnel.com",
				proxied: true,
			},
		);
		const record = (await saved.read()) ?? expect.unreachable();

		expect(
			await clearWildcardShadow({
				record,
				word: "dog",
				store,
				log,
				fetch: cloudflare.fetch,
			}),
		).toBe(true);
		expect(
			await clearWildcardShadow({
				record,
				word: "fox",
				store,
				log,
				fetch: cloudflare.fetch,
			}),
		).toBe(false);
		expect(
			cloudflare.records.find((each) => each.name === "dog.example.com"),
		).toBeUndefined();
		expect(
			cloudflare.records.find((each) => each.name === "fox.example.com"),
		).toBeDefined();
	});
});

/** Seeds a pre-wildcard saved machine tunnel (no `wildcard` field yet). */
async function legacyMachine() {
	const cloudflare = new FakeCloudflare().zone("example.com");
	cloudflare.tunnels.push({
		id: "tun-main",
		name: "splates",
		config_src: "local",
	});
	cloudflare.records.push({
		id: "rec-main",
		type: "CNAME",
		name: "example.com",
		content: "tun-main.cfargotunnel.com",
		proxied: true,
	});
	cloudflare.policies.push({
		id: "pol-1",
		name: "splates",
		decision: "allow",
		include: [{ email: { email: "me@example.com" } }],
	});
	cloudflare.apps.push({
		id: "app-1",
		type: "self_hosted",
		name: "splates",
		domain: "example.com",
		aud: "main-aud",
		policies: [{ id: "pol-1", precedence: 1 }],
	});
	const store = new FakeSecretStore({ [API_TOKEN]: "api-token" });
	const fs = new FakeFs();
	const saved = SavedTunnel.in(new FsStorage("/home/.splates", fs), store);
	await saved.save({
		host: "example.com",
		team: "team",
		aud: "main-aud",
		tunnel: "tun-main",
	});
	return { cloudflare, store, fs, saved, log: new MemoryLogger() };
}
