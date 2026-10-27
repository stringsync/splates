import type {
	BillingView,
	SpendReport,
	SpendTotal,
} from "@stringsync/splates-server/spend";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { type JSX, type ReactNode, useEffect, useMemo, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { billing, pullBilling, setCurrency, spend } from "./api";
import { Sources } from "./billing-sources";
import {
	byProvider,
	Currency,
	colorOf,
	dayOf,
	monthEnd,
	nameOf,
	type ProviderSpend,
	projected,
	type Span,
	type Sum,
	shortDay,
	spanOf,
	spanTitle,
	sum,
	useMoney,
	whole,
} from "./billing-sums";
import { SpendTrend } from "./billing-trend";
import { StillWaiting } from "./countdown";
import { METER_COLUMNS, Meter } from "./meter";
import { useReading } from "./page-readings";
import { PHONE_HEADING } from "./phone-rows";

type Range = Span | "custom";

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
	const [range, setRange] = useState<Range>(last.range);
	// How many whole spans before the one ending today the page shows.
	const [back, setBack] = useState(last.back);
	const [from, setFrom] = useState("");
	const [to, setTo] = useState("");
	// Held while it reads again, so a change of range never blanks the figures.
	const [report, setReport] = useState<SpendReport | null>(
		range === "custom" ? null : last.report,
	);
	const [error, setError] = useState<string | null>(null);
	const [sources, setSources] = useState<BillingView | null>(last.sources);
	useEffect(() => {
		Object.assign(last, { range, back, report, sources });
	}, [last, range, back, report, sources]);
	const [pulling, setPulling] = useState(false);
	const [sourceError, setSourceError] = useState<string | null>(null);
	const currency = sources?.currency ?? null;
	const span = useMemo(() => {
		if (range !== "custom") {
			return spanOf(range, Date.now(), back);
		}
		const since = Date.parse(from);
		const until = Date.parse(to);
		return Number.isNaN(since) || Number.isNaN(until) || until < since
			? null
			: {
					since: new Date(since).toISOString(),
					until: new Date(until + DAY).toISOString(),
				};
	}, [range, back, from, to]);
	const pull = (isCurrent: () => boolean = () => true): void => {
		setPulling(true);
		setSourceError(null);
		pullBilling()
			.then((read) => isCurrent() && setSources(read))
			.catch((caught: Error) => isCurrent() && setSourceError(caught.message))
			.finally(() => isCurrent() && setPulling(false));
	};
	// Read what was last pulled at once, then pull again, so the figures catch up.
	// biome-ignore lint/correctness/useExhaustiveDependencies: pulls once, on opening
	useEffect(() => {
		let current = true;
		billing()
			.then((read) => current && setSources(read))
			.catch((caught: Error) => current && setSourceError(caught.message));
		pull(() => current);
		return () => {
			current = false;
		};
	}, []);
	const pulledAt = sources?.pulledAt ?? null;
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new currency or pull is when to read again
	useEffect(() => {
		if (span === null) {
			return;
		}
		let current = true;
		spend(span.since, span.until).then(
			(read) => {
				if (current) {
					setReport(read);
					setError(null);
				}
			},
			(caught: Error) => current && setError(caught.message),
		);
		return () => {
			current = false;
		};
	}, [span, currency, pulledAt]);
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
								onClick={() => {
									setRange(each.range);
									setBack(0);
								}}
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
						<select
							aria-label="currency"
							value={sources.currency}
							onChange={(event) =>
								setCurrency(event.target.value).then(
									setSources,
									(caught: Error) => setSourceError(caught.message),
								)
							}
							className="rounded-md border bg-transparent px-2 py-1 text-xs"
						>
							{sources.currencies.map((each) => (
								<option key={each} value={each}>
									{each}
								</option>
							))}
						</select>
					)}
				</header>
				{range === "custom" && (
					<div className="flex flex-wrap items-center gap-2 text-xs">
						<input
							type="date"
							aria-label="from"
							value={from}
							onChange={(event) => setFrom(event.target.value)}
							className="rounded-md border bg-transparent px-2 py-1"
						/>
						to
						<input
							type="date"
							aria-label="to"
							value={to}
							onChange={(event) => setTo(event.target.value)}
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
									onClick={() => setBack(back + 1)}
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
									onClick={() => setBack(back - 1)}
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
					onPull={() => pull()}
				/>
			</section>
		</Currency.Provider>
	);
}

