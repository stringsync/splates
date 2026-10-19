import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { WorkerBudget } from "../workers";
import { FakeWorkerProvider } from "../workers/fake-provider";
import { REMOTE_ACCESS_AREA } from "./area-remote";
import { WORKERS_AREA } from "./area-workers";
import { Setup, type SetupMachine } from "./setup";

const ROSTER = [REMOTE_ACCESS_AREA, WORKERS_AREA];

describe("the worker budget step", () => {
	let machine: SetupMachine;
	let budget: WorkerBudget;

	beforeEach(() => {
		budget = WorkerBudget.memory();
		machine = {
			fs: new FakeFs(),
			home: "/home/.splates",
			device: new FakeSecretStore(),
			workerBudget: {
				report: async () => ({
					standing: budget.standing(),
					reviewed: budget.reviewed,
				}),
				set: (limit, dollars) => budget.set(limit, dollars),
			},
			project: {
				root: "/repo",
				config: async () => ({
					trunk: "main",
					remote: null,
					workerProvider: new FakeWorkerProvider(),
				}),
				remoteUrl: async () => null,
			},
		};
	});

	async function step() {
		const read = await new Setup(machine, ROSTER).read();
		return read.areas[1]?.steps.find((each) => each.id === "worker-budget");
	}

	it("is not listed without a workerProvider", async () => {
		machine.project = {
			root: "/repo",
			config: async () => ({
				trunk: "main",
				remote: null,
				workerProvider: null,
			}),
			remoteUrl: async () => null,
		};
		expect(await step()).toBeUndefined();
	});

	it("names the cheapest type, and waits for the user to choose", async () => {
		const found = await step();
		expect(found?.status).toBe("ready");
		expect(found?.detail).toContain("`small`");
		expect(found?.detail).toContain("$0.05");
	});

	it("is done once the user submits, empty fields keeping what they were", async () => {
		await new Setup(machine, ROSTER).submit("worker-budget", {
			hour: "",
			day: "$8",
			month: "",
		});

		const day = budget.standing().find((each) => each.limit === "day");
		const hour = budget.standing().find((each) => each.limit === "hour");
		expect(day?.dollars).toBe(8);
		expect(hour?.dollars).toBe(0.25);
		expect((await step())?.status).toBe("done");
	});

	it("refuses what is not dollars", async () => {
		await expect(
			new Setup(machine, ROSTER).submit("worker-budget", {
				hour: "lots",
				day: "",
				month: "",
			}),
		).rejects.toThrow("dollars");
		expect(budget.reviewed).toBe(false);
	});
});
