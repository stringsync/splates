import "../../../setup";
import { describe, expect, it } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { combine, type PeriodId, type Stats } from "../stats";
import { StatsPage } from "./stats";
import { StatsReport } from "./stats-report";

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
	it("shows the headline figures, a bar a span, and a row per model", async () => {
		const stats: Stats = {
			buckets: [
				{ start: "2026-10-14T06:00:00.000Z", ...tally },
				{ start: "2026-10-14T12:00:00.000Z", ...tally },
			],
			previous: null,
			models: [{ model: "Opus 5.5", ...tally }],
			projects: [{ project: "/repo", ...tally }],
			systems: [],
			since: "2026-10-06T10:00:00.000Z",
		};
		const page = render(
			<StatsPage report={new StatsReport({ stats: async () => stats })} />,
		);

		await waitFor(() => page.getByText("Tasks ended"));
		expect(page.getByText("Tasks ended").parentElement?.textContent).toBe(
			"Tasks ended4last 7 days",
		);
		const at = new Date("2026-10-14T12:00:00.000Z").toLocaleString(undefined, {
			weekday: "short",
			hour: "numeric",
			minute: "2-digit",
		});
		expect(
			page.getByLabelText(`${at}: questions per task 0.5, of 2 tasks`),
		).toBeTruthy();
		expect(page.getAllByText("Now")).toHaveLength(2);
		expect(page.getByRole("cell", { name: "Opus 5.5" })).toBeTruthy();
	});

	it("says on each card how its figure moved since the span before", async () => {
		const stats: Stats = {
			buckets: [
				{
					start: "2026-10-14T12:00:00.000Z",
					...tally,
					merged: 10,
					questionRounds: 5,
				},
			],
			previous: { ...tally, merged: 10, questionRounds: 10 },
			models: [],
			projects: [],
			systems: [],
			since: "2026-07-01T10:00:00.000Z",
		};
		const page = render(
			<StatsPage report={new StatsReport({ stats: async () => stats })} />,
		);

		await waitFor(() => page.getByLabelText("Questions per task"));
		expect(page.getByLabelText("Questions per task").textContent).toContain(
			"Down from 1.0 the 7 days before: better",
		);
	});

	it("says nothing has ended yet, before any task has", async () => {
		const empty: Stats = {
			buckets: [],
			previous: null,
			models: [],
			projects: [],
			systems: [],
			since: null,
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
			projects: [],
			systems: [],
			since: "2026-10-12T10:00:00.000Z",
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
		await waitFor(() => page.getByText("Tasks ended"));

		fireEvent.click(page.getByRole("button", { name: "All time" }));

		await waitFor(() =>
			expect(
				page
					.getByRole("button", { name: "All time" })
					.getAttribute("aria-pressed"),
			).toBe("true"),
		);
		expect(asked).toEqual(["7d", "all"]);
		expect(page.getByText("Tasks ended").parentElement?.textContent).toContain(
			"all time",
		);
		expect(page.getAllByText("This week")).toHaveLength(2);
		// Its axis tops out at a round number above the one week's 0.5.
		expect(page.getByText("0.25")).toBeTruthy();
	});
});
