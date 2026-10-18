import { describe, expect, it } from "bun:test";
import { FakePs } from "webappwiz/system/testing";
import { FakeTimer } from "webappwiz/time/testing";
import { endWithSupervisor, SUPERVISOR } from "./run";

describe("endWithSupervisor", () => {
	it("ends the worker once its supervisor is gone, and only then", () => {
		const ps = new FakePs();
		const timer = new FakeTimer();
		ps.setEnv({ [SUPERVISOR]: "4242" });
		let ended = 0;
		endWithSupervisor(ps, timer, () => ended++);

		timer.fireIntervals();
		expect(ended).toBe(0);
		ps.kill(4242);
		timer.fireIntervals();
		timer.fireIntervals();
		expect(ended).toBe(1);
	});

	it("watches nothing for a worker no server started", () => {
		const timer = new FakeTimer();

		expect(endWithSupervisor(new FakePs(), timer, () => {})).toBeNull();
		expect(timer.intervals).toEqual([]);
	});
});
