import type { JSX } from "react";
import { cn } from "#dev/lib/utils.ts";

/**
 * The columns a list of meters lays out in: a name, the bar, then what it
 * says. Every list on a page that uses them puts its bars at the same x, the
 * same width.
 */
export const METER_COLUMNS =
	"grid-cols-[7rem_1fr_10rem] max-md:grid-cols-[6rem_1fr_6.5rem]";

/** How a share used, 0 to 1, reads: plain, a warning from 80%, an alarm from 90%. */
export function toneOf(used: number): "warning" | "destructive" | null {
	return used >= ALL_BUT_FULL
		? "destructive"
		: used >= NEARLY_FULL
			? "warning"
			: null;
}

/** A thin bar filled to `used`, 0 to 1, in its tone. */
export function Meter({ used }: { used: number }): JSX.Element {
	const tone = toneOf(used);
	return (
		<span
			aria-hidden
			className="relative h-1 overflow-hidden rounded-full bg-foreground/15"
		>
			<span
				className={cn(
					"absolute inset-y-0 left-0 rounded-full bg-foreground",
					tone === "warning" && "bg-warning",
					tone === "destructive" && "bg-destructive",
				)}
				style={{ width: `${Math.min(Math.max(used, 0), 1) * 100}%` }}
			/>
		</span>
	);
}

/** How full a window may get before it warns, and before it alarms. */
const NEARLY_FULL = 0.8;
const ALL_BUT_FULL = 0.9;
