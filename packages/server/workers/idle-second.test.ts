import { beforeEach, describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import { idleWorker } from "./idle-testing";

describe("idle made workers billed by the second", () => {
	let fixture: Awaited<ReturnType<typeof idleWorker>>;

	beforeEach(async () => {
		fixture = await idleWorker("second");
	});

	it("are destroyed once idle for 15 minutes", async () => {
		const { wall, retired, made, scheduler, worker } = fixture;

		await made.look(scheduler);
		wall.advance(Duration.mins(14));
		await made.look(scheduler);
		expect(retired).toEqual([]);
		wall.advance(Duration.mins(1));
		await made.look(scheduler);

		expect(retired).toEqual([[worker]]);
	});

	it("are kept while an agent holds a slot", async () => {
		const { wall, retired, made, scheduler } = fixture;
		await scheduler.take({
			id: "c",
			project: "/p",
			task: null,
			platform: null,
			agent: "claude",
		});

		await made.look(scheduler);
		wall.advance(Duration.hrs(2));
		await made.look(scheduler);

		expect(retired).toEqual([]);
	});
});
