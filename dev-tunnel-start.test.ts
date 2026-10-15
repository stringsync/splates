import { describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { startTunnel } from "./dev-tunnel";
import { FakeTunnelProvider } from "./fake-tunnel-provider";

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
