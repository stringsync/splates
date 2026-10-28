import { describe, expect, it } from "bun:test";
import {
	combine,
	type PeriodId,
	type Stats,
} from "@stringsync/splates-server/stats/browser";
import { StatsPage } from "./stats";
import { StatsReport } from "./stats-report";
import { act, fireEvent, render, waitFor } from "./testing-library";

const tally = {
	...combine([]),
	merged: 2,
	removed: 0,
	clean: 1,
	questionRounds: 1,
	reviewRounds: 0,
	failedMerges: 0,
};

describe("StatsPage", () => {
	it("shows essential metrics for every model together, with no secondary sections", async () => {
		const measured = {
			...tally,
			timed: 2,
			spentMs: 600_000,
			used: 1,
			workedMs: 60_000,
			costed: 1,
			cost: 1.5,
		};
		const stats: Stats = {
			buckets: [{ start: "2026-10-14T00:00:00.000Z", ...measured }],
			previous: null,
			models: [
				{ model: "Opus 5.5", ...measured },
				{ model: null, ...tally },
			],
			devices: [{ device: "phone", ...tally }],
			projects: [{ project: "/repo", ...tally }],
			since: "2026-09-28T10:00:00.000Z",
			skill: [],
			baselines: [],
		};
		const page = render(
			<StatsPage report={new StatsReport({ stats: async () => stats })} />,
		);

		const table = await waitFor(() =>
			page.getByRole("table", { name: "Task stats by model" }),
		);
		expect(page.getAllByRole("table")).toHaveLength(1);
		expect(
			Array.from(
				table.querySelectorAll("thead th"),
				(cell) => cell.textContent,
			),
		).toEqual(["Model", "Tasks", "Duration", "Working time", "Cost / task"]);
		expect(
			Array.from(table.querySelectorAll("tbody tr"), (row) =>
				Array.from(row.querySelectorAll("th, td"), (cell) => cell.textContent),
			),
		).toEqual([
			["Opus 5.5", "2", "5m", "1m", "$1.50"],
			["Unknown", "2", "\u2013", "\u2013", "\u2013"],
		]);
		expect(page.queryByRole("button", { name: "Everything else" })).toBeNull();
		expect(page.queryByRole("region", { name: "act on" })).toBeNull();
		expect(
			[
				"By device",
				"By project",
				"By skill version",
				"Questions per task",
				"Time waiting on you",
				"Why merges failed",
				"Why tasks were removed",
			].map((label) => page.queryByText(label)),
		).toEqual([null, null, null, null, null, null, null]);
		expect(page.getByText(/2 tasks ended in the last day/)).toBeTruthy();
	});

	it("says when the selected period has no tasks", async () => {
		const stats: Stats = {
			buckets: [],
			previous: null,
			models: [],
			devices: [],
			projects: [],
			since: "2026-09-28T10:00:00.000Z",
			skill: [],
			baselines: [],
		};
		const page = render(
			<StatsPage report={new StatsReport({ stats: async () => stats })} />,
		);
		await waitFor(() => page.getByText("No tasks ended in this period."));
	});

	it("says nothing has ended yet, before any task has", async () => {
		const empty: Stats = {
			buckets: [],
			previous: null,
			models: [],
			devices: [],
			projects: [],

			since: null,
			skill: [],
			baselines: [],
		};
		const page = render(
			<StatsPage report={new StatsReport({ stats: async () => empty })} />,
		);

		await waitFor(() => page.getByText(/No task has ended/));
	});

	it("looks at the period picked, and says which", async () => {
		const asked: PeriodId[] = [];
		const stats: Stats = {
			buckets: [{ start: "2026-10-12T00:00:00.000Z", ...tally }],
			previous: null,
			models: [],
			devices: [],
			projects: [],

			since: "2026-10-12T10:00:00.000Z",
			skill: [],
			baselines: [],
		};
		const page = render(
			<StatsPage
				report={
					new StatsReport({
						stats: async (period) => {
							asked.push(period);
							return stats;
						},
					})
				}
			/>,
		);
		await waitFor(() => page.getByText(/^2 tasks ended/));

		await act(async () =>
			fireEvent.click(page.getByRole("radio", { name: "All time" })),
		);

		await waitFor(() =>
			expect(
				page
					.getByRole("radio", { name: "All time" })
					.getAttribute("aria-checked"),
			).toBe("true"),
		);
		expect(asked).toEqual(["1d", "all"]);
		expect(page.getByText(/^2 tasks ended/).textContent).toMatch(
			/^2 tasks ended counting since/,
		);
	});
});
