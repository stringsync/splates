import { describe, expect, it } from "bun:test";
import type { AutoPicked } from "@stringsync/splates-server/auto-pick";
import { autoPickRuns } from "./auto-pick-runs";
import { details, todo } from "./testing";

const picked = (at: string): AutoPicked => ({
	pick: { agent: "claude" },
	rule: 0,
	kind: null,
	difficulty: null,
	reasons: ["Claude"],
	at,
});

describe("autoPickRuns", () => {
	it("lists the picks of started and queued tasks, newest first", () => {
		const runs = autoPickRuns(
			[
				details({ task: "old", autoPick: picked("2026-01-01T00:00:00Z") }),
				details({ task: "none", autoPick: null }),
				details({ task: "new", autoPick: picked("2026-01-03T00:00:00Z") }),
			],
			[
				todo({
					id: 7,
					subject: "Queued",
					autoPick: picked("2026-01-02T00:00:00Z"),
				}),
			],
		);

		expect(runs.map((each) => each.key)).toEqual(["new", "#7", "old"]);
		expect(runs[1]?.todo).toBe(7);
	});

	it("leaves out a queued task a started one has taken, which keeps its pick", () => {
		const at = "2026-01-02T00:00:00Z";
		const runs = autoPickRuns(
			[details({ task: "alpha", autoPick: picked(at) })],
			[todo({ id: 7, takenBy: "alpha", autoPick: picked(at) })],
		);

		expect(runs.map((each) => each.key)).toEqual(["alpha"]);
	});
});
