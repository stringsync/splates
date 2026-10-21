import type { SpendTotal } from "@stringsync/splates-server/spend";
import type { JSX } from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#web/components/ui/tooltip.tsx";
import {
	colorOf,
	everyDay,
	nameOf,
	type SpendDay,
	shortDay,
	useMoney,
} from "./billing-sums";
import { axis } from "./stats-report";

/**
 * Each day of the range as a bar stacked by provider, on one axis from
 * zero, with each provider in its own fixed color, a legend under it, and
 * each day's figures on hover.
 */
export function SpendTrend({
	days,
	since,
	until,
}: {
	days: SpendTotal[];
	since: string;
	until: string;
}): JSX.Element {
	const dollars = useMoney();
	const filled = everyDay(days, since, until);
	const top = axis(Math.max(0, ...filled.map((each) => each.total)));
	// The legend lists providers by their place in the stack, bottom first.
	const providers = [
		...new Set(
			filled.flatMap((each) => each.providers.map((one) => one.provider)),
		),
	].sort(
		(one, other) =>
			totalOf(filled, other) - totalOf(filled, one) || one.localeCompare(other),
	);
	return (
		<figure
			aria-label="Spend per day"
			className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-3 shadow-xs"
		>
			<figcaption className="font-medium text-sm">Per day</figcaption>
			<div className="flex gap-2">
				<div
					aria-hidden
					className="relative h-40 w-12 shrink-0 text-right text-muted-foreground text-xs tabular-nums"
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
				<div className="relative h-40 min-w-0 flex-1 border-b">
					{top.ticks.slice(1).map((tick) => (
						<div
							key={tick.at}
							aria-hidden
							className="pointer-events-none absolute inset-x-0 border-border/60 border-t border-dashed"
							style={{ bottom: `${(tick.at / top.max) * 100}%` }}
						/>
					))}
					<div className="absolute inset-0 flex">
						{filled.map((day) => (
							<Bar key={day.day} day={day} max={top.max} order={providers} />
						))}
					</div>
				</div>
			</div>
			<div className="flex justify-between pl-14 text-muted-foreground text-xs tabular-nums">
				<span>{shortDay(filled[0]?.day ?? since.slice(0, 10))}</span>
				<span>{shortDay(filled.at(-1)?.day ?? since.slice(0, 10))}</span>
			</div>
			{providers.length > 0 && (
				<ul
					aria-label="legend"
					className="flex flex-wrap gap-x-4 gap-y-1 pl-14 text-muted-foreground text-xs"
				>
					{providers.map((provider) => (
						<li key={provider} className="flex items-center gap-1.5">
							<span
								aria-hidden
								className="size-2.5 rounded-sm"
								style={{ background: colorOf(provider) }}
							/>
							{nameOf(provider)}
						</li>
					))}
				</ul>
			)}
		</figure>
	);
}

const totalOf = (days: SpendDay[], provider: string): number =>
	days.reduce(
		(all, day) =>
			all +
			(day.providers.find((each) => each.provider === provider)?.amount ?? 0),
		0,
	);

/**
 * One day's column, as wide as its share of the plot so the whole column
 * answers hover, its bar thin in the middle: a segment per provider in
 * `order` from the baseline, a gap of the card between them, the top end
 * rounded.
 */
function Bar({
	day,
	max,
	order,
}: {
	day: SpendDay;
	max: number;
	order: string[];
}): JSX.Element {
	const dollars = useMoney();
	const segments = order.flatMap((provider) => {
		const found = day.providers.find((each) => each.provider === provider);
		return found === undefined ? [] : [found];
	});
	const label = `${shortDay(day.day)}: ${dollars(day.total)}`;
	return (
		<Tooltip>
			<TooltipTrigger
				render={<div />}
				aria-label={label}
				className="flex h-full min-w-0 flex-1 cursor-default flex-col justify-end outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
			>
				<div
					className="flex w-3/5 max-w-6 flex-col-reverse gap-[2px] self-center overflow-hidden rounded-t-[4px]"
					style={{ height: `${max === 0 ? 0 : (day.total / max) * 100}%` }}
				>
					{segments.map((each) => (
						<div
							key={each.provider}
							className="min-h-0.5"
							style={{
								flexGrow: each.amount,
								flexBasis: 0,
								background: colorOf(each.provider),
							}}
						/>
					))}
				</div>
			</TooltipTrigger>
			<TooltipContent>
				<div className="flex flex-col gap-1">
					<span className="font-medium">{label}</span>
					{segments.length === 0 && <span>Nothing spent</span>}
					{[...segments].reverse().map((each) => (
						<span key={each.provider} className="flex items-center gap-1.5">
							<span
								aria-hidden
								className="size-2 rounded-sm"
								style={{ background: colorOf(each.provider) }}
							/>
							{nameOf(each.provider)}
							<span className="ml-auto pl-3 tabular-nums">
								{dollars(each.amount)}
							</span>
						</span>
					))}
				</div>
			</TooltipContent>
		</Tooltip>
	);
}
