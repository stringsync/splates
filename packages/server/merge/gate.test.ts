import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLock } from "webappwiz/system";
import { SystemClock } from "webappwiz/time";
import type { Config } from "../config";
import { MergeGate, QUEUED_AFTER_MS } from "./gate";
import { MergeTiming } from "./timing";

/** A lock whose waiter is told the places the test feeds it, once the lock is free. */
class LineLock extends MemoryLock {
	tell: ((place: number) => void | Promise<void>) | undefined;

	override async acquire(
		onPlace?: (place: number) => void | Promise<void>,
	): Promise<void> {
		this.tell = onPlace;
		await onPlace?.(3);
		await super.acquire();
	}
}

describe("MergeGate.reserve", () => {
	let lock: LineLock;
	let gate: MergeGate;

	beforeEach(async () => {
		lock = new LineLock();
		await lock.acquire();
		// Reserving reads only the config's commands, the timing and the lock.
		gate = new MergeGate(
			undefined as never,
			undefined as never,
			undefined as never,
			{ preMerge: "true", postRewrite: null } as Config,
			new MergeTiming({}, new SystemClock()),
			lock,
			undefined as never,
		);
	});

	it("tells the merge its place once queued, then each change of it, in order", async () => {
		const told: number[] = [];

		const reserving = gate.reserve(async (place) => {
			told.push(place);
		});
		await Bun.sleep(QUEUED_AFTER_MS + 200);
		await lock.tell?.(2);
		await lock.tell?.(1);
		await lock.release();
		await using _held = await reserving;

		expect(told).toEqual([3, 2, 1]);
	});
});
