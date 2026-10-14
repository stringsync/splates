import "../../../setup";
import { describe, expect, it } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import type { Stats } from "../stats";
import { StatsPage } from "./stats";
import { StatsReport } from "./stats-report";

const tally = {
	merged: 2,
	removed: 0,
	clean: 1,
	questionRounds: 1,
	reviewRounds: 0,
	failedMerges: 0,
};

describe("StatsPage", () => {
	it("shows the headline figures, a bar a week, and a row per model", async () => {
		const stats: Stats = {
			weeks: [
				{ start: "2026-10-05", ...tally },
				{ start: "2026-10-12", ...tally },
			],
			previous: null,
			models: [{ model: "Opus 5.5", ...tally }],
			projects: [{ project: "/repo", ...tally }],
			since: "2026-10-06T10:00:00.000Z",
		};
		const page = render(
			<StatsPage report={new StatsReport({ stats: async () => stats })} />,
		);

		await waitFor(() => page.getByText("Tasks ended"));
		expect(page.getByText("Tasks ended").parentElement?.textContent).toBe(
			"Tasks ended4last 12 weeks",
		);
		expect(
			page.getByLabelText(
				"Week of 2026-10-12: questions per task 0.5, of 2 tasks",
			),
		).toBeTruthy();
		expect(page.getByRole("cell", { name: "Opus 5.5" })).toBeTruthy();
	});

	it("says nothing has ended yet, before any task has", async () => {
		const empty: Stats = {
			weeks: [],
			previous: null,
			models: [],
			projects: [],
			since: null,
		};
		const page = render(
			<StatsPage report={new StatsReport({ stats: async () => empty })} />,
		);

		await waitFor(() => page.getByText(/No task has ended/));
	});

	it("looks at the period picked, and says which", async () => {
		const asked: (number | null)[] = [];
		const stats: Stats = {
			weeks: [{ start: "2026-10-12", ...tally }],
			previous: null,
			models: [],
			projects: [],
			since: "2026-10-12T10:00:00.000Z",
		};
		const page = render(
			<StatsPage
				report={
					new StatsReport({
						stats: async (weeks) => {
							asked.push(weeks);
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
		expect(asked).toEqual([12, null]);
		expect(page.getByText("Tasks ended").parentElement?.textContent).toContain(
			"all time",
		);
		// Its axis tops out at a round number above the one week's 0.5.
		expect(page.getByText("0.25")).toBeTruthy();
	});
});
