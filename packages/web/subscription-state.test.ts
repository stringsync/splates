import { describe, expect, it } from "bun:test";
import type { AutomationRow } from "@splates/server/hooks";
import {
	countsOf,
	shown,
	stateOf,
	subscriptionsOf,
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
	];

	it("are the person's automations on a signal", () => {
		expect(subscriptionsOf(rows).map(({ id }) => id)).toEqual(["1", "2", "3"]);
	});

	it("stand finished before paused, and filter and count by state", () => {
		const own = subscriptionsOf(rows);
		expect(own.map(stateOf)).toEqual(["active", "paused", "finished"]);
		expect(shown(own, "paused").map(({ id }) => id)).toEqual(["2"]);
		expect(countsOf(own)).toEqual({
			all: 3,
			active: 1,
			paused: 1,
			finished: 1,
		});
	});
});
