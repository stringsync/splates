import { beforeEach, describe, expect, it } from "bun:test";
import { FakePs } from "webappwiz/system/testing";
import { AwsCloud, AwsCredentialSource, CloudWorkers } from "../cloud";
import { FakeAws } from "../cloud/testing";
import type { Config } from "../config";
import { WorkerBudget, WorkerRecords } from "../workers";
import { workersWithout } from "./without";

describe("workersWithout", () => {
	let ps: FakePs;
	let cloud: AwsCloud;
	let budget: WorkerBudget;
	let records: WorkerRecords;

	beforeEach(async () => {
		const aws = new FakeAws();
		ps = new FakePs();
		ps.setEnv({
			AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
			AWS_SECRET_ACCESS_KEY: "secret",
		});
		cloud = new AwsCloud({
			credentials: new AwsCredentialSource({ ps }),
			fetch: aws.fetch,
		});
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

	it("says the box makes workers with its cloud, with a sign-in it takes and a budget", async () => {
		expect(await without()).toEqual({
			ok: true,
			said: "with this machine off, the box makes workers with AWS",
		});
	});

	it("names each other worker joined, but not this machine", async () => {
		await join("macbook");
		await join("windows");

		expect((await without()).said).toBe(
			"with this machine off, the box makes workers with AWS, and agents run on worker windows, joined already",
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

	it("warns when AWS takes no sign-in kept here", async () => {
		ps.setEnv({
			AWS_ACCESS_KEY_ID: "AKIAWRONG",
			AWS_SECRET_ACCESS_KEY: "secret",
		});

		const said = await without();

		expect(said.ok).toBe(false);
		expect(said.said).toContain("AWS takes no sign-in found here");
	});

	it("warns when a limit of the worker budget is $0", async () => {
		await budget.set("day", 0);

		const said = await without();

		expect(said.ok).toBe(false);
		expect(said.said).toContain("the worker budget's day limit is $0");
	});
});
