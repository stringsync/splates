import { describe, expect, it } from "bun:test";
import type { Stage } from "@splates/server/ship";
import { isSlow, slowestOf, spentOn } from "./ship-slow";

const AT = Date.parse("2026-01-01T00:30:00Z");

function stage(
	key: Stage["key"],
	over: Partial<Stage> & { expected: number },
): Stage {
	return {
		key,
		name: key,
		state: "running",
		started: null,
		ended: null,
		known: true,
		deadline: null,
		check: null,
		log: null,
		...over,
	};
}

describe("slow ship steps", () => {
	it("reads a running step against the clock and an ended one against its end", () => {
		const running = stage("gate", {
			expected: 600_000,
			started: "2026-01-01T00:00:00Z",
		});
		expect(spentOn(running, AT)).toBe(1_800_000);
		const ended = { ...running, ended: "2026-01-01T00:05:00Z" };
		expect(spentOn(ended, AT)).toBe(300_000);
		expect(spentOn(stage("gate", { expected: 1 }), AT)).toBeNull();
	});

	it("calls a step slow only once it is past its expected time", () => {
		const started = "2026-01-01T00:00:00Z";
		expect(isSlow(stage("gate", { expected: 600_000, started }), AT)).toBe(
			true,
		);
		expect(isSlow(stage("gate", { expected: 3_600_000, started }), AT)).toBe(
			false,
		);
	});

	it("never calls a wait on the person slow", () => {
		const started = "2026-01-01T00:00:00Z";
		expect(isSlow(stage("otp", { expected: 1000, started }), AT)).toBe(false);
		expect(
			isSlow(stage("gate", { expected: 1000, started, state: "asking" }), AT),
		).toBe(false);
	});

	it("picks the step furthest past its expected time", () => {
		const started = "2026-01-01T00:00:00Z";
		const gate = stage("gate", { expected: 600_000, started });
		const bump = stage("bump", { expected: 60_000, started });
		const step = { stages: [gate, bump] } as never;
		expect(slowestOf(step, AT)).toBe(bump);
		expect(slowestOf({ stages: [] } as never, AT)).toBeNull();
	});
});
