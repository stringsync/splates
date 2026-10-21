import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { CloudWorkers, DIGITALOCEAN_TOKEN, DigitalOceanCloud } from "../cloud";
import { FakeDigitalOcean } from "../cloud/testing";
import type { Config } from "../config";
import { WorkerBudget, WorkerRecords } from "../workers";
import { workersWithout } from "./without";

describe("workersWithout", () => {
	let store: FakeSecretStore;
	let cloud: DigitalOceanCloud;
	let budget: WorkerBudget;
	let records: WorkerRecords;

	beforeEach(async () => {
		const digitalocean = new FakeDigitalOcean();
		store = new FakeSecretStore();
		await store.set(DIGITALOCEAN_TOKEN, "token");
		cloud = new DigitalOceanCloud({ store, fetch: digitalocean.fetch });
		budget = WorkerBudget.memory();
		records = WorkerRecords.memory();
	});

	const without = (
		config: Pick<Config, "cloud" | "workerProvider"> = {
			cloud,
			workerProvider: new CloudWorkers(cloud),
		},
	) => workersWithout({ config, budget, records, worker: "macbook" });

	/** Joins worker `id` to the records, as `splates worker join` does. */
	const join = async (id: string) =>
		records.join((await records.invite()).token, id);

	it("says the box makes workers with its cloud, with a token it takes and a budget", async () => {
		expect(await without()).toEqual({
			ok: true,
			said: "with this machine off, the box makes workers with DigitalOcean",
		});
	});

	it("names each other worker joined, but not this machine", async () => {
		await join("macbook");
		await join("windows");

		expect((await without()).said).toBe(
			"with this machine off, the box makes workers with DigitalOcean, and agents run on worker windows, joined already",
		);
	});

	it("warns with no provider and no other worker", async () => {
		await join("macbook");

		const said = await without({ cloud: null, workerProvider: null });

		expect(said.ok).toBe(false);
		expect(said.said).toContain("nothing runs agents");
		expect(said.said).toContain("no `workerProvider` or `cloud`");
	});

	it("takes another joined worker in place of a provider", async () => {
		await join("windows");

		expect(await without({ cloud: null, workerProvider: null })).toEqual({
			ok: true,
			said: "with this machine off, agents run on worker windows, joined already",
		});
	});

	it("warns when the cloud takes no token kept here", async () => {
		await store.delete(DIGITALOCEAN_TOKEN);

		const said = await without();

		expect(said.ok).toBe(false);
		expect(said.said).toContain("DigitalOcean takes no DigitalOcean API token");
	});

	it("warns when a limit of the worker budget is $0", async () => {
		await budget.set("day", 0);

		const said = await without();

		expect(said.ok).toBe(false);
		expect(said.said).toContain("the worker budget's day limit is $0");
	});
});
