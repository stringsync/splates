import { describe, expect, test } from "bun:test";
import type { Launcher } from "../agents";
import { NoopHold } from "./noop-hold";

describe("NoopHold", () => {
	test("never drains, replaces or loses its place", () => {
		const hold = new NoopHold({} as Launcher);

		expect([hold.drains(), hold.replaces(), hold.lost.aborted]).toEqual([
			false,
			false,
			false,
		]);
	});

	test("takes an agent back through the launcher", () => {
		const taken: unknown[] = [];
		const launcher = {
			resume: (handle: unknown) => {
				taken.push(handle);
				return "process";
			},
		} as unknown as Launcher;
		const hold = new NoopHold(launcher);

		const out = hold.resume({ worker: "w" } as never, undefined as never);

		expect([out as unknown, taken]).toEqual(["process", [{ worker: "w" }]]);
	});
});
