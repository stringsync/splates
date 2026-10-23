import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
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

	it("says there is no server to ask when none can be", async () => {
		machine.workers = undefined;
		expect((await steps())["local-worker"]?.problem).toContain(
			"no `splates server`",
		);
	});

	it("plans removing this Mac's worker", async () => {
		listed = [LOCAL, { ...LOCAL, id: "box", kind: "registered" }];

		const plan = await new Setup(machine, [
			REMOTE_ACCESS_AREA,
			WORKERS_AREA,
		]).undoPlan("workers");

		expect(
			Object.fromEntries(plan.steps.map((step) => [step.id, step.removes])),
		).toEqual({
			"local-worker": [
				"This Mac's worker, `local`, its agents running to their end first",
			],
		});
		expect(plan.refused).toBeNull();
	});

	it("refuses with no server to remove workers from", async () => {
		machine.removeWorker = undefined;
		listed = [LOCAL];

		expect(await undoOf("local-worker")?.refused?.(machine)).toContain(
			"No `splates server` to remove workers from",
		);
	});
});
