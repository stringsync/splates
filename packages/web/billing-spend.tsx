import type {
	BillingView,
	SpendReport,
	SpendTotal,
} from "@stringsync/splates-server/spend";
import { useReactive } from "@webappwiz/react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { type JSX, useEffect, useMemo, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { Figures } from "./billing-figures";
import { Headline } from "./billing-headline";
import { ByProject } from "./billing-projects";
import { Sources } from "./billing-sources";
import { type Range, SpendController } from "./billing-spend-controller";
import {
	byProvider,
	Currency,
	colorOf,
	dayOf,
	nameOf,
	type ProviderSpend,
	type Sum,
	shortDay,
	spanTitle,
	whole,
} from "./billing-sums";
import { SpendTrend } from "./billing-trend";
import {
	NativeSelect,
	NativeSelectOption,
} from "./components/ui/native-select";
import { METER_COLUMNS, Meter } from "./meter";
import { useReading } from "./page-readings";
import { PHONE_HEADING } from "./phone-rows";

const RANGES: { range: Range; label: string }[] = [
	{ range: "day", label: "Today" },
	{ range: "week", label: "7 days" },
	{ range: "month", label: "This month" },
	{ range: "custom", label: "Custom" },
];

const DAY = 86_400_000;

/**
 * The money spent in a range, from the ledger: one figure for the whole
 * range, stepping back or forward a day, week or month at a time, split
 * into what was billed and what plan use would cost at API
 * list prices, with where this month is headed; then each provider's share,
 * opening onto its services; then the days; then where billed amounts come
 * from.
 */
