import { describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakePs } from "webappwiz/system/testing";
import { Tunnel, tunnelConfig } from "./dev-tunnel";
import { Exit } from "./exit";

const access = { issuer: "https://team.cloudflareaccess.com", aud: "app-aud" };

describe("tunnelConfig", () => {
	it("is null with no host, and names the host and tunnel given", () => {
		expect(tunnelConfig("", "", null)).toBeNull();
		expect(tunnelConfig(" Arbor.Example.com ", "", access)).toEqual({
			host: "arbor.example.com",
			name: null,
		});
		expect(tunnelConfig("arbor.example.com", "mine", access)?.name).toBe(
			"mine",
		);
	});

	it("refuses a tunnel without Access, a tunnel name alone, or a bad host", () => {
		expect(() => tunnelConfig("arbor.example.com", "", null)).toThrow(Exit);
		expect(() => tunnelConfig("", "mine", access)).toThrow(Exit);
		expect(() =>
			tunnelConfig("https://arbor.example.com/", "", access),
		).toThrow(Exit);
	});
});

describe("Tunnel", () => {
	const config = { host: "arbor.example.com", name: "mine" };

	it("runs cloudflared at the port, says where it is up, and stops with the server", async () => {
		const ps = new FakePs();
		const log = new MemoryLogger();
		const tunnel = Tunnel.start(ps, log, config, 4269);
		const [child] = ps.getChildren();

		expect(ps.getCalls()).toEqual([
			"cloudflared tunnel --no-autoupdate run --url http://localhost:4269 mine",
		]);
		child?.printError("INF Registered tunnel connection connIndex=0\n");
		await Bun.sleep(10);
		await tunnel.disposeAsync();

		expect(child?.signals).toEqual(["SIGTERM"]);
		expect(JSON.stringify(log.entries ?? log)).toContain(
			"https://arbor.example.com",
		);
	});
});
