import type { SpendReport } from "@stringsync/splates-server/spend";
import type { JSX, ReactNode } from "react";
import {
	monthEnd,
	nameOf,
	projected,
	sum,
	useMoney,
	whole,
} from "./billing-sums";
import { StillWaiting } from "./countdown";

/**
 * The range's one figure, the bill: what was billed and what is expected
 * (plan renewals at list price, subscriptions not invoiced yet) under it,
 * with plan use at API list prices beside it, out of the total; and for this
 * month where it is headed, billed spend at this pace plus what is still due.
 */
export function Headline({
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
	const upcoming = report?.upcoming ?? [];
	const pace = projecting ? projected(total.billed, Date.now()) : null;
	const ahead =
		pace === null || report === null
			? null
			: pace + total.expected + sum(upcoming).expected;
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
						{total.expected > 0 && (
							<span title="Agent plans' renewals at list price, and subscriptions not invoiced yet">
								<span className="font-medium">{dollars(total.expected)}</span>{" "}
								<span className="text-muted-foreground">
									plans and subscriptions
								</span>
							</span>
						)}
						{total.equivalent > 0 && (
							<span
								title="What plan use would cost at API list prices, not money paid"
								className="text-muted-foreground"
							>
								{dollars(total.equivalent)} of plan use at API prices, not in
								the total
							</span>
						)}
					</p>
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
