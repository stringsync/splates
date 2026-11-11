import { describe, expect, test } from "bun:test";
import { Duration } from "core/time";
import { NoopTimer } from "./noop-timer";

describe("NoopTimer", () => {
	test("never fires what it is given", async () => {
		const timer = new NoopTimer();
		let fired = 0;

		timer.setTimeout(() => fired++, Duration.ms(1)).dispose();
		timer.setInterval(() => fired++, Duration.ms(1));
		await Bun.sleep(10);

		expect(fired).toBe(0);
	});
});
