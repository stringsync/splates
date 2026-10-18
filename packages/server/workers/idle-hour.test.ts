import { beforeEach, describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import { idleWorker } from "./idle-testing";
import { HOUR_END_MARGIN } from "./provisioning";

describe("idle made workers billed by the hour", () => {
	let fixture: Awaited<ReturnType<typeof idleWorker>>;

	beforeEach(async () => {
		fixture = await idleWorker("hour");
	});

	it("are destroyed only at the end of the paid hour", async () => {
		const { wall, retired, made, scheduler, worker } = fixture;

		await made.look(scheduler);
		wall.advance(Duration.mins(30));
		await made.look(scheduler);
		expect(retired).toEqual([]);
		wall.advance(Duration.mins(30).subtract(HOUR_END_MARGIN));
		await made.look(scheduler);

		expect(retired).toEqual([[worker]]);
	});
});
