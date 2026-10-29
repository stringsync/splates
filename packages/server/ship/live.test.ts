import { describe, expect, it } from "bun:test";
import { FakePs } from "webappwiz/system/testing";
import type { Config } from "../config";
import { REGISTRY_DEADLINE, ShipLive } from "./live";
import { LiveRegistryHttp } from "./live-registry-http";
import { ShipRegistry } from "./registry";

const project = {
	root: "/project",
	version: "1.2.3",
	packages: ["@example/core", "@example/cli"],
};

describe("ShipLive", () => {
	it("runs the status command through the shell in the main tree and includes non-npm artifacts", async () => {
		const ps = new FakePs();
		ps.setCaptureOutput(
			JSON.stringify({
				version: "1.2.4",
				artifacts: [
					{ name: "@example/core", deployed: "1.2.3" },
					{ name: "git", deployed: null },
				],
			}),
			"",
		);
		const live = new ShipLive(ps, {
			configs: new LiveConfig("fake status --json"),
		});
		expect(await live.check(project, "1.2.3")).toEqual({
			version: "1.2.4",
			artifacts: [
				{ name: "@example/core", deployed: "1.2.3" },
				{ name: "git", deployed: null },
			],
			live: false,
			lagging: [{ name: "git", deployed: null }],
		});
		expect(ps.getCalls()).toEqual(["sh -c fake status --json"]);
		expect(ps.getCallDirs()).toEqual(["/project"]);
	});

	it("requires every artifact to match the requested version, rather than the local version", async () => {
		const ps = new FakePs();
		ps.setCaptureOutput(
			JSON.stringify({
				version: "9.0.0",
				artifacts: [
					{ name: "npm", deployed: "1.2.3" },
					{ name: "git", deployed: "1.2.3" },
				],
			}),
			"",
		);
		const live = new ShipLive(ps, { configs: new LiveConfig("status") });
		expect(await live.check(project, "1.2.3")).toMatchObject({
			live: true,
			lagging: [],
		});
		expect(await live.check(project, "1.2.4")).toMatchObject({
			live: false,
			lagging: [
				{ name: "npm", deployed: "1.2.3" },
				{ name: "git", deployed: "1.2.3" },
			],
		});
		expect(REGISTRY_DEADLINE.ms).toBe(30 * 60 * 1000);
	});

	it.each([
		"not JSON",
		"{}",
		'{"version":"1.2.3","artifacts":[]}',
		'{"version":"1.2.3","artifacts":[{"name":"npm"}]}',
		'{"version":"1.2.3","artifacts":[{"name":"npm","deployed":42}]}',
		'{"version":"1.2.3","artifacts":[{"name":" ","deployed":null}]}',
		'{"version":"1.2.3","artifacts":[{"name":"npm","deployed":null},{"name":"npm","deployed":null}]}',
	])("rejects invalid status evidence: %s", async (output) => {
		const ps = new FakePs();
		ps.setCaptureOutput(output, "");
		const live = new ShipLive(ps, { configs: new LiveConfig("status") });
		await expect(live.read(project)).rejects.toThrow("invalid shipStatus JSON");
	});

	it("surfaces command failure and reads again on retry", async () => {
		const ps = new FakePs();
		ps.simulate(async () => 1);
		ps.setCaptureOutput("", "provider unavailable");
		const live = new ShipLive(ps, { configs: new LiveConfig("status") });
		await expect(live.check(project, "1.2.3")).rejects.toThrow(
			"shipStatus exited 1: provider unavailable",
		);
		ps.simulate(async () => 0);
		ps.setCaptureOutput(
			'{"version":"1.2.3","artifacts":[{"name":"git","deployed":"1.2.3"}]}',
			"",
		);
		expect(await live.check(project, "1.2.3")).toMatchObject({ live: true });
	});

	it("reads latest for every graph package, retaining absent releases and lagging versions", async () => {
		const http = new LiveRegistryHttp();
		const ps = new FakePs();
		const live = new ShipLive(ps, {
			configs: new LiveConfig(null),
			registry: new ShipRegistry(http),
		});
		expect(await live.check(project, "1.2.3")).toEqual({
			version: "1.2.3",
			live: false,
			artifacts: [
				{ name: "@example/core", deployed: "1.2.2" },
				{ name: "@example/cli", deployed: null },
			],
			lagging: [
				{ name: "@example/core", deployed: "1.2.2" },
				{ name: "@example/cli", deployed: null },
			],
		});
		expect(http.urls).toEqual([
			"https://registry.npmjs.org/%40example%2Fcore/latest",
			"https://registry.npmjs.org/%40example%2Fcli/latest",
		]);
		expect(ps.getCalls()).toEqual([]);
	});

	it("does not claim a project with no status artifacts is live", async () => {
		const live = new ShipLive(new FakePs(), {
			configs: new LiveConfig(undefined),
		});
		await expect(
			live.check({ ...project, packages: [] }, "1.2.3"),
		).rejects.toThrow("no public packages");
	});
});

class LiveConfig {
	constructor(private readonly command: string | null | undefined) {}
	async read(): Promise<Partial<Config>> {
		return this.command === undefined ? {} : { shipStatus: this.command };
	}
}
