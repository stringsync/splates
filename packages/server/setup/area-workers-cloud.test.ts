import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { ChosenCloud, HCLOUD_TOKEN } from "../cloud";
import { FakeHetzner } from "../cloud/testing";
import { FakeWorkerProvider } from "../workers/testing";
import { REMOTE_ACCESS_AREA } from "./area-remote";
import { WORKERS_AREA } from "./area-workers";
import { Setup, type SetupMachine } from "./setup";

const HOME = "/home/.splates";

describe("WORKERS_AREA's cloud worker steps", () => {
	let machine: SetupMachine;
	let tokenStatus: number;
	let provider: FakeWorkerProvider | null;

	beforeEach(async () => {
		machine = {
			fs: new FakeFs(),
			home: HOME,
			device: new FakeSecretStore(),
			fetch: (async () =>
				Response.json(
					{ servers: [] },
					{ status: tokenStatus },
				)) as unknown as typeof fetch,
			project: {
				root: "/repo",
				config: async () => ({
					trunk: "main",
					remote: null,
					workerProvider: provider,
				}),
				remoteUrl: async () => null,
			},
		};
		tokenStatus = 200;
		provider = null;
		await machine.fs.mkdir(HOME, { recursive: true });
	});

	function setup() {
		return new Setup(machine, [REMOTE_ACCESS_AREA, WORKERS_AREA]);
	}

	it("offers each cloud provider, and keeps the one picked", async () => {
		const choice = async () =>
			(await setup().read()).areas[1]?.steps.find(
				(step) => step.id === "cloud-choice",
			);
		expect((await choice())?.status).toBe("ready");
		expect((await choice())?.fields).toEqual([
			{
				kind: "choice",
				name: "cloud",
				label: "Cloud provider",
				options: [
					{ value: "digitalocean", label: "DigitalOcean" },
					{ value: "hetzner", label: "Hetzner Cloud" },
				],
			},
		]);
		await expect(
			setup().submit("cloud-choice", { cloud: "aws" }),
		).rejects.toThrow("Pick one of the choices");

		await setup().submit("cloud-choice", { cloud: "hetzner" });

		expect((await choice())?.status).toBe("done");
		expect(await new ChosenCloud(HOME, machine.fs).read()).toBe("hetzner");
	});

	it("takes the cloud's token only once the cloud accepts it", async () => {
		const status = async () =>
			(await setup().read()).areas[1]?.steps.find(
				(step) => step.id === "cloud-token",
			)?.status;
		expect(await status()).toBe("waiting");
		await setup().submit("cloud-choice", { cloud: "hetzner" });
		expect(await status()).toBe("ready");

		await machine.device.set(HCLOUD_TOKEN, "token");
		tokenStatus = 401;
		expect(await status()).toBe("ready");
		await expect(setup().submit("cloud-token", {})).rejects.toThrow(
			"Hetzner does not take that token",
		);

		tokenStatus = 200;
		expect(await status()).toBe("done");
	});

	it("turns cloud workers on once the project names a provider, then builds the snapshot through it", async () => {
		await new ChosenCloud(HOME, machine.fs).choose("hetzner");
		await machine.device.set(HCLOUD_TOKEN, "token");
		await expect(setup().submit("cloud-provider", {})).rejects.toThrow(
			"names no `cloud` yet",
		);

		provider = new FakeWorkerProvider();
		await setup().submit("cloud-provider", {});
		await setup().submit("worker-snapshot", {});

		expect(provider.getCalls()).toEqual([
			expect.stringMatching(/^snapshot linux /),
		]);
		expect(await machine.fs.read(`${HOME}/snapshots.json`)).toContain("snap-1");
	});

	it("forgets the cloud chosen and its token once undone, leaving the token to revoke and the config to edit", async () => {
		await machine.device.set(HCLOUD_TOKEN, "token");
		provider = new FakeWorkerProvider();
		await setup().submit("cloud-choice", { cloud: "hetzner" });

		const plan = await setup().undoPlan("workers");

		expect(plan.steps.map((step) => step.id)).toEqual([
			"cloud-provider",
			"cloud-token",
			"cloud-choice",
		]);
		expect(plan.steps[0]?.leaves[0]).toContain("`cloud` in this project's");
		expect(plan.steps[1]?.leaves[0]).toContain("revoke it");
		expect(plan.steps[2]?.removes).toEqual([
			"The cloud provider chosen, kept in `~/.splates/cloud.json`",
		]);
		expect(plan.creds).toEqual([{ name: HCLOUD_TOKEN, keptFor: null }]);

		await setup().undo("workers", null);
		await setup().undo("workers", null);

		expect(await new ChosenCloud(HOME, machine.fs).read()).toBeNull();
		expect(await machine.device.get(HCLOUD_TOKEN)).toBeUndefined();
	});

	it("deletes the kept snapshot in the cloud and forgets it", async () => {
		const hetzner = new FakeHetzner();
		hetzner.images.set(7, { id: 7, labels: {} });
		machine.fetch = hetzner.fetch;
		await machine.device.set(HCLOUD_TOKEN, "token");
		await machine.fs.write(
			`${HOME}/snapshots.json`,
			JSON.stringify({ linux: { id: "7", version: "1.0.0", builtAt: 0 } }),
		);
		const snapshot = WORKERS_AREA.steps.find(
			(step) => step.id === "worker-snapshot",
		);

		expect(await snapshot?.undo?.removes(machine)).toEqual([
			"The worker snapshot `7` in Hetzner Cloud, of splates 1.0.0",
		]);
		await snapshot?.undo?.run(machine);
		await snapshot?.undo?.run(machine);

		expect(hetzner.images.size).toBe(0);
		expect(await snapshot?.check(machine)).toBe(false);
		expect(await snapshot?.undo?.removes(machine)).toEqual([]);
	});
});
