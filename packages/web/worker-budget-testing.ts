import type { WorkerBudgetReport } from "@stringsync/splates-server/workers";

/** A report with the made workers having spent `spent` of the default limits. */
export function workerBudgetFixture(
	spent: Partial<Record<"hour" | "day" | "month", number>>,
): WorkerBudgetReport {
	const limits = { hour: 0.25, day: 5, month: 75 } as const;
	const windows = { hour: "running now", day: "today", month: "this month" };
	return {
		standing: (["hour", "day", "month"] as const).map((limit) => {
			const used = spent[limit] ?? 0;
			const percent = (used / limits[limit]) * 100;
			return {
				limit,
				window: windows[limit],
				since: 0,
				dollars: limits[limit],
				raised: 0,
				set: false,
				spent: used,
				left: Math.max(0, limits[limit] - used),
				tier:
					percent >= 100 ? 100 : percent >= 90 ? 90 : percent >= 80 ? 80 : 0,
				estimate: true,
			};
		}),
		raises: [],
		rate: 0,
		projected: 0,
		split: { day: [], month: [] },
		stopped: null,
		reviewed: false,
		runners: { cap: 16, set: false, up: 0, left: 16, tier: 0 },
	};
}
