import type { UnusedQuotaPlan, UnusedQuotaReport } from "@splates/server/spend";
import { ChevronRightIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { cn } from "#web/lib/utils.ts";
import { unusedQuota } from "./api";
import { colorOf, nameOf, shortDay, useMoney } from "./billing-sums";
import { Meter } from "./meter";
import { PHONE_HEADING } from "./phone-rows";

type Lookback = 28 | 90;

const LOOKBACKS: { days: Lookback; label: string }[] = [
	{ days: 28, label: "Last 4 weeks" },
	{ days: 90, label: "Last 90 days" },
];

/** Hatched pattern for the unused portion of a subscription bar. */
const HATCH_WARN =
	"repeating-linear-gradient(-45deg, transparent, transparent 3px, color-mix(in oklab, var(--warning) 24%, transparent) 3px, color-mix(in oklab, var(--warning) 24%, transparent) 6px)";
const HATCH_QUIET =
	"repeating-linear-gradient(-45deg, transparent, transparent 3px, color-mix(in oklab, var(--foreground) 7%, transparent) 3px, color-mix(in oklab, var(--foreground) 7%, transparent) 6px)";

/**
 * Ranked subscription unused-quota card placed directly under Spend:
 * headline total of monthly dollars left on the table, split used/unused
 * bars with lower-tier hints, a 4-week / 90-day toggle, and expandable
 * reset-by-reset peak history with API-price equivalent spend.
 */
export function UnusedQuota({
	refreshKey,
}: {
	/** Changes when currency or saved plans change so the card reloads. */
	refreshKey: string;
}): JSX.Element | null {
	const [days, setDays] = useState<Lookback>(28);
	const [report, setReport] = useState<UnusedQuotaReport | null>(null);
	const [error, setError] = useState<string | null>(null);
	const dollars = useMoney();

	useEffect(() => {
		void refreshKey;
		let active = true;
		unusedQuota(days).then(
			(next) => {
				if (active) {
					setReport(next);
					setError(null);
				}
			},
			(caught: Error) => {
				if (active) {
					setError(caught.message);
				}
			},
		);
		return () => {
			active = false;
		};
	}, [days, refreshKey]);

	if (error !== null) {
		return (
			<p role="alert" className="text-destructive text-sm">
				Could not read unused quota: {error}
			</p>
		);
	}
	if (report === null || report.plans.length === 0) {
		return null;
	}

	const unusedPercent =
		report.totalPricedMonthly > 0
			? Math.round(
					(report.totalUnusedMonthly / report.totalPricedMonthly) * 100,
				)
			: null;

	return (
		<section aria-label="unused quota" className="flex min-w-0 flex-col gap-3">
			<header className="flex flex-wrap items-center gap-2">
				<h3 className={cn("font-medium text-sm", PHONE_HEADING)}>
					Unused quota
				</h3>
				<span className="text-muted-foreground text-xs">
					Ranked by unused subscription value · weekly resets
				</span>
				<fieldset
					aria-label="unused quota window"
					className="ml-auto flex items-center gap-0.5 rounded-lg bg-muted p-0.5"
				>
					{LOOKBACKS.map((each) => (
						<button
							key={each.days}
							type="button"
							aria-pressed={days === each.days}
							onClick={() => setDays(each.days)}
							className={cn(
								"rounded-md px-2.5 py-1 text-xs",
								days === each.days
									? "bg-background font-medium shadow-xs"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							{each.label}
						</button>
					))}
				</fieldset>
			</header>

			<div className="overflow-hidden rounded-xl border bg-card shadow-xs">
				<div className="flex flex-wrap items-end justify-between gap-4 border-b px-5 py-4">
					{report.pricedPlans > 0 ? (
						<div className="flex flex-col gap-0.5 tabular-nums">
							<span className="text-muted-foreground text-xs">
								Left on the table across {report.pricedPlans}{" "}
								{report.pricedPlans === 1 ? "priced plan" : "priced plans"}
							</span>
							<div className="flex flex-wrap items-baseline gap-2.5">
								<span className="font-semibold text-3xl leading-none tracking-tight">
									~{dollars(report.totalUnusedMonthly)}/mo
								</span>
								{unusedPercent !== null && (
									<span className="text-muted-foreground text-sm">
										{unusedPercent}% of {dollars(report.totalPricedMonthly)}/mo
										unused
									</span>
								)}
							</div>
						</div>
					) : (
						<div className="flex flex-col gap-0.5">
							<span className="font-medium text-sm">
								Tracking first weekly resets
							</span>
							<span className="text-muted-foreground text-xs">
								Unused totals appear once each subscription completes a reset
								cycle.
							</span>
						</div>
					)}
					<div className="flex flex-wrap items-center gap-3.5 text-muted-foreground text-xs">
						<span className="flex items-center gap-1.5">
							<span aria-hidden className="size-2.5 rounded-sm bg-foreground" />
							Avg weekly peak used
						</span>
						<span className="flex items-center gap-1.5">
							<span
								aria-hidden
								className="size-2.5 rounded-sm border border-warning/45"
								style={{ background: HATCH_WARN }}
							/>
							Left unused at reset
						</span>
					</div>
				</div>

				<ul className="divide-y">
					{report.plans.map((plan) => (
						<PlanUnusedRow
							key={
								plan.group === undefined
									? plan.provider
									: `${plan.provider}:${plan.group}`
							}
							plan={plan}
						/>
					))}
				</ul>
			</div>
		</section>
	);
}

function PlanUnusedRow({ plan }: { plan: UnusedQuotaPlan }): JSX.Element {
	const [open, setOpen] = useState(false);
	const dollars = useMoney();
	const color = colorOf(plan.provider);
	const completed = plan.resets.length > 0;
	const highWaste = (plan.unusedShare ?? 0) >= 0.5;
	const usedShare = completed ? (plan.avgPeak ?? 0) : (plan.current?.used ?? 0);
	const statusNote = completed
		? (plan.tierHint ??
			((plan.unusedShare ?? 0) <= 0.25
				? "Right-sized"
				: (plan.unusedShare ?? 0) < 0.5
					? "Moderate slack"
					: `${plan.resets.length} ${plan.resets.length === 1 ? "reset" : "resets"}`))
		: plan.current !== null
			? `Resets ${shortDay(plan.current.resets.slice(0, 10))}`
			: "Waiting for limits";

	const label =
		plan.group === undefined
			? nameOf(plan.provider)
			: `${nameOf(plan.provider)} · ${plan.group}`;

	return (
		<li aria-label={`${label} unused quota`}>
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className="grid w-full grid-cols-[11.5rem_1fr_10rem_1rem] items-center gap-x-3.5 gap-y-2 px-5 py-3.5 text-left tabular-nums max-md:grid-cols-[minmax(0,1fr)_auto_1rem]"
			>
				<span className="flex min-w-0 items-center gap-2">
					<span
						aria-hidden
						className="size-2.5 shrink-0 rounded-sm"
						style={{ background: color }}
					/>
					<span className="flex min-w-0 flex-col">
						<span className="truncate font-medium text-sm">{label}</span>
						<span className="truncate text-muted-foreground text-xs">
							{plan.monthlyPrice !== null
								? `${plan.plan ?? "Plan"} · ${dollars(plan.monthlyPrice)}/mo`
								: "Plan price not pulled"}
						</span>
					</span>
				</span>

				<span className="flex min-w-0 flex-col gap-1.5 max-md:col-span-full max-md:row-start-2">
					<Meter
						used={usedShare}
						color={
							completed
								? color
								: `color-mix(in oklab, ${color} 45%, transparent)`
						}
						trackPattern={
							completed ? (highWaste ? HATCH_WARN : HATCH_QUIET) : undefined
						}
					/>
					<span className="flex justify-between gap-2 text-muted-foreground text-xs">
						<span>
							{completed
								? `Avg peak ${pct(plan.avgPeak ?? 0)} · max ${pct(plan.maxPeak ?? 0)}`
								: plan.current !== null
									? `Tracking first reset · ${pct(plan.current.used)} used`
									: "No reset recorded yet"}
						</span>
						<span
							className={cn(
								"shrink-0",
								plan.tierHint !== null && "font-medium text-warning",
							)}
						>
							{statusNote}
						</span>
					</span>
				</span>

				<span className="flex flex-col text-right max-md:col-start-2 max-md:row-start-1">
					{completed ? (
						plan.unusedMonthly !== null ? (
							<>
								<span
									className={cn(
										"font-semibold text-sm",
										highWaste && "text-warning",
									)}
								>
									~{dollars(plan.unusedMonthly)}/mo unused
								</span>
								<span className="text-muted-foreground text-xs">
									{pct(plan.unusedShare ?? 0)} left on table
								</span>
							</>
						) : (
							<>
								<span
									className={cn(
										"font-semibold text-sm",
										highWaste && "text-warning",
									)}
								>
									{pct(plan.unusedShare ?? 0)} unused
								</span>
								<span className="text-muted-foreground text-xs">
									Price unknown
								</span>
							</>
						)
					) : (
						<>
							<span className="font-medium text-muted-foreground text-sm">
								Tracking
							</span>
							<span className="text-muted-foreground text-xs">
								First reset pending
							</span>
						</>
					)}
				</span>

				<ChevronRightIcon
					aria-hidden
					className={cn(
						"size-4 shrink-0 text-muted-foreground transition-transform max-md:col-start-3 max-md:row-start-1",
						open && "rotate-90",
					)}
				/>
			</button>

			{open && (
				<div className="px-5 pb-3.5 pl-9 max-md:pl-5">
					<div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-background px-3.5 py-2.5 tabular-nums">
						{plan.resets.length > 0 ? (
							<ul className="flex flex-wrap gap-x-5 gap-y-2">
								{plan.resets.map((reset) => (
									<li key={reset.resets} className="flex flex-col gap-0.5">
										<span className="text-[11px] text-muted-foreground">
											{shortDay(reset.resets.slice(0, 10))} reset
										</span>
										<span className="font-medium text-xs">
											{pct(reset.peak)} used
										</span>
										<span
											className={cn(
												"text-[11px]",
												reset.unused >= 0.5
													? "text-warning"
													: "text-muted-foreground",
											)}
										>
											{pct(reset.unused)} unused
										</span>
									</li>
								))}
							</ul>
						) : (
							<span className="text-muted-foreground text-xs">
								{plan.current !== null
									? `Current window is at ${pct(plan.current.used)} and resets ${shortDay(plan.current.resets.slice(0, 10))}.`
									: "No window readings recorded yet for this plan."}
							</span>
						)}
						{(plan.apiEquivalent > 0 || plan.monthlyPrice !== null) && (
							<div className="ml-auto text-right text-muted-foreground text-xs">
								<span className="font-medium text-foreground">
									{dollars(plan.apiEquivalent)}
								</span>{" "}
								API-price equiv.
								{plan.monthlyPrice !== null && (
									<span className="block">
										vs{" "}
										<span className="font-medium text-foreground">
											{dollars(plan.monthlyPrice)}/mo
										</span>{" "}
										plan
									</span>
								)}
							</div>
						)}
					</div>
				</div>
			)}
		</li>
	);
}

const pct = (share: number): string => `${Math.round(share * 100)}%`;
