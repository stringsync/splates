import { useReactive } from "@webappwiz/react";
import { type JSX, useEffect } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { ReadFailed, ReadingNow } from "./countdown";
import { BY_MODEL } from "./stats-columns";
import { PERIODS, type Row, type StatsReport } from "./stats-report";
import { TopBar } from "./top-bar";

/** Essential task stats by model over the selected period. */
export function StatsPage({ report }: { report: StatsReport }): JSX.Element {
	const { stats, error, empty, period, ended, models } = useReactive(
		report,
		(report) => ({
			stats: report.stats,
			error: report.error,
			empty: report.empty,
			period: report.period,
			ended: report.ended,
			models: report.models,
		}),
		["changed"],
	);
	// Read each time the page is shown: tasks end while it is away.
	useEffect(() => {
		void report.refresh();
	}, [report]);

	return (
		<section aria-label="stats" className="flex min-w-0 flex-col gap-6">
			<TopBar title="Stats" />
			{/* Not Tabs: under the app's vertical Tabs it would lay out as a column. */}
			<div
				role="radiogroup"
				aria-label="Period"
				className="sticky top-0 z-10 -mt-2 flex justify-center gap-1 overflow-x-auto bg-background py-2"
			>
				{PERIODS.map((each) => (
					<Button
						key={each.id}
						type="button"
						role="radio"
						aria-checked={each.id === period.id}
						variant={each.id === period.id ? "secondary" : "ghost"}
						size="sm"
						onClick={() => void report.choose(each)}
					>
						{each.label}
					</Button>
				))}
			</div>
			{error !== null && (
				<ReadFailed error={error} onRetry={() => void report.refresh()} />
			)}
			{stats === null ? (
				error === null && <ReadingNow label="Reading stats…" />
			) : empty ? (
				<p className="text-muted-foreground text-sm">
					No task has ended since splates started counting. Each one merged or
					removed from now on shows up here.
				</p>
			) : (
				<>
					<ModelStats rows={models} />
					{stats.since && (
						<p className="text-muted-foreground text-xs">
							{ended} task{ended === 1 ? "" : "s"} ended{" "}
							{period.span === null ? "" : `in the last ${period.span}, `}
							counting since {new Date(stats.since).toLocaleDateString()}
						</p>
					)}
				</>
			)}
		</section>
	);
}

/** Essential task averages by model, visible together without horizontal scrolling. */
function ModelStats({ rows }: { rows: Row[] }): JSX.Element {
	return (
		<section aria-label="By model" className="flex min-w-0 flex-col gap-2">
			<table
				aria-label="Task stats by model"
				className="w-full table-fixed text-xs tabular-nums sm:text-sm"
			>
				<thead className="text-muted-foreground text-xs">
					<tr className="border-b text-right">
						<th scope="col" className="w-[36%] py-2 pr-2 text-left font-normal">
							Model
						</th>
						{BY_MODEL.map((column) => (
							<th
								scope="col"
								key={column.head}
								className="wrap-anywhere px-1 py-2 font-normal"
							>
								{column.head}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr key={row.name} className="border-b text-right last:border-0">
							<th
								scope="row"
								className="wrap-anywhere py-2 pr-2 text-left font-normal"
							>
								{row.name}
							</th>
							{BY_MODEL.map((column) => (
								<td key={column.head} className="wrap-anywhere px-1 py-2">
									{column.cell(row)}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
			{rows.length === 0 && (
				<p className="text-muted-foreground text-sm">
					No tasks ended in this period.
				</p>
			)}
			<p className="text-muted-foreground text-xs">
				Tasks includes merges and removals. Time and cost are averages per task
				with recorded data. Duration runs from add to end; working time is the
				agent's active time. A dash means no recorded data.
			</p>
		</section>
	);
}
