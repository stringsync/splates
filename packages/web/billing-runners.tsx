import type {
	RunnerImage,
	RunnerLife,
	RunnerMonth,
	RunnerPeriod,
	RunnerSplit,
	RunnersReport,
} from "@stringsync/splates-server/spend";
import { dollars, sizeLabel } from "@stringsync/splates-server/workers/browser";
import { useDisposerEffect, useReactive } from "@webappwiz/react";
import { Trash2Icon } from "lucide-react";
import type { JSX } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#web/components/ui/tooltip.tsx";
import { cn } from "#web/lib/utils.ts";
import { shortDay } from "./billing-sums";
import { ReadFailed, ReadingNow } from "./countdown";
import { useMinute } from "./hooks/use-minute";
import { useReading } from "./page-readings";
import { PHONE_HEADING } from "./phone-rows";
import { Refusal, useRefusals } from "./refusal";
import { type RunnerPer, RunnersView } from "./runners-view";
import { axis } from "./stats-report";

const PERS: { per: RunnerPer; label: string }[] = [
	{ per: "day", label: "Days" },
	{ per: "month", label: "Months" },
];

/** How far an estimate may be off its bill, in percent, before it is shown amber. */
const GAP_WARN = 20;

const HOUR = 3_600_000;

/** How many runners the list shows before Show all, the newest. */
const NEWEST = 8;

/**
 * Every runner made, from every project: each with what it cost, a running
 * one with its cost ticking and Delete; then runner-hours and dollars by day
 * or month, a bar picked opening who its cost went to; then each month's
 * estimate beside what the cloud billed for it. Every dollar here is an
 * estimate at the price the cloud's API gave when the runner was made.
 */
export function RunnersSection(): JSX.Element {
	const view = useReading("runners", () => new RunnersView());
	useDisposerEffect((disposer) => disposer.use(view.watch()), [view]);
	const { report, error, stopping, all } = useReactive(
		view,
		({ report, error, stopping, all }) => ({ report, error, stopping, all }),
		["changed"],
	);
	const { refusals, refuse } = useRefusals<string>();
	return (
		<section aria-label="runners" className="flex min-w-0 flex-col gap-4">
			<header className="flex flex-wrap items-center gap-2">
				<h2 className={cn("font-medium text-sm", PHONE_HEADING)}>Runners</h2>
				<span className="text-muted-foreground text-xs">
					Every runner made for heavy jobs, from every project, in US dollars at
					the price the cloud gave as each was made.
				</span>
			</header>
			{error !== null && <ReadFailed error={error} />}
			{report === null && error === null && (
				<ReadingNow label="Reading runners…" />
			)}
			{report !== null && report.runners.length === 0 && (
				<p className="text-muted-foreground text-sm">
					No runner made yet: one is made when a heavy job or an agent needs it.
				</p>
			)}
			{report !== null && report.images.length > 0 && (
				<RunnerImages images={report.images} />
			)}
			{report !== null && report.runners.length > 0 && (
				<>
					<RunnerList
						runners={all ? report.runners : report.runners.slice(0, NEWEST)}
						stopping={stopping}
						refusals={refusals}
						onStop={(id) =>
							void view
								.stop(id)
								.catch((caught) => refuse(id, "Not stopped", caught))
						}
					/>
					{!all && report.runners.length > NEWEST && (
						<Button
							variant="ghost"
							size="sm"
							className="self-start text-muted-foreground"
							onClick={() => view.showAll()}
						>
							Show all {report.runners.length} runners
						</Button>
					)}
					<RunnerHistory report={report} view={view} />
					<BillBeside months={report.months} />
				</>
			)}
		</section>
	);
}

/** The snapshots runners boot from, each with its size and what it costs to keep a month. */
function RunnerImages({ images }: { images: RunnerImage[] }): JSX.Element {
	return (
		<ul
			aria-label="runner images"
			className="flex flex-col divide-y rounded-xl border bg-card shadow-xs"
		>
			{images.map((image) => (
				<li
					key={image.id}
					className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm"
				>
					<span className="font-medium">Runner image</span>
					<span className="text-muted-foreground text-xs">
						{image.gigabytes.toFixed(1)} GB kept
					</span>
					<span className="ml-auto tabular-nums">
						{dollars(image.dollarsPerMonth)}/month
					</span>
				</li>
			))}
		</ul>
	);
}

