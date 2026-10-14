import { describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakePs } from "webappwiz/system/testing";
import { CloudflaredTunnelProvider } from "./cloudflared-tunnel-provider";
import { startTunnel, tunnelConfig } from "./dev-tunnel";
import { Exit } from "./exit";
import { FakeTunnelProvider } from "./fake-tunnel-provider";

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
	it("runs cloudflared at the url, says where it is up, and stops on dispose", async () => {
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
		child?.printError("INF Registered tunnel connection connIndex=0\n");
		await Bun.sleep(10);
		await run.disposeAsync();

		expect(child?.signals).toEqual(["SIGTERM"]);
		expect(JSON.stringify(log.entries)).toContain("https://arbor.example.com");
	});
});
