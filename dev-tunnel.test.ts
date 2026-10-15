import { describe, expect, it } from "bun:test";
import { FakePs } from "webappwiz/system/testing";
import { CloudflaredTunnelProvider } from "./cloudflared-tunnel-provider";
import { tunnelConfig } from "./dev-tunnel";
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
