import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { Duration } from "webappwiz/time";
import { FakeClock, FakeTimer } from "webappwiz/time/testing";
import { MemoryStorage } from "../storage/testing";
import { Accounting } from "./accounting";
import { JobClient } from "./client";
import { type JobSpec, Priority } from "./job";
import { JobRoutes } from "./routes";
import { JobScheduler } from "./scheduler";
import { FakePools } from "./testing";

const URL_ = "http://splates.test";

const SPEC: JobSpec = {
	what: "merge gate",
	task: "alpha",
	priority: Priority.high,
	request: { resources: { cpus: 4 }, walltime: Duration.mins(3) },
};

describe("JobRoutes with JobClient", () => {
	let scheduler: JobScheduler;
	let routes: JobRoutes;
	let client: JobClient;

	beforeEach(() => {
		scheduler = new JobScheduler(
			new FakePools({ cpus: 4 }),
			new Accounting(new MemoryStorage()),
			{
				clock: new FakeClock(),
				timer: new FakeTimer(),
				log: new MemoryLogger(),
			},
		);
		routes = new JobRoutes(scheduler);
		// Sends straight to the routes, as the server would route them.
		const send = async (url: string, init: RequestInit): Promise<Response> => {
			const request = new Request(url, init);
			const path = new URL(url).pathname;
			if (path === "/api/jobs") {
				return init.method === "POST" ? routes.submit(request) : routes.list();
			}
			if (path.endsWith("/events")) {
				return routes.events(request);
			}
			if (path.endsWith("/renew")) {
				return routes.renew(request);
			}
			return routes.finish(request);
		};
		client = new JobClient({ url: URL_, send }, new MemoryLogger());
	});
	afterEach(() => {
		scheduler.dispose();
	});

	it("pauses and resumes the scheduler's starts", async () => {
		await routes.pause();
		expect(scheduler.list().paused).toBe(true);
		const held = await scheduler.submit(SPEC);
		expect(scheduler.list().waiting.map((job) => job.id)).toEqual([held.id]);
		await routes.resume();
		await scheduler.sweep();
		expect(scheduler.list().paused).toBe(false);
		expect(scheduler.list().running.map((job) => job.id)).toEqual([held.id]);
	});

	it("submits a job and hears over its stream that it started", async () => {
		const job = await client.submit(SPEC);

		expect(job.allocation).toEqual({ cpus: 4 });
		expect(scheduler.list().running.map((each) => each.task)).toEqual([
			"alpha",
		]);
	});

	it("hears its place, then its start", async () => {
		const ahead = await scheduler.submit(SPEC);
		const job = await client.submit(SPEC);
		expect(job.place).toBe(1);

		await ahead.finish();
		await until(() => job.allocation !== null);

		expect(job.allocation).toEqual({ cpus: 4 });
		expect(job.place).toBeNull();
	});

	it("finishes the job on the server when the holder finishes it", async () => {
		const job = await client.submit(SPEC);

		await job.finish();

		expect(scheduler.list().running).toHaveLength(0);
	});

	it("finishes the job when its stream ends, as a holder that died", async () => {
		const job = await scheduler.submit(SPEC);
		const response = await routes.events(
			new Request(`${URL_}/api/jobs/${job.id}/events`),
		);

		await response.body?.cancel();
		await until(() => scheduler.list().running.length === 0);

		expect(scheduler.find(job.id)).toBeNull();
	});

	it("refuses what is not a job", async () => {
		const response = await routes.submit(
			new Request(`${URL_}/api/jobs`, {
				method: "POST",
				body: JSON.stringify({ what: "" }),
			}),
		);

		expect(response.status).toBe(400);
	});

	it("lists the queue", async () => {
		await client.submit(SPEC);
		await client.submit({ ...SPEC, task: "beta" });

		const listing = await (await routes.list()).json();

		expect(listing.running.map((each: { task: string }) => each.task)).toEqual([
			"alpha",
		]);
		expect(
			listing.waiting.map((each: { place: number }) => each.place),
		).toEqual([1]);
	});
});

async function until(holds: () => boolean): Promise<void> {
	for (let tries = 0; tries < 100 && !holds(); tries++) {
		await Bun.sleep(1);
	}
	expect(holds()).toBe(true);
}
