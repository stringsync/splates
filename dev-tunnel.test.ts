import { describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { MemoryLogger } from "webappwiz/log";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { CloudflaredTunnelProvider } from "./cloudflared-tunnel-provider";
import { savedTunnelConfig, startTunnel, tunnelConfig } from "./dev-tunnel";
import { Exit } from "./exit";
import { FakeTunnelProvider } from "./fake-tunnel-provider";
import { SavedTunnel, TUNNEL_TOKEN } from "./saved-tunnel";

const ps = new FakePs();
const access = { issuer: "https://team.cloudflareaccess.com", aud: "app-aud" };

describe("tunnelConfig", () => {
	it("is null with no host, and names the host and tunnel given", () => {
		expect(tunnelConfig("", "", null, null, ps)).toBeNull();
		const config = tunnelConfig(" Arbor.Example.com ", "", access, null, ps);
		expect(config?.host).toBe("arbor.example.com");
		expect(config?.provider).toBeInstanceOf(CloudflaredTunnelProvider);
	});

	it("takes the provider arbor.config.ts names over cloudflared", () => {
		const custom = new FakeTunnelProvider();
		expect(
			tunnelConfig("arbor.example.com", "", access, custom, ps)?.provider,
		).toBe(custom);
	});

	it("refuses a tunnel without Access, a name alone or with a custom provider, or a bad host", () => {
		const refused = (host: string, name: string, enabled = access) =>
			expect(() => tunnelConfig(host, name, enabled, null, ps)).toThrow(Exit);
		refused("arbor.example.com", "", null as never);
		refused("", "mine");
		refused("https://arbor.example.com/", "");
		expect(() =>
			tunnelConfig(
				"arbor.example.com",
				"mine",
				access,
				new FakeTunnelProvider(),
				ps,
			),
		).toThrow(Exit);
	});
});

describe("startTunnel", () => {
	const host = "arbor.example.com";

	it("runs the provider at the url and stops it when disposed", async () => {
		const provider = new FakeTunnelProvider();
		const run = await startTunnel(
			{ host, provider },
			"http://localhost:4269",
			new MemoryLogger(),
		);
		await run?.disposeAsync();

		expect(provider.getCalls()).toEqual([
			`run ${host} http://localhost:4269`,
			`stop ${host}`,
		]);
	});

	it("logs a provider that is not ready, and runs nothing", async () => {
		const provider = new FakeTunnelProvider();
		provider.notReady("nope is not installed");
		const log = new MemoryLogger();

		const run = await startTunnel({ host, provider }, "http://x", log);

		expect(run).toBeNull();
		expect(provider.getCalls()).toEqual([]);
		expect(JSON.stringify(log.entries)).toContain("nope is not installed");
	});
});

describe("CloudflaredTunnelProvider", () => {
	it("runs cloudflared at the url, says once where it is up, and stops on dispose", async () => {
		const ps = new FakePs();
		const log = new MemoryLogger();
		const run = new CloudflaredTunnelProvider(ps, "mine").run({
			host: "arbor.example.com",
			url: "http://localhost:4269",
			log,
		});
		const [child] = ps.getChildren();

		expect(ps.getCalls()).toEqual([
			"cloudflared tunnel --no-autoupdate run --url http://localhost:4269 mine",
		]);
		child?.printError(
			[0, 1, 2, 3]
				.map((index) => `INF Registered tunnel connection connIndex=${index}\n`)
				.join(""),
		);
		await Bun.sleep(10);
		await run.disposeAsync();

		expect(child?.signals).toEqual(["SIGTERM"]);
		expect(log.entries).toEqual([
			expect.objectContaining({
				message: "arbor dev reachable at https://arbor.example.com",
			}),
		]);
	});

	it("hands a token over in the environment, never the argv", async () => {
		const ps = new FakePs();
		const run = new CloudflaredTunnelProvider(ps, null, "secret").run({
			host: "arbor.example.com",
			url: "http://localhost:4270",
			log: new MemoryLogger(),
		});
		await run.disposeAsync();

		expect(ps.getCalls()).toEqual([
			"cloudflared tunnel --no-autoupdate run --url http://localhost:4270",
		]);
		expect(ps.getCallEnvs()).toEqual([{ TUNNEL_TOKEN: "secret" }]);
	});
});

describe("savedTunnelConfig", () => {
	const record = {
		host: "arbor.example.com",
		team: "team",
		aud: "app-aud",
		tunnel: "tunnel-id",
	};

	it("is null with nothing saved, and runs what was saved with its token", async () => {
		const store = new FakeSecretStore();
		const saved = new SavedTunnel("/home/.arbor/tunnel.json", {
			fs: new FakeFs(),
			store,
		});
		expect(await savedTunnelConfig(saved, ps, new MemoryLogger())).toBeNull();

		await saved.save(record);
		await store.set(TUNNEL_TOKEN, "secret");
		const config = await savedTunnelConfig(saved, ps, new MemoryLogger());

		expect(config?.access).toEqual(access);
		expect(config?.tunnel.host).toBe("arbor.example.com");
		expect(config?.tunnel.provider).toBeInstanceOf(CloudflaredTunnelProvider);
	});

	it("logs a saved tunnel whose token is gone, and runs none", async () => {
		const store = new FakeSecretStore();
		const saved = new SavedTunnel("/home/.arbor/tunnel.json", {
			fs: new FakeFs(),
			store,
		});
		await saved.save(record);
		const log = new MemoryLogger();

		expect(await savedTunnelConfig(saved, ps, log)).toBeNull();
		expect(JSON.stringify(log.entries)).toContain(
			"run `arbor tunnel setup` again",
		);
	});
});