/** Each runner, the newest first, a running one with Delete. */
function RunnerList({
	runners,
	stopping,
	refusals,
	onStop,
}: {
	runners: RunnerLife[];
	stopping: ReadonlySet<string>;
	refusals: ReadonlyMap<string, string>;
	onStop: (id: string) => void;
}): JSX.Element {
	const now = useMinute();
	return (
		<ul
			aria-label="runner list"
			className="flex flex-col divide-y rounded-xl border bg-card shadow-xs"
		>
			{runners.map((runner) => {
				const up = runner.until === null;
				const hours = up
					? Math.max(0, now - Date.parse(runner.from)) / HOUR
					: runner.hours;
				return (
					<li
						key={runner.id}
						aria-label={runner.id}
						className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm"
					>
						<span className="flex min-w-40 flex-col">
							{runner.size === null ? (
								<code className="font-mono text-[13px]">{runner.type}</code>
							) : (
								<span className="tabular-nums">
									{sizeLabel(runner.size, runner.dollarsPerHour)}
								</span>
							)}
							<span className="text-muted-foreground text-xs">{runner.id}</span>
						</span>
						<span className="flex min-w-44 flex-col text-xs tabular-nums">
							<span>Started {when(runner.from)}</span>
							{up ? (
								<span className="text-primary">
									{stopping.has(runner.id)
										? "Deleting…"
										: `up now, ${span(hours)}`}
								</span>
							) : (
								<span className="text-muted-foreground">
									Stopped {when(runner.until ?? runner.from)}
								</span>
							)}
						</span>
						<span className="tabular-nums">{hours.toFixed(2)} h</span>
						<span className="font-medium tabular-nums">
							{dollars(hours * runner.dollarsPerHour)}
						</span>
						<span className="text-muted-foreground text-xs tabular-nums">
							{runner.jobs} {runner.jobs === 1 ? "job" : "jobs"}
							{runner.size === null && ` · ${dollars(runner.dollarsPerHour)}/h`}
						</span>
						{up && (
							<Button
								variant="ghost"
								size="sm"
								className="ml-auto text-muted-foreground hover:text-destructive"
								title="Takes no new jobs, and is deleted once those on it end"
								disabled={stopping.has(runner.id)}
								onClick={() => onStop(runner.id)}
							>
								<Trash2Icon /> Delete
							</Button>
						)}
						<Refusal refusal={refusals.get(runner.id)} className="w-full" />
					</li>
				);
			})}
		</ul>
	);
}

/**
 * Runner dollars per day for the last 90 days, or per month for as long
 * as the ledger goes, a bar picked showing who that day's or month's cost
 * went to.
 */
