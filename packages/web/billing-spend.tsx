import type {
	BillingView,
	PlanView,
	SpendReport,
	SpendTotal,
} from "@splates/server/spend";
import { useReactive } from "core/react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { type JSX, type ReactNode, useEffect, useMemo, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { Figures } from "./billing-figures";
import { Headline } from "./billing-headline";
import { Sources } from "./billing-sources";
import { type Range, SpendController } from "./billing-spend-controller";
import {
	apiTotal,
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
import { UnusedQuota } from "./billing-unused-quota";
import { Meter } from "./meter";
import { useReading } from "./page-readings";
import { PHONE_HEADING } from "./phone-rows";

const RANGES: { range: Range; label: string }[] = [
	{ range: "day", label: "Today" },
	{ range: "week", label: "7 days" },
	{ range: "month", label: "This month" },
	{ range: "custom", label: "Custom" },
];

const DAY = 86_400_000;

/** Four columns on desktop (name, meter, You pay, At API); two on mobile with the meter below. */
const BREAKDOWN_COLUMNS =
	"grid-cols-[9.5rem_1fr_5.5rem_6.5rem] max-md:grid-cols-[minmax(0,1fr)_auto]";

/**
 * The money spent in a range, from the ledger: one figure for the whole
 * range, stepping back or forward a day, week or month at a time, comparing
 * what was paid against what the same usage would cost at API list prices,
 * with where this month is headed; then each agent's plan limits and unused
 * quota; then each provider's share, opening onto its services; then the
 * days; then agent plans and where billed amounts come from.
 */
export function SpendSection({
	planLimits,
}: {
	planLimits?: ReactNode;
}): JSX.Element {
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
		savingPlan,
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
			savingPlan: each.savingPlan,
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
					plans={sources?.plans ?? []}
				/>
				{planLimits}
				<UnusedQuota
					refreshKey={`${sources?.currency ?? "USD"}:${sources?.plans?.map((each) => `${each.provider}:${each.amount ?? ""}`).join(",") ?? ""}`}
				/>
				{report !== null && providers.length > 0 && (
					<Breakdown
						providers={providers}
						plans={sources?.plans ?? []}
						upcoming={report.upcoming}
					/>
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
					savingPlan={savingPlan}
					error={sourceError}
					onPull={() => controller.pull()}
					onSavePlan={(provider, amount, renewalDay) =>
						controller.savePlan(provider, amount, renewalDay)
					}
					onClearPlan={(provider) => controller.removePlan(provider)}
				/>
			</section>
		</Currency.Provider>
	);
}

/**
 * Each provider's actual spend and API-equivalent value in the range, opening
 * onto its services and models.
 */
function Breakdown({
	providers,
	plans,
	upcoming,
}: {
	providers: ProviderSpend[];
	plans: readonly PlanView[];
	upcoming: readonly SpendTotal[];
}): JSX.Element {
	const all = providers.reduce((total, each) => total + whole(each), 0);
	return (
		<div className="flex flex-col rounded-xl border bg-card shadow-xs">
			<div
				className={cn(
					"grid items-center gap-x-3 border-b px-4 py-2.5",
					BREAKDOWN_COLUMNS,
				)}
			>
				<h3 className="font-medium text-sm">By provider</h3>
				<span aria-hidden className="max-md:hidden" />
				<span className="text-right font-medium text-[11px] text-muted-foreground uppercase tracking-wider max-md:hidden">
					You pay
				</span>
				<span className="pr-5 text-right font-medium text-[11px] text-muted-foreground uppercase tracking-wider max-md:hidden">
					At API
				</span>
			</div>
			<ul className={cn("grid gap-x-3 px-4 py-1", BREAKDOWN_COLUMNS)}>
				{providers.map((each) => (
					<ProviderRow
						key={each.provider}
						spent={each}
						all={all}
						plan={plans.find((plan) => plan.provider === each.provider)}
						hasUpcoming={upcoming.some((row) => row.provider === each.provider)}
					/>
				))}
			</ul>
		</div>
	);
}

/** One provider: its share, what was paid beside its API-equivalent cost, and its services once opened. */
function ProviderRow({
	spent,
	all,
	plan,
	hasUpcoming,
}: {
	spent: ProviderSpend;
	all: number;
	plan?: PlanView;
	hasUpcoming: boolean;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	const color = colorOf(spent.provider);
	const paid = whole(spent);
	const atApi = apiTotal(spent);
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
						<Kind spent={spent} plan={plan} hasUpcoming={hasUpcoming} />
					</span>
				</span>
				<Meter
					used={all === 0 ? 0 : paid / all}
					color={color}
					className="max-md:col-span-full max-md:row-start-2"
				/>
				<Figures paid={paid} atApi={atApi > 0 ? atApi : null}>
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
							ofPaid={paid}
							ofApi={atApi}
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
	ofPaid,
	ofApi,
	color,
}: {
	row: SpendTotal;
	ofPaid: number;
	ofApi: number;
	color: string;
}): JSX.Element {
	const paid = whole(row);
	const atApi = apiTotal(row);
	const isApiOnly = paid === 0 && row.equivalent > 0;
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
				used={
					isApiOnly
						? ofApi === 0
							? 0
							: row.equivalent / ofApi
						: ofPaid === 0
							? 0
							: paid / ofPaid
				}
				color={isApiOnly ? "var(--muted-foreground)" : color}
				className={cn(
					"max-md:col-span-full max-md:row-start-2",
					isApiOnly ? "opacity-45" : "opacity-70",
				)}
			/>
			<Figures paid={isApiOnly ? null : paid} atApi={atApi > 0 ? atApi : null}>
				{/* As wide as a provider's chevron, so the figures line up. */}
				<span aria-hidden className="size-4 shrink-0" />
			</Figures>
		</li>
	);
}

/** Whether a figure is money billed, expected with no bill yet, or API-priced plan use. */
function Kind({
	spent,
	plan,
	hasUpcoming = false,
}: {
	spent: Sum;
	plan?: PlanView;
	hasUpcoming?: boolean;
}): JSX.Element {
	if (spent.billed === 0 && spent.expected === 0 && spent.equivalent > 0) {
		const label =
			plan?.source === "none"
				? "plan not set"
				: hasUpcoming && plan?.renewalDay != null
					? `renews day ${plan.renewalDay}`
					: "at API prices";
		return <span className="text-muted-foreground text-xs">{label}</span>;
	}
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
