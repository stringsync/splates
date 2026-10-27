import { describe, expect, it } from "bun:test";
import type { Cascade, CascadeStep } from "@stringsync/splates-server/ship";
import { shipLine } from "./ship-activity";

describe("shipLine", () => {
	it("says nothing before the cascade speaks", () => {
		expect(shipLine(null)).toBeNull();
	});

	it("names the project publishing", () => {
		expect(shipLine({ cascade: cascade([step({})]), ship: null })).toBe(
			"webappwiz publishing",
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
		).toBe("webappwiz hung at build");
	});

	it("says an agent is on a failed step", () => {
		expect(
			shipLine({
				cascade: cascade([step({ status: "failed", fix: 7 })]),
				ship: null,
			}),
		).toBe("webappwiz failed, an agent is on it");
	});
});

function step(over: Partial<CascadeStep>): CascadeStep {
	return {
		slug: "webappwiz",
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
		fix: null,
		stages: [],
		...over,
	};
}

function cascade(steps: CascadeStep[]): Cascade {
	return {
		id: "x",
		from: "webappwiz",
		status: "running",
		started: "2026-10-27T12:00:00.000Z",
		ended: null,
		steps,
	};
}
