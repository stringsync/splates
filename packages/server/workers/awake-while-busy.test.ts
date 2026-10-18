import { describe, expect, it } from "bun:test";
import type { KeepAwake } from "./awake";
import { AwakeWhileBusy } from "./awake-while-busy";

/** Counts the holds taken and let go. */
class CountingAwake implements KeepAwake {
	taken = 0;
	released = 0;

	hold() {
		this.taken += 1;
		return {
			dispose: () => {
				this.released += 1;
			},
		};
	}
}

describe("AwakeWhileBusy", () => {
	it("holds once for many, and lets go after the last", () => {
		const awake = new CountingAwake();
		const busy = new AwakeWhileBusy(awake);

		const first = busy.busy();
		const second = busy.busy();
		first.dispose();

		expect([awake.taken, awake.released]).toEqual([1, 0]);

		second.dispose();

		expect([awake.taken, awake.released]).toEqual([1, 1]);
	});

	it("counts a thing let go twice once", () => {
		const awake = new CountingAwake();
		const busy = new AwakeWhileBusy(awake);
		const first = busy.busy();
		const second = busy.busy();

		first.dispose();
		first.dispose();

		expect(awake.released).toBe(0);
		second.dispose();
		expect(awake.released).toBe(1);
	});

	it("holds again once busy after idle", () => {
		const awake = new CountingAwake();
		const busy = new AwakeWhileBusy(awake);

		busy.busy().dispose();
		busy.busy();

		expect(awake.taken).toBe(2);
	});
});
