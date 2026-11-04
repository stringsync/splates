import { describe, expect, it } from "bun:test";
import type { Cascade, CascadeStep, Ship } from "@splates/server/ship";
import { shipActivity, shipLine } from "./ship-activity";

describe("ship activity and line", () => {
	it("is null for a failed ship with no cascade under way", () => {
		const ship = { status: "failed" } as unknown as Ship;
		expect(shipActivity({ cascade: null, ship })).toBeNull();
	});

	it("is an error once the cascade stopped", () => {
		const stopped = {
			...cascade([step({ status: "failed" })]),
			status: "stopped" as const,
		};
		expect(shipActivity({ cascade: stopped, ship: null })).toBe("error");
	});

	const done = {
		...cascade([step({ status: "done" })]),
		status: "done" as const,
	};

	it("is done until the recap is acknowledged", () => {
		expect(shipActivity({ cascade: done, ship: null })).toBe("done");
		expect(shipActivity({ cascade: done, ship: null }, done.id)).toBeNull();
	});

	it("says nothing before the cascade speaks", () => {
		expect(shipLine(null)).toBeNull();
	});

	it("names the project publishing", () => {
		expect(shipLine({ cascade: cascade([step({})]), ship: null })).toBe(
			"wren publishing",
		);
	});

	it("names a hung step", () => {
		const hung = {
			key: "command",
			name: "build",
			state: "hung",
		} as unknown as CascadeStep["stages"][number];
		expect(
			shipLine({ cascade: cascade([step({ stages: [hung] })]), ship: null }),
		).toBe("wren hung at build");
	});

	it("names a failed step", () => {
		expect(
			shipLine({
				cascade: cascade([step({ status: "failed" })]),
				ship: null,
			}),
		).toBe("wren failed");
	});
});

function step(over: Partial<CascadeStep>): CascadeStep {
	return {
		slug: "wren",
		action: "ship",
		from: "1.4.2",
		bump: "patch",
		to: "1.4.3",
		publishes: [],
		takes: [],
		why: "the project shipped",
		status: "shipping",
		task: null,
		ship: null,
		published: [],
		note: null,
		stages: [],
		...over,
	};
}

function cascade(steps: CascadeStep[]): Cascade {
	return {
		id: "x",
		from: "wren",
		status: "running",
		started: "2026-10-27T12:00:00.000Z",
		ended: null,
		steps,
	};
}
