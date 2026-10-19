import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { ChosenCloud, HCLOUD_TOKEN } from "../cloud";
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
				groomer: async () => null,
				setGroomer: async () => {},
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
				options: [{ value: "hetzner", label: "Hetzner Cloud" }],
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
});
