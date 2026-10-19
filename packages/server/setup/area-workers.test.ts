import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { API_TOKEN, SavedTunnel } from "../tunnel";
import { REMOTE_ACCESS_AREA } from "./area-remote";
import { WORKERS_AREA } from "./area-workers";
import { Setup, type SetupMachine, type SetupWorker } from "./setup";

const HOME = "/home/.splates";

const LOCAL: SetupWorker = {
	id: "local",
	kind: "local",
	draining: false,
	removing: false,
	host: null,
	wokenAt: null,
};

describe("WORKERS_AREA", () => {
	let machine: SetupMachine;
	let listed: SetupWorker[];
	let status: number;
	let removed: string[];

	beforeEach(async () => {
		listed = [];
		status = 200;
		removed = [];
		machine = {
			fs: new FakeFs(),
			home: HOME,
			device: new FakeSecretStore(),
			workers: async () => listed,
			fetch: (async (url: string) => {
				const path = new URL(url).pathname;
				const result = path.endsWith("/zones")
					? [{ id: "z", name: "example.com", account: { id: "acct" } }]
					: [];
				return Response.json(
					status === 200
						? { success: true, errors: [], result }
						: { success: false, errors: [{ message: "no" }], result: null },
					{ status },
				);
			}) as unknown as typeof fetch,
			removeWorker: async (id) => {
				removed.push(id);
				listed = listed.filter((worker) => worker.id !== id);
			},
		};
		await machine.fs.mkdir(HOME, { recursive: true });
	});

	async function steps() {
		const progress = await new Setup(machine, [
			REMOTE_ACCESS_AREA,
			WORKERS_AREA,
		]).read();
		return Object.fromEntries(
			(progress.areas[1]?.steps ?? []).map((step) => [step.id, step]),
		);
	}

	function undoOf(id: string) {
		return WORKERS_AREA.steps.find((step) => step.id === id)?.undo;
	}

	it("is done for this Mac once its worker is listed and takes agents", async () => {
		expect((await steps())["local-worker"]?.status).toBe("ready");

		listed = [{ ...LOCAL, draining: true }];
		expect((await steps())["local-worker"]?.status).toBe("ready");

		listed = [LOCAL];
		expect((await steps())["local-worker"]?.status).toBe("done");
	});

	it("is done for another machine once a registered worker is listed", async () => {
		listed = [LOCAL];
		expect((await steps())["remote-worker"]?.status).toBe("ready");

		listed = [LOCAL, { ...LOCAL, id: "box", kind: "registered" }];
		expect((await steps())["remote-worker"]?.status).toBe("done");
	});

	it("is done for a Windows machine once a worker under WSL2 is listed", async () => {
		listed = [LOCAL, { ...LOCAL, id: "box", kind: "registered" }];
		expect((await steps())["windows-worker"]?.status).toBe("ready");

		listed = [LOCAL, { ...LOCAL, id: "pc", kind: "registered", host: "wsl2" }];
		expect((await steps())["windows-worker"]?.status).toBe("done");
	});

	it("is done for Wake-on-LAN once a Windows worker has joined after being woken", async () => {
		const pc = {
			...LOCAL,
			id: "pc",
			kind: "registered" as const,
			host: "wsl2",
		};
		listed = [LOCAL, pc];
		expect((await steps())["wake-on-lan"]?.status).toBe("ready");

		listed = [LOCAL, { ...pc, wokenAt: 1 }];
		expect((await steps())["wake-on-lan"]?.status).toBe("done");
	});

	it("says there is no server to ask when none can be", async () => {
		machine.workers = undefined;
		expect((await steps())["local-worker"]?.problem).toContain(
			"no `splates server`",
		);
	});

	it("plans removing this Mac's worker and each machine joined, leaving their installs", async () => {
		const pc = {
			...LOCAL,
			id: "pc",
			kind: "registered" as const,
			host: "wsl2",
		};
		listed = [
			LOCAL,
			{ ...LOCAL, id: "box", kind: "registered" },
			{ ...pc, wokenAt: 1 },
		];

		const plan = await new Setup(machine, [
			REMOTE_ACCESS_AREA,
			WORKERS_AREA,
		]).undoPlan("workers");

		expect(
			Object.fromEntries(plan.steps.map((step) => [step.id, step.removes])),
		).toEqual({
			"wake-on-lan": [],
			"windows-worker": [
				"The Windows worker `pc`, its key revoked, its agents running to their end first",
			],
			"remote-worker": [
				"The worker `box`, its key revoked, its agents running to their end first",
			],
			"local-worker": [
				"This Mac's worker, `local`, its agents running to their end first",
			],
		});
		const leaves = plan.steps.find(
			(step) => step.id === "windows-worker",
		)?.leaves;
		expect(leaves?.[0]).toContain(
			"Unregister-ScheduledTask -TaskName 'splates worker'",
		);
		expect(leaves?.[0]).toContain("wsl --unregister splates");
		expect(plan.refused).toBeNull();
	});

	it("removes each worker once, so every step reads not done", async () => {
		const pc = {
			...LOCAL,
			id: "pc",
			kind: "registered" as const,
			host: "wsl2",
		};
		listed = [LOCAL, { ...LOCAL, id: "box", kind: "registered" }, pc];

		await new Setup(machine, [REMOTE_ACCESS_AREA, WORKERS_AREA]).undo(
			"workers",
			null,
		);
		await undoOf("remote-worker")?.run(machine);

		expect(removed).toEqual(["pc", "box", "local"]);
		const read = await steps();
		expect(read["local-worker"]?.status).toBe("ready");
		expect(read["remote-worker"]?.status).toBe("ready");
		expect(read["windows-worker"]?.status).toBe("ready");
	});

	it("passes over a worker being removed already", async () => {
		listed = [{ ...LOCAL, id: "box", kind: "registered", removing: true }];

		await undoOf("remote-worker")?.run(machine);

		expect(removed).toEqual([]);
	});

	it("refuses with no server to remove workers from", async () => {
		machine.removeWorker = undefined;
		listed = [LOCAL];

		expect(await undoOf("local-worker")?.refused?.(machine)).toContain(
			"No `splates server` to remove workers from",
		);
	});

	it("waits for the tunnel, then checks the API token may manage service tokens", async () => {
		expect((await steps())["worker-access"]?.status).toBe("waiting");

		await new SavedTunnel(`${HOME}/tunnel.json`, {
			fs: machine.fs,
			store: machine.device,
		}).save({
			host: "splates.example.com",
			team: "crew",
			aud: "a",
			tunnel: "i",
		});
		await machine.device.set("SPLATES_TUNNEL_TOKEN", "t");
		await machine.device.set(API_TOKEN, "api");
		expect((await steps())["worker-access"]?.status).toBe("done");

		status = 403;
		expect((await steps())["worker-access"]?.status).toBe("ready");
	});
});
