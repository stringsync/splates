import { describe, expect, it } from "bun:test";
import type { AutomationRow } from "@splates/server/hooks";
import {
	countsOf,
	kindOf,
	shown,
	stateOf,
	subscriptionsOf,
	triggerCountsOf,
} from "./subscription-state";

function row(over: Partial<AutomationRow>): AutomationRow {
	return {
		id: "1",
		trigger: { signal: "mdom.released" },
		hook: { kind: "run", command: "x" },
		createdAt: "",
		when: "",
		does: "",
		runs: [],
		...over,
	};
}

describe("subscriptions", () => {
	const rows = [
		row({ id: "1" }),
		row({ id: "2", paused: true, notice: "Source removed: signal expired" }),
		row({ id: "3", finishedAt: "2026-11-19T09:00:00Z", paused: true }),
		row({ id: "4", trigger: { every: "1h" } }),
		row({ id: "5", source: "config" }),
		row({ id: "6", trigger: { event: "task.created" } }),
	];

	it("are the person's automations, whatever sets them off", () => {
		expect(subscriptionsOf(rows).map(({ id }) => id)).toEqual([
			"1",
			"2",
			"3",
			"4",
			"6",
		]);
	});

	it("stand finished before paused, and filter and count by state", () => {
		const own = subscriptionsOf(rows);
		expect(own.map(stateOf)).toEqual([
			"active",
			"paused",
			"finished",
			"active",
			"active",
		]);
		expect(shown(own, "paused").map(({ id }) => id)).toEqual(["2"]);
		expect(countsOf(own)).toEqual({
			all: 5,
			active: 3,
			paused: 1,
			finished: 1,
		});
	});

	it("count by what sets them off", () => {
		const own = subscriptionsOf(rows);
		expect(own.map((each) => kindOf(each.trigger))).toEqual([
			"signal",
			"signal",
			"signal",
			"schedule",
			"event",
		]);
		expect(triggerCountsOf(own)).toEqual({
			any: 5,
			signal: 3,
			event: 1,
			schedule: 1,
		});
	});
});
