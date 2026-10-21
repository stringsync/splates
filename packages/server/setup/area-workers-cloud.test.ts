import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { FakeAws } from "../cloud/testing";
import { FakeWorkerProvider } from "../workers/testing";
import { REMOTE_ACCESS_AREA } from "./area-remote";
import { WORKERS_AREA } from "./area-workers";
import { Setup, type SetupMachine } from "./setup";

const HOME = "/home/.splates";

describe("WORKERS_AREA's cloud worker steps", () => {
	let aws: FakeAws;
	let ps: FakePs;
	let machine: SetupMachine;
	let provider: FakeWorkerProvider | null;

	beforeEach(async () => {
		aws = new FakeAws();
		ps = new FakePs();
		ps.setEnv({
			AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
			AWS_SECRET_ACCESS_KEY: "secret",
		});
		machine = {
			fs: new FakeFs(),
			ps,
			home: HOME,
			device: new FakeSecretStore(),
			fetch: aws.fetch,
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
		provider = null;
		await machine.fs.mkdir(HOME, { recursive: true });
	});

	function setup() {
		return new Setup(machine, [REMOTE_ACCESS_AREA, WORKERS_AREA]);
	}

	it("turns cloud workers on once the project names a provider, then builds the snapshot through it", async () => {
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

	it("leaves the config to edit once undone", async () => {
		provider = new FakeWorkerProvider();

		const plan = await setup().undoPlan("workers");

		expect(plan.steps.map((step) => step.id)).toEqual(["cloud-provider"]);
		expect(plan.steps[0]?.leaves[0]).toContain("`cloud` in this project's");
		expect(plan.creds).toEqual([]);
	});

	it("deletes the kept snapshot in the cloud and forgets it", async () => {
		aws.images.set("ami-7", {
			id: "ami-7",
			owner: aws.account,
			name: "splates-worker",
			state: "available",
			tags: {},
			snapshotId: "snap-7",
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		await machine.fs.write(
			`${HOME}/snapshots.json`,
			JSON.stringify({ linux: { id: "ami-7", version: "1.0.0", builtAt: 0 } }),
		);
		const snapshot = WORKERS_AREA.steps.find(
			(step) => step.id === "worker-snapshot",
		);

		expect(await snapshot?.undo?.removes(machine)).toEqual([
			"The worker snapshot `ami-7` in AWS, of splates 1.0.0",
		]);
		await snapshot?.undo?.run(machine);
		await snapshot?.undo?.run(machine);

		expect(aws.images.has("ami-7")).toBe(false);
		expect(await snapshot?.check(machine)).toBe(false);
		expect(await snapshot?.undo?.removes(machine)).toEqual([]);
	});
});