export function SpendSection(): JSX.Element {
	// What it last read, kept across visits, so it opens on that and reads behind.
	const last = useReading("spend", () => ({
		range: "month" as Range,
		back: 0,
		report: null as SpendReport | null,
		sources: null as BillingView | null,
	}));
	const [controller] = useState(() => new SpendController(last));
	useEffect(() => {
		controller.open();
		return () => controller.dispose();
	}, [controller]);
	const {
		range,
		back,
		from,
		to,
		report,
		error,
		sources,
		pulling,
		sourceError,
		span,
	} = useReactive(
		controller,
		(each) => ({
			range: each.range,
			back: each.back,
			from: each.from,
			to: each.to,
			report: each.report,
			error: each.error,
			sources: each.sources,
			pulling: each.pulling,
			sourceError: each.sourceError,
			span: each.span,
		}),
		["changed"],
	);
	const providers = useMemo(() => byProvider(report?.services ?? []), [report]);
	const title =
		range === "custom"
			? span === null
				? "Custom range"
				: `${shortDay(span.since.slice(0, 10))} to ${shortDay(
						dayOf(Date.parse(span.until) - DAY),
					)}`
			: spanTitle(range, Date.now(), back);
	return (
		<Currency.Provider value={report?.currency ?? "USD"}>
			<section aria-label="spend" className="flex min-w-0 flex-col gap-4">
				<header className="flex flex-wrap items-center gap-2">
					<h2 className={cn("font-medium text-sm", PHONE_HEADING)}>Spend</h2>
					<fieldset
						aria-label="range"
						className="ml-auto flex flex-wrap items-center gap-0.5 rounded-lg bg-muted p-0.5"
					>
						{RANGES.map((each) => (
							<button
								key={each.range}
								type="button"
								aria-pressed={range === each.range}
								onClick={() => controller.setRange(each.range)}
								className={cn(
									"rounded-md px-2.5 py-1 text-xs",
									range === each.range
										? "bg-background font-medium shadow-xs"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								{each.label}
							</button>
						))}
					</fieldset>
					{sources !== null && (
						<NativeSelect
							size="sm"
							aria-label="currency"
							value={sources.currency}
							onChange={(event) =>
								controller.changeCurrency(event.target.value)
							}
						>
							{sources.currencies.map((each) => (
								<NativeSelectOption key={each} value={each}>
									{each}
								</NativeSelectOption>
							))}
						</NativeSelect>
					)}
				</header>
				{range === "custom" && (
					<div className="flex flex-wrap items-center gap-2 text-xs">
						<input
							type="date"
							aria-label="from"
							value={from}
							onChange={(event) => controller.setFrom(event.target.value)}
							className="rounded-md border bg-transparent px-2 py-1"
						/>
						to
						<input
							type="date"
							aria-label="to"
							value={to}
							onChange={(event) => controller.setTo(event.target.value)}
							className="rounded-md border bg-transparent px-2 py-1"
						/>
					</div>
				)}
				{error !== null && (
					<p role="alert" className="text-destructive text-sm">
						Could not read spend: {error}
					</p>
				)}
				<Headline
					title={
						range === "custom" ? (
							title
						) : (
							<>
								<Button
									variant="ghost"
									size="icon-xs"
									aria-label="earlier"
									onClick={() => controller.earlier()}
								>
									<ChevronLeftIcon />
								</Button>
								<span>{title}</span>
								<Button
									variant="ghost"
									size="icon-xs"
									aria-label="later"
									// Nothing is spent after today.
									disabled={back === 0}
									onClick={() => controller.later()}
								>
									<ChevronRightIcon />
								</Button>
							</>
						)
					}
					report={report}
					reading={report === null && error === null && span !== null}
					picking={span === null}
					projecting={range === "month" && back === 0}
				/>
				{report !== null && providers.length > 0 && (
					<Breakdown providers={providers} />
				)}
				{report !== null && <ByProject projects={report.projects} />}
				{report !== null && span !== null && range !== "day" && (
					<SpendTrend
						days={report.days}
						since={span.since}
						until={span.until}
					/>
				)}
				<Sources
					sources={sources}
					pulling={pulling}
					error={sourceError}
					onPull={() => controller.pull()}
				/>
			</section>
		</Currency.Provider>
	);
}

/**
 * Each provider's share of the range, the costliest first, each opening onto
 * its services: laid out in `METER_COLUMNS`, so every bar has the page's
 * other meters' x, width and thickness.
 */
function Breakdown({ providers }: { providers: ProviderSpend[] }): JSX.Element {
	const all = providers.reduce((total, each) => total + whole(each), 0);
	return (
		<div className="flex flex-col rounded-xl border bg-card shadow-xs">
			<h3 className="border-b px-4 py-2.5 font-medium text-sm">By provider</h3>
			<ul className={cn("grid gap-x-3 px-4 py-1", METER_COLUMNS)}>
				{providers.map((each) => (
					<ProviderRow key={each.provider} spent={each} all={all} />
				))}
			</ul>
		</div>
	);
}

/** One provider: its share, what it cost, and the services under it once opened. */
function ProviderRow({
	spent,
	all,
}: {
	spent: ProviderSpend;
	all: number;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	const color = colorOf(spent.provider);
	return (
		<li className="col-span-full grid grid-cols-subgrid border-b last:border-b-0">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className="col-span-full grid grid-cols-subgrid items-center py-3 text-left max-md:gap-y-2"
			>
				<span className="flex min-w-0 items-center gap-2">
					<span
						aria-hidden
						className="size-2.5 shrink-0 rounded-sm"
						style={{ background: color }}
					/>
					<span className="flex min-w-0 flex-col">
						<span className="truncate font-medium text-sm">
							{nameOf(spent.provider)}
						</span>
						<Kind spent={spent} />
					</span>
				</span>
				<Meter
					used={all === 0 ? 0 : whole(spent) / all}
					color={color}
					className="max-md:col-span-full max-md:row-start-2"
				/>
				<Figures part={whole(spent)} of={all}>
					<ChevronRightIcon
						aria-hidden
						className={cn(
							"size-4 shrink-0 self-center text-muted-foreground transition-transform",
							open && "rotate-90",
						)}
					/>
				</Figures>
			</button>
			{open && (
				<ul className="col-span-full grid grid-cols-subgrid pb-3">
					{spent.services.map((row) => (
						<ServiceRow
							key={row.service}
							row={row}
							of={whole(spent)}
							color={color}
						/>
					))}
				</ul>
			)}
		</li>
	);
}

function ServiceRow({
	row,
	of,
	color,
}: {
	row: SpendTotal;
	of: number;
	color: string;
}): JSX.Element {
	return (
		<li className="col-span-full grid grid-cols-subgrid items-center py-1.5 max-md:gap-y-2">
			<span className="flex min-w-0 flex-col pl-[1.125rem]">
				<code
					title={row.service ?? undefined}
					className="truncate font-mono text-[13px]"
				>
					{row.service}
				</code>
				<Kind spent={row} />
			</span>
			<Meter
				used={of === 0 ? 0 : whole(row) / of}
				color={color}
				className="opacity-70 max-md:col-span-full max-md:row-start-2"
			/>
			<Figures part={whole(row)} of={of}>
				{/* As wide as a provider's chevron, so the figures line up. */}
				<span aria-hidden className="size-4 shrink-0" />
			</Figures>
		</li>
	);
}

/** Whether a figure is money billed, expected with no bill yet, or both. */
function Kind({ spent }: { spent: Sum }): JSX.Element {
	return (
		<span className="flex gap-1 text-muted-foreground text-xs">
			{spent.billed > 0 && <span>billed</span>}
			{spent.billed > 0 && spent.expected > 0 && <span>+</span>}
			{spent.expected > 0 && (
				<span title="A plan's renewal at list price, or a subscription not invoiced yet">
					expected
				</span>
			)}
		</span>
	);
}
