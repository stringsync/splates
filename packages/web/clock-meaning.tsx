import type { SignalClock } from "@splates/server/signals";
import { cn } from "#web/lib/utils.ts";

/** Read a clock's schedule, time zone and next firing without its call syntax. */
export function ClockMeaning({
	clock,
	className,
}: {
	clock: SignalClock | undefined;
	className?: string;
}) {
	if (clock === undefined) {
		return null;
	}
	return (
		<div className={cn("flex min-w-0 flex-col gap-1 text-sm", className)}>
			<p className="font-medium">{clock.meaning}</p>
			<p className="break-words text-muted-foreground text-xs">{clock.tz}</p>
			{clock.next === null ? (
				<p className="text-muted-foreground">Finished</p>
			) : (
				<p className="flex flex-wrap gap-x-1">
					<span className="text-muted-foreground">Next:</span>
					<ClockTime at={clock.next} zone={clock.tz} />
				</p>
			)}
		</div>
	);
}

/** A scheduled firing in the clock's configured time zone. */
export function ClockTime({ at, zone }: { at: string; zone: string }) {
	const date = new Date(at);
	return (
		<time dateTime={at}>
			{new Intl.DateTimeFormat(undefined, {
				timeZone: zone,
				weekday: "short",
				month: "short",
				day: "numeric",
				year: "numeric",
			}).format(date)}
			<span className="text-muted-foreground"> · </span>
			{new Intl.DateTimeFormat(undefined, {
				timeZone: zone,
				hour: "numeric",
				minute: "2-digit",
				timeZoneName: "short",
			}).format(date)}
		</time>
	);
}
