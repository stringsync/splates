import type { PlanView, SpendReport } from "@splates/server/spend";
import type { JSX, ReactNode } from "react";
import { Card } from "#web/components/ui/card.tsx";
import {
	apiTotal,
	missingPlans,
	monthEnd,
	nameOf,
	plansInProjection,
	projected,
	sum,
	useMoney,
	whole,
} from "./billing-sums";
import { StillWaiting } from "./countdown";
import { Meter } from "./meter";

/**
 * The range's one figure, the bill: what was billed and what is expected
 * (plan renewals at list price, subscriptions not invoiced yet), a visual
 * comparison against what the same usage would cost at API list prices, and
 * for this month where it is headed.
 */
export function Headline({
	title,
	report,
	reading,
	picking,
	projecting,
	plans = [],
}: {
	title: ReactNode;
	report: SpendReport | null;
	reading: boolean;
	picking: boolean;
	projecting: boolean;
	/** Each agent provider's plan, to name the ones the projection lacks. */
	plans?: readonly PlanView[];
}): JSX.Element {
	const dollars = useMoney();
	const total = sum(report?.services ?? []);
	const all = whole(total);
	const api = apiTotal(total);
	const upcoming = report?.upcoming ?? [];
	const pace = projecting ? projected(total.billed, Date.now()) : null;
	const ahead =
		pace === null || report === null
			? null
			: pace + total.expected + sum(upcoming).expected;
	return (
		<Card
			render={<section />}
			aria-label="total"
			className="flex flex-col gap-4 px-5 py-5"
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
						<span className="font-semibold text-5xl leading-none tracking-tight tabular-nums">
							{dollars(all)}
						</span>
					)}
				</div>
				{ahead !== null && (
					<div className="flex flex-col gap-1">
						<span className="text-muted-foreground text-sm">
							Projected by {monthEnd(Date.now())}
						</span>
						<span className="font-medium text-2xl leading-none tracking-tight text-muted-foreground tabular-nums">
							{dollars(Math.round(ahead * 100) / 100)}
						</span>
					</div>
				)}
			</div>
			{report !== null && total.equivalent > 0 && (
				<Comparison paid={all} atApi={api} />
			)}
			{report !== null && (
				<div className="flex flex-col gap-1 border-t pt-3 text-sm">
					<p className="flex flex-wrap gap-x-4 gap-y-1">
						<span>
							<span className="font-medium">{dollars(total.billed)}</span>{" "}
							<span className="text-muted-foreground">billed</span>
						</span>
						{total.expected > 0 && (
							<span title="Agent plans' renewals at list price, and subscriptions not invoiced yet">
								<span className="font-medium">{dollars(total.expected)}</span>{" "}
								<span className="text-muted-foreground">
									plans and subscriptions
								</span>
							</span>
						)}
					</p>
					{ahead !== null && report !== null && (
						<ProjectionPlans report={report} plans={plans} />
					)}
					{ahead !== null && upcoming.length > 0 && (
						<p className="text-muted-foreground text-xs">
							Still to come by {monthEnd(Date.now())}:{" "}
							{upcoming
								.map(
									(row) =>
										`${nameOf(row.provider ?? "")} ${row.service} ${dollars(row.expected)}`,
								)
								.join(", ")}
						</p>
					)}
					<p className="text-muted-foreground text-xs">
						{all === 0 && total.equivalent === 0
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
		</Card>
	);
}

/** Proportional comparison of actual bill vs. what the same usage would cost at API list prices. */
function Comparison({
	paid,
	atApi,
}: {
	paid: number;
	atApi: number;
}): JSX.Element {
	const dollars = useMoney(true);
	const max = Math.max(paid, atApi, 0.01);
	const saved = atApi - paid;
	const multiple = paid > 0 ? atApi / paid : null;
	return (
		<section
			aria-label="Actual bill vs. API list prices"
			className="flex flex-col gap-2.5 rounded-lg border bg-muted/40 px-3.5 py-3 text-xs tabular-nums"
		>
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<span className="font-medium text-foreground">
					Actual bill vs. API list prices
				</span>
				{saved > 0 ? (
					<span className="font-medium text-success">
						Saving {dollars(saved)}
						{multiple !== null && multiple >= 1.05
							? ` (${multiple.toFixed(1)}× value)`
							: ""}
					</span>
				) : (
					<span className="text-muted-foreground">
						{dollars(paid - atApi)} more than API so far
					</span>
				)}
			</div>
			<div className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-x-3 gap-y-2">
				<span className="text-muted-foreground">You pay</span>
				<Meter
					used={Math.max(paid / max, paid > 0 ? 0.015 : 0)}
					color="var(--series-1)"
				/>
				<span className="text-right font-medium text-foreground">
					{dollars(paid)}
				</span>

				<span className="text-muted-foreground">At API prices</span>
				<Meter
					used={Math.max(atApi / max, atApi > 0 ? 0.015 : 0)}
					color="color-mix(in oklab, var(--muted-foreground) 50%, transparent)"
				/>
				<span className="text-right font-medium text-foreground">
					{dollars(atApi)}
				</span>
			</div>
		</section>
	);
}

/**
 * What the projection holds besides the month's pace: each provider's plan
 * fees, and a warning for a provider with usage but no plan, which adds nothing.
 */
function ProjectionPlans({
	report,
	plans,
}: {
	report: SpendReport;
	plans: readonly PlanView[];
}): JSX.Element | null {
	const dollars = useMoney();
	const included = plansInProjection(report.services, report.upcoming);
	const missing = missingPlans(report.services, plans);
	if (included.length === 0 && missing.length === 0) {
		return null;
	}
	return (
		<>
			{included.length > 0 && (
				<p className="text-muted-foreground text-xs">
					Plans and subscriptions in the projection:{" "}
					{included
						.map((each) => `${nameOf(each.provider)} ${dollars(each.amount)}`)
						.join(", ")}
				</p>
			)}
			{missing.length > 0 && (
				<p role="alert" className="text-amber-600 text-xs dark:text-amber-400">
					{missing.map(nameOf).join(" and ")} has usage but no plan set, so{" "}
					{missing.length === 1 ? "its fee is" : "their fees are"} not in this
					projection. Set {missing.length === 1 ? "it" : "them"} under Plans
					below.
				</p>
			)}
		</>
	);
}
