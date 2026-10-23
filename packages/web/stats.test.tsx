import { describe, expect, it } from "bun:test";
import {
	combine,
	type PeriodId,
	rates,
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
	// scry-ignore simple-test-setup: older than this task, which only renamed a check id
	it("leads with what stands out, its bars charted, and folds the rest away", async () => {
		const busy = { ...tally, merged: 6, questionRounds: 6 };
		const stats: Stats = {
			buckets: [
				{
					start: "2026-10-14T00:00:00.000Z",
					...busy,
					costed: 2,
					cost: 3,
					mergeTimed: 2,
					batchedMerges: 3,
					batchGates: 1,
					mergeQueuedMs: 60_000,
					mergeRanMs: 300_000,
				},
				{ start: "2026-10-14T06:00:00.000Z", ...busy },
				{ start: "2026-10-14T12:00:00.000Z", ...busy, questionRounds: 3 },
			],
			previous: { ...tally, merged: 10, questionRounds: 30 },
			models: [{ model: "Opus 5.5", ...tally }],
			devices: [],
			projects: [{ project: "/repo", ...tally }],
			since: "2026-09-28T10:00:00.000Z",
			skill: [],
			baselines: [],
		};
		const page = render(
			<StatsPage report={new StatsReport({ stats: async () => stats })} />,
		);

		await waitFor(() => page.getByRole("region", { name: "act on" }));
		const lead = page.getByRole("region", { name: "act on" });
		expect(lead.textContent).toContain("Questions per task");
		const at = new Date("2026-10-14T12:00:00.000Z").toLocaleString(undefined, {
			weekday: "short",
			hour: "numeric",
			minute: "2-digit",
		});
		expect(
			page.getByLabelText(`${at}: questions per task 0.5, of 6 tasks`),
		).toBeTruthy();
		expect(page.queryByRole("cell", { name: "Opus 5.5" })).toBeNull();
		expect(page.getByText(/18 tasks ended in the last 7 days/)).toBeTruthy();
		// What a task cost leads, without unfolding anything.
		const cost = page.getByRole("region", { name: "Cost per task" });
		expect(cost.textContent).toContain("$1.50");
		expect(cost.textContent).toContain("Over 2 tasks in the last 7 days");
		// How fast tasks close and merges take show without unfolding anything.
		const closing = page.getByRole("region", { name: "Closing" });
		expect(closing.textContent).toContain("18 in the last 7 days");
		const merges = page.getByRole("region", { name: "Merges" });
		expect(merges.textContent).toContain(
			"3 merges shared 1 landing gate · 2 separate gates saved",
		);
		expect(merges.textContent).toContain("30s");
		expect(merges.textContent).toContain("2m 30s");
		expect(merges.textContent).toContain("Over 2 merges in the last 7 days");
		expect(page.queryByRole("region", { name: "Decisions" })).toBeNull();
		expect(page.queryByRole("toolbar", { name: "Sizes" })).toBeNull();

		fireEvent.click(page.getByRole("button", { name: "Everything else" }));

		await waitFor(() => page.getByRole("cell", { name: "Opus 5.5" }));
		expect(page.getByLabelText("Picks you overturned").textContent).toContain(
			"Needs 5 more questions offering a pick to say",
		);
	});

	// scry-ignore simple-test-setup: older than this task, which only renamed a check id
	it("compares each skill rule's pass rate across the newest skill versions", async () => {
		const stats: Stats = {
			buckets: [],
			previous: null,
			models: [{ model: "Opus 5.5", ...tally }],
			devices: [],
			projects: [],

			since: "2026-10-12T10:00:00.000Z",
			baselines: [],
			skill: rates([
				{
					conversation: "a",
					project: "/repo",
					agent: "claude",
					skill: "0.0.44",
					at: "2026-10-14T10:00:00.000Z",
					scores: { "plan-first": { passed: 1, failed: 0 } },
				},
				{
					conversation: "b",
					project: "/repo",
					agent: "claude",
					skill: "0.0.44",
					at: "2026-10-14T10:00:00.000Z",
					scores: { "plan-first": { passed: 1, failed: 1 } },
				},
				{
					conversation: "c",
					project: "/repo",
					agent: "claude",
					skill: "0.0.43",
					at: "2026-10-13T10:00:00.000Z",
					scores: {},
				},
			]),
		};
		const page = render(
			<StatsPage report={new StatsReport({ stats: async () => stats })} />,
		);

		await waitFor(() => page.getByRole("region", { name: "act on" }));
		fireEvent.click(page.getByRole("button", { name: "Everything else" }));
		const row = await waitFor(() =>
			page.getByRole("cell", {
				name: "Writes SPLATES.md before the first edit",
			}),
		);

		const table = page.getByText("By skill version").parentElement;
		expect(
			Array.from(table?.querySelectorAll("th") ?? []).map(
				(each) => each.textContent,
			),
		).toEqual(["Rule", "0.0.442 conversations", "0.0.431 conversation"]);
		expect(
			Array.from(row.parentElement?.querySelectorAll("td") ?? []).map(
				(each) => each.textContent,
			),
		).toEqual([
			"Writes SPLATES.md before the first edit",
			"50% of 2",
			"\u2013",
		]);
	});

	// scry-ignore simple-test-setup: older than this task, which only renamed a check id
	it("heads each breakdown with only the figures it is read for, each saying what it counts", async () => {
		const stats: Stats = {
			buckets: [],
			previous: null,
			models: [{ model: "Opus 5.5", ...tally }],
			devices: [],
			projects: [{ project: "/repo", ...tally }],

			since: "2026-10-12T10:00:00.000Z",
			skill: [],
			baselines: [],
		};
		const page = render(
			<StatsPage report={new StatsReport({ stats: async () => stats })} />,
		);

		await waitFor(() => page.getByRole("region", { name: "act on" }));
		fireEvent.click(page.getByRole("button", { name: "Everything else" }));
		await waitFor(() => page.getByRole("cell", { name: "Opus 5.5" }));

		const heads = (name: string) =>
			Array.from(
				page.getByText(name).parentElement?.querySelectorAll("th") ?? [],
			).map((each) => each.textContent);
		expect(heads("By model")).toEqual([
			"Name",
			"Tasks ended",
			"Questions per task",
			"Reviews per task",
			"Picks overturned",
			"Tasks removed",
			"Cost per task",
			"Worker spend",
			"Agent working time",
			"Lines per task",
		]);
		expect(heads("By device")).toEqual([
			"Name",
			"Tasks ended",
			"Questions per task",
			"Reviews per task",
			"Tasks removed",
		]);
		expect(heads("By project")).toEqual([
			"Name",
			"Tasks ended",
			"Tasks removed",
			"Cost per task",
			"Worker spend",
			"Lines per task",
		]);
	});

	// scry-ignore simple-test-setup: older than this task, which only renamed a check id

	it("says when nothing stands out, and charts no bar too few to read", async () => {
		const stats: Stats = {
			buckets: [{ start: "2026-10-14T12:00:00.000Z", ...tally }],
			previous: null,
			models: [],
			devices: [],
			projects: [],

			since: "2026-10-12T10:00:00.000Z",
			skill: [],
			baselines: [],
		};
		const page = render(
			<StatsPage report={new StatsReport({ stats: async () => stats })} />,
		);

		await waitFor(() => page.getByText("Nothing stands out this period."));
		fireEvent.click(page.getByRole("button", { name: "Everything else" }));
		await waitFor(() => page.getByLabelText("Questions per task"));
		expect(page.getByLabelText("Questions per task").textContent).toContain(
			"Needs 3 more tasks ended to say",
		);
		expect(page.queryByLabelText(/: questions per task/)).toBeNull();
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
			devices: [],
			projects: [],

			since: "2026-07-01T10:00:00.000Z",
			skill: [],
			baselines: [],
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
		await waitFor(() => page.getByText(/tasks ended/));

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
		expect(asked).toEqual(["7d", "all"]);
		expect(page.getByText(/tasks ended/).textContent).toMatch(
			/^2 tasks ended counting since/,
		);
	});
});
