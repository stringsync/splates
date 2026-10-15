import { useReactive } from "@webappwiz/react";
import { ChevronRightIcon } from "lucide-react";
import { type JSX, useEffect } from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#dev/components/ui/collapsible.tsx";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#dev/components/ui/tooltip.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { SkillVersion } from "../stats";
import type { NamedSystem } from "../systems";
import type { Advice } from "./stats-advice";
import {
	type Axis,
	type Bucket,
	decimal,
	PERIODS,
	percent,
	type Row,
	type StatsReport,
} from "./stats-report";
import { SystemNameChip } from "./systems";

/**
 * What to change, from how tasks have ended across every project: the one or
 * two acts that stand out this period, each with the figures behind it, and
 * everything else folded away.
 */
export function StatsPage({
	report,
	systems,
}: {
	report: StatsReport;
	/** The systems this project names, for each system's chip to open to. */
	systems: readonly NamedSystem[];
}): JSX.Element {
	const { stats, error, empty, period, ended, lead, rest, models, projects } =
		useReactive(
			report,
			(report) => ({
				stats: report.stats,
				error: report.error,
				empty: report.empty,
				period: report.period,
				ended: report.ended,
				lead: report.lead,
				rest: report.rest,
				models: report.models,
				projects: report.projects,
			}),
			["changed"],
		);
	// Read each time the page is shown: tasks end while it is away.
	useEffect(() => {
		void report.refresh();
	}, [report]);

	return (
		<section aria-label="stats" className="flex min-w-0 flex-col gap-6">
			<header className="flex flex-wrap items-center justify-between gap-2">
				<h2 className="font-medium text-sm">Stats</h2>
				<fieldset className="flex rounded-md border p-0.5">
					<legend className="sr-only">Period</legend>
					{PERIODS.map((each) => (
						<button
							key={each.label}
							type="button"
							aria-pressed={each === period}
							onClick={() => void report.choose(each)}
							className={cn(
								"rounded px-2 py-0.5 text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
								each === period && "bg-accent text-foreground",
							)}
						>
							{each.label}
						</button>
					))}
				</fieldset>
			</header>
			{error !== null && (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			)}
			{stats === null ? null : empty ? (
				<p className="text-muted-foreground text-sm">
					No task has ended since arbor started counting. Each one merged or
					removed from now on shows up here.
				</p>
			) : (
				<>
					<section aria-label="act on" className="flex flex-col gap-2">
						<h3 className="font-medium text-xs">Act on</h3>
						{lead.length === 0 ? (
							<p className="text-muted-foreground text-sm">
								Nothing stands out this period.
							</p>
						) : (
							lead.map((each) => (
								<AdviceCard
									key={each.id}
									advice={each}
									report={report}
									named={systems}
								/>
							))
						)}
					</section>
					<Collapsible
						render={<section aria-label="Everything else" />}
						className="group/rest flex flex-col gap-3"
					>
						<CollapsibleTrigger className="flex cursor-pointer items-center gap-1.5 font-medium text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
							<ChevronRightIcon className="size-3.5 transition-transform duration-150 group-data-[open]/rest:rotate-90" />
							Everything else
						</CollapsibleTrigger>
						<CollapsibleContent className="flex flex-col gap-6">
							<div className="grid items-start gap-3 sm:grid-cols-2">
								{rest.map((each) => (
									<AdviceCard
										key={each.id}
										advice={each}
										report={report}
										named={systems}
										className={cn(each.id === "hotspot" && "sm:col-span-2")}
									/>
								))}
							</div>
							{/* Which model to name on a todo, by how each did. */}
							<Breakdown
								title="By model"
								rows={models}
								columns={BY_MODEL}
								named={systems}
							/>
							<Breakdown
								title="By project"
								rows={projects}
								columns={BY_PROJECT}
								named={systems}
							/>
							{/* Whether a change to the arbor skill helped or hurt, on real work. */}
							<BySkillVersion versions={stats.skill} />
						</CollapsibleContent>
					</Collapsible>
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

/**
 * One card of advice, with what backs it: Questions per task charts its
 * figure bar by bar, once there are bars enough, the page's only chart, and
 * Questions by system lists every system.
 */
function AdviceCard({
	advice,
	report,
	named,
	className,
}: {
	advice: Advice;
	report: StatsReport;
	named: readonly NamedSystem[];
	className?: string;
}): JSX.Element {
	const { period, buckets, questionsAxis, systems } = useReactive(
		report,
		(report) => ({
			period: report.period,
			buckets: report.buckets,
			questionsAxis: report.questionsAxis,
			systems: report.systems,
		}),
		["changed"],
	);
	const questions = (bucket: Bucket) => bucket.questionsPerTask;
	return (
		<article
			aria-label={advice.title}
			className={cn(
				"flex min-w-0 flex-col gap-1 rounded-lg border p-3",
				advice.act === null && "text-muted-foreground",
				className,
			)}
		>
			<div className="flex items-baseline gap-2">
				<span className="text-xs">{advice.title}</span>
				{advice.system !== undefined && (
					<SystemNameChip name={advice.system} systems={named} />
				)}
				<span className="flex-1" />
				<span className="font-medium text-lg tabular-nums">
					{advice.figure ?? NONE}
				</span>
			</div>
			<p className="text-muted-foreground text-xs">{advice.detail}</p>
			{advice.trend !== null && <p className="text-xs">{advice.trend}</p>}
			{advice.short !== null && (
				<p className="text-muted-foreground text-xs">{advice.short}</p>
			)}
			{advice.act !== null && (
				<p className="text-foreground text-sm">{advice.act}</p>
			)}
			{advice.id === "course" && report.charted(questions) && (
				<Trend
					title="Questions per task"
					buckets={buckets}
					weekly={period.id === "all"}
					value={questions}
					shown={decimal}
					axis={questionsAxis}
				/>
			)}
			{advice.id === "hotspot" && systems.length > 0 && (
				<Breakdown
					title="By system"
					rows={systems}
					columns={BY_SYSTEM}
					named={named}
				/>
			)}
		</article>
	);
}

/**
 * One figure bar by bar, the oldest on the left, against a y-axis marked at
 * 0, halfway and its top.
 */
function Trend({
	title,
	buckets,
	weekly,
	value,
	shown,
	axis,
}: {
	title: string;
	buckets: Bucket[];
	/** Whether a bar is a week, so the newest is "This week" rather than "Now". */
	weekly: boolean;
	value: (bucket: Bucket) => number | null;
	shown: (value: number) => string;
	axis: Axis;
}): JSX.Element {
	return (
		<figure className="mt-2 flex flex-col gap-2 text-foreground">
			{/* The card it sits in names the figure. */}
			<figcaption className="font-medium text-xs">
				{weekly ? "Week by week" : "Over the period"}
			</figcaption>
			<div className="mt-1.5 flex gap-2">
				{/* The axis's labels, each level with its gridline. */}
				<div
					aria-hidden
					className="relative h-24 w-9 shrink-0 whitespace-nowrap text-right text-muted-foreground text-xs tabular-nums"
				>
					{axis.ticks.map((tick) => (
						<span
							key={tick.at}
							className="absolute right-0 translate-y-1/2 leading-none"
							style={{ bottom: `${(tick.at / axis.max) * 100}%` }}
						>
							{tick.label}
						</span>
					))}
				</div>
				<div className="relative flex h-24 min-w-0 flex-1 items-end gap-0.5 border-b">
					{axis.ticks.slice(1).map((tick) => (
						<div
							key={tick.at}
							aria-hidden
							className="pointer-events-none absolute inset-x-0 border-border/60 border-t border-dashed"
							style={{ bottom: `${(tick.at / axis.max) * 100}%` }}
						/>
					))}
					{buckets.map((bucket) => {
						const figure = value(bucket);
						const label =
							figure === null
								? `${bucket.label}: no tasks ended`
								: `${bucket.label}: ${title.toLowerCase()} ${shown(figure)}, of ${bucket.ended} task${bucket.ended === 1 ? "" : "s"}`;
						return (
							<Tooltip key={bucket.start}>
								<TooltipTrigger
									render={<div />}
									aria-label={label}
									className="group relative flex h-full min-w-0 flex-1 cursor-default items-end outline-none focus-visible:ring-2 focus-visible:ring-ring"
								>
									<div
										className={cn(
											"w-full rounded-t bg-primary group-hover:opacity-80",
											figure === null && "bg-transparent",
										)}
										style={{
											height:
												figure === null
													? 0
													: `${Math.min(figure / axis.max, 1) * 100}%`,
										}}
									/>
								</TooltipTrigger>
								<TooltipContent>{label}</TooltipContent>
							</Tooltip>
						);
					})}
				</div>
			</div>
			<div className="flex justify-between pl-11 text-muted-foreground text-xs tabular-nums">
				<span>{buckets[0]?.label}</span>
				<span>{weekly ? "This week" : "Now"}</span>
			</div>
		</figure>
	);
}

/** A figure there is not enough data for. */
const NONE = "\u2013";

/** A column of a breakdown, headed by what its figure counts. */
interface Column {
	head: string;
	cell: (row: Row) => string;
}

const ENDED: Column = { head: "Tasks ended", cell: (row) => String(row.ended) };
const QUESTIONS: Column = {
	head: "Questions per task",
	cell: (row) => figure(row.questionsPerTask, decimal),
};
const REVIEWS: Column = {
	head: "Reviews per task",
	cell: (row) => figure(row.reviewsPerTask, decimal),
};
const OVERTURNED: Column = {
	head: "Picks overturned",
	cell: (row) => figure(row.overturnedShare, percent),
};
const REMOVED: Column = {
	head: "Tasks removed",
	cell: (row) => figure(row.removedShare, percent),
};

/** Only what each table is read for: where questions come from, which model to name, nothing for a project. */
const BY_SYSTEM = [ENDED, QUESTIONS];
const BY_MODEL = [ENDED, QUESTIONS, REVIEWS, OVERTURNED, REMOVED];
const BY_PROJECT = [ENDED, REMOVED];

function figure(
	value: number | null,
	shown: (value: number) => string,
): string {
	return value === null ? NONE : shown(value);
}

/** Every model, project or system, with the figures it is read for over the period. */
function Breakdown({
	title,
	rows,
	columns,
	named,
}: {
	title: string;
	rows: Row[];
	columns: Column[];
	/** The systems this project names, for a system row's chip. */
	named: readonly NamedSystem[];
}): JSX.Element {
	return (
		<div className="mt-2 flex min-w-0 flex-col gap-2 text-foreground">
			<h3 className="font-medium text-xs">{title}</h3>
			<div className="overflow-x-auto">
				<table className="w-full text-sm tabular-nums [&_td+td]:pl-4 [&_th+th]:pl-4">
					<thead className="text-muted-foreground text-xs">
						<tr className="whitespace-nowrap border-b text-right">
							<th className="py-1 text-left font-normal">Name</th>
							{columns.map((column) => (
								<th key={column.head} className="py-1 font-normal">
									{column.head}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr key={row.name} className="border-b text-right last:border-0">
								<td className="max-w-40 truncate py-1 text-left">
									{row.system === undefined ? (
										row.name
									) : (
										<SystemNameChip name={row.system} systems={named} />
									)}
								</td>
								{columns.map((column) => (
									<td key={column.head} className="py-1">
										{column.cell(row)}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

/** How many skill versions the table compares, the newest first. */
const VERSIONS_SHOWN = 3;

/**
 * Each rule of the arbor skill a program can check, by how often the
 * conversations on each of the newest versions followed it every time, out of
 * those it applied in.
 */
function BySkillVersion({
	versions,
}: {
	versions: SkillVersion[];
}): JSX.Element {
	const shown = versions.slice(0, VERSIONS_SHOWN);
	return (
		<div className="mt-2 flex min-w-0 flex-col gap-2 text-foreground">
			<h3 className="font-medium text-xs">By skill version</h3>
			{shown.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No conversation has been checked yet. Each turn an agent ends in arbor
					dev from now on counts here.
				</p>
			) : (
				<div className="overflow-x-auto">
					<table className="w-full text-sm tabular-nums [&_td+td]:pl-4 [&_th+th]:pl-4">
						<thead className="text-muted-foreground text-xs">
							<tr className="whitespace-nowrap border-b text-right">
								<th className="py-1 text-left font-normal">Rule</th>
								{shown.map((version) => (
									<th
										key={version.skill ?? "unknown"}
										className="py-1 font-normal"
									>
										{version.skill ?? "Unknown"}
										<span className="block">
											{version.conversations} conversation
											{version.conversations === 1 ? "" : "s"}
										</span>
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{shown[0]?.checks.map((check, row) => (
								<tr
									key={check.id}
									className="border-b text-right last:border-0"
								>
									<td className="py-1 text-left">{check.rule}</td>
									{shown.map((version) => {
										const rate = version.checks[row];
										return (
											<td key={version.skill ?? "unknown"} className="py-1">
												{rate === undefined || rate.applied === 0
													? NONE
													: `${percent(rate.passed / rate.applied)} of ${rate.applied}`}
											</td>
										);
									})}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}