/**
 * The range's one figure, all it cost, what was billed and what is an
 * estimate under it, and for this month where it is headed at this pace.
 */
function Headline({
	title,
	report,
	reading,
	picking,
	projecting,
}: {
	title: ReactNode;
	report: SpendReport | null;
	reading: boolean;
	picking: boolean;
	projecting: boolean;
}): JSX.Element {
	const dollars = useMoney();
	const total = sum(report?.services ?? []);
	const all = whole(total);
	const ahead =
		projecting && report !== null ? projected(all, Date.now()) : null;
	return (
		<section
			aria-label="total"
			className="flex flex-col gap-4 rounded-xl border bg-card px-5 py-5 shadow-xs"
		>
			<div className="flex flex-wrap items-end gap-x-10 gap-y-4">
				<div className="flex flex-col gap-1">
					<span className="flex items-center gap-1 text-muted-foreground text-sm">
						{title}
					</span>
					{report === null ? (
						<span
							role={reading ? "status" : undefined}
							className="flex h-12 items-center gap-3 text-muted-foreground text-sm"
						>
							{picking
								? "Pick the first and last day to total."
								: reading
									? "Reading spend…"
									: "Not read"}
							{!picking && reading && <StillWaiting />}
						</span>
					) : (
						<span className="font-semibold text-5xl leading-none tracking-tight">
							{dollars(all)}
						</span>
					)}
				</div>
				{ahead !== null && (
					<div className="flex flex-col gap-1">
						<span className="text-muted-foreground text-sm">
							Projected by {monthEnd(Date.now())}
						</span>
						<span className="font-medium text-2xl leading-none tracking-tight text-muted-foreground">
							{dollars(Math.round(ahead * 100) / 100)}
						</span>
					</div>
				)}
			</div>
			{report !== null && (
				<div className="flex flex-col gap-1 border-t pt-3 text-sm">
					<p className="flex flex-wrap gap-x-4 gap-y-1">
						<span>
							<span className="font-medium">{dollars(total.billed)}</span>{" "}
							<span className="text-muted-foreground">billed</span>
						</span>
						<span title="What plan use would cost at API list prices, not money paid">
							<span className="font-medium">{dollars(total.equivalent)}</span>{" "}
							<span className="text-muted-foreground">
								estimated at API list prices
							</span>
						</span>
					</p>
					<p className="text-muted-foreground text-xs">
						{all === 0
							? "Nothing spent in this range yet. Agents' turns and pulled provider bills land here. "
							: ""}
						Updated {new Date(report.updated).toLocaleTimeString()}
						{report.rateDate !== null &&
							`. Converted to ${report.currency} at the rate of each day, the latest from ${report.rateDate}.`}
					</p>
					{report.rateError !== null && (
						<p role="alert" className="text-destructive text-xs">
							Shown in USD: {report.rateError}
						</p>
					)}
				</div>
			)}
		</section>
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

/** Whether a figure is money billed, an estimate at list prices, or both. */
function Kind({ spent }: { spent: Sum }): JSX.Element {
	return (
		<span className="flex gap-1 text-muted-foreground text-xs">
			{spent.billed > 0 && <span>billed</span>}
			{spent.billed > 0 && spent.equivalent > 0 && <span>+</span>}
			{spent.equivalent > 0 && (
				<span title="What plan use would cost at API list prices, not money paid">
					estimate
				</span>
			)}
		</span>
	);
}

/** What `part` cost and its share of `of`, then `children`, in the meter's last column. */
function Figures({
	part,
	of,
	children,
}: {
	part: number;
	of: number;
	children: ReactNode;
}): JSX.Element {
	const dollars = useMoney(true);
	return (
		<span className="flex items-baseline justify-end gap-2 tabular-nums max-md:col-start-2 max-md:row-start-1">
			<span className="font-medium text-sm">{dollars(part)}</span>
			<span className="w-9 text-right text-muted-foreground text-xs">
				{of === 0 ? "" : `${Math.round((part / of) * 100)}%`}
			</span>
			{children}
		</span>
	);
}
