import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { MoveProgress } from "@stringsync/splates-server/setup";
import { Duration } from "webappwiz/time";
import { MoveWatch } from "./setup-coordinator-steps";
import { Testing, waitFor } from "./testing";

const RUNNING: MoveProgress = {
	moved: false,
	running: true,
	exitCode: null,
	log: ["bringing splates on the box at 203.0.113.7 to 1.2.3"],
	host: "splates.example.com",
};

describe("MoveWatch", () => {
	let testing: Testing;
	beforeEach(() => {
		testing = new Testing();
		testing.reply = RUNNING;
		testing.coordinatorMove = RUNNING;
	});
	afterEach(() => testing.dispose());

	it("follows the move past this server going away, until the box answers moved", async () => {
		const watch = new MoveWatch({ pause: Duration.ms(1) });
		const seen: string[] = [];
		watch.events.on("changed", () => seen.push(watch.state.kind));

		const moving = watch.run();
		await waitFor(() => expect(watch.state.kind).toBe("here"));
		testing.goAway();
		await waitFor(() =>
			expect(watch.state).toEqual({
				kind: "away",
				host: "splates.example.com",
				long: false,
			}),
		);
		testing.coordinatorMove = { ...RUNNING, moved: true, log: [] };
		testing.comeBack();

		await moving;
		expect(watch.state.kind).toBe("idle");
		expect(seen).toContain("away");
	});

	it("says the move failed with what it said, once it stops before this server did", async () => {
		const watch = new MoveWatch({ pause: Duration.ms(1) });
		testing.coordinatorMove = {
			...RUNNING,
			running: false,
			exitCode: 1,
			log: ["cannot move yet:", "- no saved tunnel"],
		};

		await expect(watch.run()).rejects.toThrow("nothing here changed");
		expect(watch.state).toEqual({
			kind: "failed",
			log: ["cannot move yet:", "- no saved tunnel"],
		});
	});

	it("says so once the box has not answered in ten minutes", async () => {
		let now = 0;
		const watch = new MoveWatch({ pause: Duration.ms(1), now: () => now });
		const moving = watch.run().catch(() => {});
		await waitFor(() => expect(watch.state.kind).toBe("here"));
		testing.goAway();
		await waitFor(() => expect(watch.state.kind).toBe("away"));
		now = Duration.mins(11).ms;
		await waitFor(() =>
			expect(watch.state).toMatchObject({ kind: "away", long: true }),
		);
		watch.stop();
		await moving;
	});
});
