import "../../../setup";
import { describe, expect, it } from "bun:test";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { combine, type PeriodId, rates, type Stats } from "../stats";
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
	// scry-ignore simple-test-setup: older than this task, which only renamed a check id
	it("leads with what stands out, its bars charted, and folds the rest away", async () => {
		const busy = { ...tally, merged: 6, questionRounds: 6 };
		const stats: Stats = {
			buckets: [
				{ start: "2026-10-14T00:00:00.000Z", ...busy },
				{ start: "2026-10-14T06:00:00.000Z", ...busy },
				{ start: "2026-10-14T12:00:00.000Z", ...busy, questionRounds: 3 },
			],
			previous: { ...tally, merged: 10, questionRounds: 30 },
			models: [{ model: "Opus 5.5", ...tally }],
			devices: [],
			projects: [{ project: "/repo", ...tally }],
			systems: [],
			since: "2026-09-28T10:00:00.000Z",
			skill: [],
			baselines: [],
		};
		const page = render(
			<StatsPage
				report={new StatsReport({ stats: async () => stats })}
				systems={[]}
			/>,
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
			systems: [],
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
			<StatsPage
				report={new StatsReport({ stats: async () => stats })}
				systems={[]}
			/>,
		);

		await waitFor(() => page.getByRole("region", { name: "act on" }));
		fireEvent.click(page.getByRole("button", { name: "Everything else" }));
		const row = await waitFor(() =>
			page.getByRole("cell", {
				name: "Writes ARBOR.md before the first edit",
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
		).toEqual(["Writes ARBOR.md before the first edit", "50% of 2", "\u2013"]);
	});

	// scry-ignore simple-test-setup: older than this task, which only renamed a check id
	it("heads each breakdown with only the figures it is read for, each saying what it counts", async () => {
		const stats: Stats = {
			buckets: [],
			previous: null,
			models: [{ model: "Opus 5.5", ...tally }],
			devices: [],
			projects: [{ project: "/repo", ...tally }],
			systems: [],
			since: "2026-10-12T10:00:00.000Z",
			skill: [],
			baselines: [],
		};
		const page = render(
			<StatsPage
				report={new StatsReport({ stats: async () => stats })}
				systems={[]}
			/>,
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
			"Lines per task",
		]);
	});

	// scry-ignore simple-test-setup: older than this task, which only renamed a check id
	it("shows each system as its chip, opening to its globs where this project names it", async () => {
		const stats: Stats = {
			buckets: [
				{
					start: "2026-10-14T12:00:00.000Z",
					...tally,
					merged: 10,
					questionRounds: 11,
				},
			],
			previous: null,
			models: [],
			devices: [],
			projects: [],
			systems: [
				{ system: "mixer", ...tally, merged: 5, questionRounds: 10 },
				{ system: "docs", ...tally, merged: 5, questionRounds: 1 },
			],
			since: "2026-10-12T10:00:00.000Z",
			skill: [],
			baselines: [],
		};
		const page = render(
			<StatsPage
				report={new StatsReport({ stats: async () => stats })}
				systems={[{ name: "mixer", globs: ["src/mixer/**"] }]}
			/>,
		);

		await waitFor(() => page.getByLabelText("Questions by system"));
		const card = page.getByLabelText("Questions by system");
		expect(card.textContent).not.toContain("#");
		// The card names mixer beside its title, and its table lists it again.
		const chips = page.getAllByRole("button", { name: "mixer" });
		expect(chips).toHaveLength(2);
		fireEvent.click(chips[0] as HTMLElement);
		await waitFor(() => page.getByText("src/mixer/**"));
		// docs is no system this project names, so its chip opens to nothing.
		expect(page.queryByRole("button", { name: "docs" })).toBeNull();
		expect(page.getByText("docs")).toBeTruthy();
	});

	it("says when nothing stands out, and charts no bar too few to read", async () => {
		const stats: Stats = {
			buckets: [{ start: "2026-10-14T12:00:00.000Z", ...tally }],
			previous: null,
			models: [],
			devices: [],
			projects: [],
			systems: [],
			since: "2026-10-12T10:00:00.000Z",
			skill: [],
			baselines: [],
		};
		const page = render(
			<StatsPage
				report={new StatsReport({ stats: async () => stats })}
				systems={[]}
			/>,
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
			systems: [],
			since: "2026-07-01T10:00:00.000Z",
			skill: [],
			baselines: [],
		};
		const page = render(
			<StatsPage
				report={new StatsReport({ stats: async () => stats })}
				systems={[]}
			/>,
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
			systems: [],
			since: null,
			skill: [],
			baselines: [],
		};
		const page = render(
			<StatsPage
				report={new StatsReport({ stats: async () => empty })}
				systems={[]}
			/>,
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
			systems: [],
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
				systems={[]}
			/>,
		);
		await waitFor(() => page.getByText(/tasks ended/));

		await act(async () =>
			fireEvent.click(page.getByRole("button", { name: "Period: 7 days" })),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() =>
					page.getByRole("menuitemradio", { name: "All time" }),
				),
			),
		);

		await waitFor(() => page.getByRole("button", { name: "Period: All time" }));
		expect(asked).toEqual(["7d", "all"]);
		expect(page.getByText(/tasks ended/).textContent).toMatch(
			/^2 tasks ended counting since/,
		);
	});
});
