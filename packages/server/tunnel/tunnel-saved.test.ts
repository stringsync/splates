import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { MemoryLogger } from "webappwiz/log";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { FsStorage } from "../storage";
import { CloudflaredTunnelProvider } from "./cloudflared";
import { SavedTunnel, TUNNEL_TOKEN } from "./saved";
import { savedTunnelConfig } from "./tunnel";

const ps = new FakePs();
const access = { issuer: "https://team.cloudflareaccess.com", aud: "app-aud" };

describe("savedTunnelConfig", () => {
	const record = {
		host: "splates.example.com",
		team: "team",
		aud: "app-aud",
		tunnel: "tunnel-id",
	};

	let store: FakeSecretStore;
	let saved: SavedTunnel;

	beforeEach(() => {
		store = new FakeSecretStore();
		saved = SavedTunnel.in(
			new FsStorage("/home/.splates", new FakeFs()),
			store,
		);
	});

	it("is null with nothing saved, and runs what was saved with its token", async () => {
		expect(await savedTunnelConfig(saved, ps, new MemoryLogger())).toBeNull();

		await saved.save(record);
		await store.set(TUNNEL_TOKEN, "secret");
		const config = await savedTunnelConfig(saved, ps, new MemoryLogger());

		expect(config?.access).toEqual(access);
		expect(config?.tunnel.host).toBe("splates.example.com");
		expect(config?.tunnel.provider).toBeInstanceOf(CloudflaredTunnelProvider);
	});

	it("logs a saved tunnel whose token is gone, and runs none", async () => {
		await saved.save(record);
		const log = new MemoryLogger();

		expect(await savedTunnelConfig(saved, ps, log)).toBeNull();
		expect(JSON.stringify(log.entries)).toContain(
			"run `splates tunnel setup` again",
		);
	});
});
