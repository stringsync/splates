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

	it("offers the Docker login on a terminal and goes on once it has run", async () => {
		ps.setColumns(80);
		await fs.write(
			"/home/me/.docker/config.json",
			JSON.stringify({ auths: {} }),
		);
		// The gh check is the first spawn and the login the second.
		const configs = [
			JSON.stringify({ auths: {} }),
			JSON.stringify({ auths: { "ghcr.io": {} } }),
		];
		let spawns = 0;
		ps.simulate(async () => {
			await fs.write("/home/me/.docker/config.json", configs[spawns++] ?? "");
			return 0;
		});
		await preflight(ps, fs);
		expect(ps.getCalls()).toEqual(["gh auth status", "docker login ghcr.io"]);
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
