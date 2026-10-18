import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import type { SpawnOptions } from "webappwiz/system";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { HCLOUD_TOKEN, PULUMI_PASSPHRASE, pulumiPaths } from "../workers";
import { FakeWorkerProvider } from "../workers/testing";
import { REMOTE_ACCESS_AREA } from "./area-remote";
import { WORKERS_AREA } from "./area-workers";
import { Setup, type SetupMachine } from "./setup";

const HOME = "/home/.splates";
const PATHS = pulumiPaths(HOME);
const CLOUD_STEPS = ["pulumi-install", "pulumi-state"];

/** A machine where the install script puts `pulumi` in place, and `pulumi` answers once it is. */
class PulumiPs extends FakePs {
	installed = false;
	install = 0;

	override async spawnCapture(argv: string[], opts?: SpawnOptions) {
		await super.spawnCapture(argv, opts);
		if (argv[0] === "sh") {
			this.installed = this.install === 0;
			return { exitCode: this.install, stdout: "", stderr: "curl: (6)\n" };
		}
		const ok = argv[0] === PATHS.bin && this.installed;
		return { exitCode: ok ? 0 : 127, stdout: ok ? "me\n" : "", stderr: "" };
	}
}

describe("WORKERS_AREA's cloud worker steps", () => {
	let machine: SetupMachine;
	let ps: PulumiPs;
	let tokenStatus: number;
	let provider: FakeWorkerProvider | null;

	beforeEach(async () => {
		ps = new PulumiPs();
		machine = {
			fs: new FakeFs(),
			ps,
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

	async function statuses() {
		const progress = await setup().read();
		return Object.fromEntries(
			(progress.areas[1]?.steps ?? [])
				.filter((step) => CLOUD_STEPS.includes(step.id))
				.map((step) => [step.id, step.status]),
		);
	}

	it("installs Pulumi under splates's home, then keeps its state there with a passphrase", async () => {
		const roster = setup();
		expect(await statuses()).toEqual({
			"pulumi-install": "ready",
			"pulumi-state": "waiting",
		});

		await roster.submit("pulumi-install", {});
		expect(ps.getCalls()[0]).toContain(PATHS.root);
		expect(await statuses()).toEqual({
			"pulumi-install": "done",
			"pulumi-state": "ready",
		});

		await roster.submit("pulumi-state", {});
		expect(await machine.fs.exists(PATHS.state)).toBe(true);
		expect(await machine.device.get(PULUMI_PASSPHRASE)).toHaveLength(43);
		expect(ps.getCallEnvs().at(-1)).toMatchObject({
			PULUMI_HOME: PATHS.home,
			PULUMI_BACKEND_URL: `file://${PATHS.state}`,
		});
		expect(await statuses()).toEqual({
			"pulumi-install": "done",
			"pulumi-state": "done",
		});
	});

	it("says why an install failed", async () => {
		ps.install = 6;
		await expect(setup().submit("pulumi-install", {})).rejects.toThrow(
			"Pulumi did not install: curl: (6)",
		);
	});

	it("never replaces a passphrase already kept, which encrypts state written with it", async () => {
		ps.installed = true;
		await machine.device.set(PULUMI_PASSPHRASE, "kept");

		await setup().submit("pulumi-state", {});

		expect(await machine.device.get(PULUMI_PASSPHRASE)).toBe("kept");
	});

	it("takes a Hetzner token only once Hetzner accepts it", async () => {
		const status = async () =>
			(await setup().read()).areas[1]?.steps.find(
				(step) => step.id === "hetzner-token",
			)?.status;
		expect(await status()).toBe("ready");

		await machine.device.set(HCLOUD_TOKEN, "token");
		tokenStatus = 401;
		expect(await status()).toBe("ready");
		await expect(setup().submit("hetzner-token", {})).rejects.toThrow(
			"Hetzner does not take that token",
		);

		tokenStatus = 200;
		expect(await status()).toBe("done");
	});

	it("turns cloud workers on once the project names a provider, then builds the snapshot through it", async () => {
		ps.installed = true;
		await machine.device.set(HCLOUD_TOKEN, "token");
		await setup().submit("pulumi-state", {});
		await expect(setup().submit("hetzner-provider", {})).rejects.toThrow(
			"names no `workerProvider` yet",
		);

		provider = new FakeWorkerProvider();
		await setup().submit("hetzner-provider", {});
		await setup().submit("worker-snapshot", {});

		expect(provider.getCalls()).toEqual([
			expect.stringMatching(/^snapshot linux /),
		]);
		expect(await machine.fs.read(`${HOME}/snapshots.json`)).toContain("snap-1");
	});
});
