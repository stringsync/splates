import { beforeEach, describe, expect, it } from "bun:test";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { preflight } from "./ship-preflight";

describe("the ship preflight", () => {
	let ps: FakePs;
	let fs: FakeFs;

	beforeEach(() => {
		ps = new FakePs();
		fs = new FakeFs();
		ps.setEnv({ HOME: "/home/me" });
	});

	// Spawn number `count` (counting from 1) leaves a ghcr.io login behind, as a
	// docker login does; the spawns before it leave none.
	function logsInAtSpawn(count: number): void {
		let spawns = 0;
		ps.simulate(async () => {
			spawns += 1;
			const auths = spawns >= count ? { "ghcr.io": {} } : {};
			await fs.write("/home/me/.docker/config.json", JSON.stringify({ auths }));
			return 0;
		});
	}

	it("passes with a gh login and an inline ghcr.io login", async () => {
		await fs.write(
			"/home/me/.docker/config.json",
			JSON.stringify({ auths: { "ghcr.io": {} } }),
		);
		await preflight(ps, fs);
		expect(ps.getCalls()).toEqual(["gh auth status"]);
	});

	it("passes when the credential helper holds a ghcr.io login", async () => {
		await fs.write(
			"/home/me/.docker/config.json",
			JSON.stringify({ credsStore: "desktop" }),
		);
		ps.setCaptureOutput('{"https://ghcr.io":"me"}', "");
		await preflight(ps, fs);
		expect(ps.getCalls()).toEqual([
			"gh auth status",
			"docker-credential-desktop list",
		]);
	});

	it("stops when the credential helper has no ghcr.io login", async () => {
		await fs.write(
			"/home/me/.docker/config.json",
			JSON.stringify({ credsStore: "desktop" }),
		);
		ps.setCaptureOutput('{"https://index.docker.io/v1/":"me"}', "");
		await expect(preflight(ps, fs)).rejects.toThrow("docker login ghcr.io");
	});

	it("stops without a terminal when Docker has no config", async () => {
		await expect(preflight(ps, fs)).rejects.toThrow("docker login ghcr.io");
		expect(ps.getCalls()).toEqual(["gh auth status"]);
	});

	it("logs Docker in through gh on a terminal, the token on stdin", async () => {
		ps.setColumns(80);
		ps.setCaptureOutput("me\n", "");
		logsInAtSpawn(5);
		await preflight(ps, fs);
		expect(ps.getCalls()).toEqual([
			"gh auth status",
			"gh auth refresh --hostname github.com --scopes write:packages",
			"gh api user --jq .login",
			"gh auth token",
			"docker login ghcr.io --username me --password-stdin",
		]);
	});

	it("stops when the offered login leaves Docker logged out", async () => {
		ps.setColumns(80);
		await expect(preflight(ps, fs)).rejects.toThrow("did not log in");
	});

	it("stops without a terminal when gh is not logged in", async () => {
		ps.simulate(async () => 1);
		await expect(preflight(ps, fs)).rejects.toThrow("gh auth login");
	});
});