function RunnerHistory({
	report,
	view,
}: {
	report: RunnersReport;
	view: RunnersView;
}): JSX.Element {
	const { per, picked } = useReactive(
		view,
		({ per, picked }) => ({ per, picked }),
		["changed"],
	);
	const periods: RunnerPeriod[] = per === "day" ? report.days : report.months;
	const splits = per === "day" ? report.split.days : report.split.months;
	const shown =
		periods.find((each) => each.period === picked) ?? periods.at(-1) ?? null;
	const name = (period: string) =>
		per === "day" ? shortDay(period) : monthName(period);
	const top = axis(Math.max(0, ...periods.map((each) => each.dollars)));
	return (
		<figure
			aria-label="Runners per period"
			className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-3 shadow-xs"
		>
			<figcaption className="flex flex-wrap items-center gap-2">
				<span className="font-medium text-sm">
					Per {per === "day" ? "day" : "month"}
				</span>
				<fieldset
					aria-label="per"
					className="ml-auto flex items-center gap-0.5 rounded-lg bg-muted p-0.5"
				>
					{PERS.map((each) => (
						<button
							key={each.per}
							type="button"
							aria-pressed={per === each.per}
							onClick={() => view.showPer(each.per)}
							className={cn(
								"rounded-md px-2.5 py-1 text-xs",
								per === each.per
									? "bg-background font-medium shadow-xs"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							{each.label}
						</button>
					))}
				</fieldset>
			</figcaption>
			<div className="flex gap-2">
				<div
					aria-hidden
					className="relative h-32 w-12 shrink-0 text-right text-muted-foreground text-xs tabular-nums"
				>
					{top.ticks.map((tick) => (
						<span
							key={tick.at}
							className="absolute right-0 translate-y-1/2 leading-none"
							style={{ bottom: `${(tick.at / top.max) * 100}%` }}
						>
							{dollars(tick.at)}
						</span>
					))}
				</div>
				<div className="relative h-32 min-w-0 flex-1 border-b">
					<div className="absolute inset-0 flex">
						{periods.map((each) => (
							<PeriodBar
								key={each.period}
								period={each}
								name={name(each.period)}
								max={top.max}
								picked={each.period === shown?.period}
								onPick={() => view.pick(each.period)}
							/>
						))}
					</div>
				</div>
			</div>
			<div className="flex justify-between pl-14 text-muted-foreground text-xs tabular-nums">
				<span>{periods[0] === undefined ? "" : name(periods[0].period)}</span>
				<span>
					{periods.at(-1) === undefined
						? ""
						: name(periods.at(-1)?.period ?? "")}
				</span>
			</div>
			{shown !== null && (
				<TaskSplit
					title={name(shown.period)}
					period={shown}
					split={splits.find((each) => each.period === shown.period) ?? null}
				/>
			)}
		</figure>
	);
}

/** One day's or month's column, the whole column answering hover and a click. */
function PeriodBar({
	period,
	name,
	max,
	picked,
	onPick,
}: {
	period: RunnerPeriod;
	name: string;
	max: number;
	picked: boolean;
	onPick: () => void;
}): JSX.Element {
	const label = `${name}: ${dollars(period.dollars)}, ${period.hours.toFixed(1)} runner-hours`;
	return (
		<Tooltip>
			<TooltipTrigger
				render={<button type="button" />}
				aria-label={label}
				aria-pressed={picked}
				onClick={onPick}
				className={cn(
					"flex h-full min-w-0 flex-1 cursor-pointer flex-col justify-end outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring",
					picked && "bg-foreground/5",
				)}
			>
				<div
					className={cn(
						"w-3/5 max-w-6 self-center rounded-t-[4px]",
						picked ? "bg-primary" : "bg-primary/60",
					)}
					style={{
						height: `${max === 0 ? 0 : (period.dollars / max) * 100}%`,
					}}
				/>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

/**
 * Who a day's or month's runner cost went to, by project and task, each
 * runner's idle time shared among the tasks whose jobs ran on it that hour.
 */
function TaskSplit({
	title,
	period,
	split,
}: {
	title: string;
	period: RunnerPeriod;
	split: RunnerSplit | null;
}): JSX.Element {
	return (
		<div className="flex flex-col gap-1.5 border-t pt-3">
			<p className="flex flex-wrap items-baseline gap-x-2 text-sm">
				<span className="font-medium">{title}</span>
				<span className="text-muted-foreground text-xs tabular-nums">
					{dollars(period.dollars)}, {period.hours.toFixed(1)} runner-hours
				</span>
			</p>
			{split === null || split.shares.length === 0 ? (
				<p className="text-muted-foreground text-xs">No runner was up.</p>
			) : (
				<ul aria-label="by task" className="flex flex-col gap-1">
					{split.shares.map((share) => (
						<li
							key={`${share.project}\0${share.task}`}
							className="flex items-baseline gap-2 text-sm"
						>
							<span className="min-w-0 truncate">
								{share.project === null
									? "Idle, no job ran that hour"
									: (share.task ?? "No task")}
							</span>
							{share.project !== null && (
								<span className="truncate text-muted-foreground text-xs">
									{share.project.split("/").pop()} · {span(share.slotHours)} of
									jobs
								</span>
							)}
							<span className="ml-auto tabular-nums">
								{dollars(share.dollars)}
							</span>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

/** Each month's estimate beside what the cloud billed for it, the newest first. */
function BillBeside({ months }: { months: RunnerMonth[] }): JSX.Element {
	return (
		<div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
			<table
				aria-label="estimate beside the bill"
				className="w-full text-sm max-md:text-xs [&_td]:max-md:px-2 [&_th]:max-md:px-2"
			>
				<thead className="text-muted-foreground text-xs">
					<tr className="border-b">
						<th className="px-4 py-2 text-left font-normal">Month</th>
						<th className="px-4 py-2 text-right font-normal max-md:hidden">
							Runner-hours
						</th>
						<th className="px-4 py-2 text-right font-normal">Estimate</th>
						<th className="px-4 py-2 text-right font-normal">Billed</th>
						<th className="px-4 py-2 text-right font-normal">Off by</th>
					</tr>
				</thead>
				<tbody className="tabular-nums">
					{[...months].reverse().map((month) => (
						<tr key={month.period} className="border-b last:border-b-0">
							<td className="px-4 py-2">{monthName(month.period)}</td>
							<td className="px-4 py-2 text-right max-md:hidden">
								{month.hours.toFixed(1)}
							</td>
							<td className="px-4 py-2 text-right">{dollars(month.dollars)}</td>
							<td className="px-4 py-2 text-right">
								{month.billed === null ? (
									<span className="whitespace-nowrap text-muted-foreground text-xs">
										not billed yet
									</span>
								) : (
									dollars(month.billed)
								)}
							</td>
							<td
								className={cn(
									"px-4 py-2 text-right",
									month.gap !== null &&
										Math.abs(month.gap) > GAP_WARN &&
										"text-warning",
								)}
							>
								{month.gap === null
									? ""
									: `${month.gap > 0 ? "+" : ""}${Math.round(month.gap)}%`}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/** `2026-10-01` as `Oct 2026`. */
function monthName(period: string): string {
	return new Date(`${period}T00:00:00Z`).toLocaleDateString("en-US", {
		month: "short",
		year: "numeric",
		timeZone: "UTC",
	});
}

/** An ISO timestamp as `Oct 22, 10:04`, local time. */
function when(at: string): string {
	return new Date(at).toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
}

/** Hours as `2h 14m`, or `40m` under an hour. */
function span(hours: number): string {
	const minutes = Math.floor(hours * 60);
	return minutes < 60
		? `${minutes}m`
		: `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
