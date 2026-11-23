import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";

/** Apply to a meter grid to align its labels, bars, and values at desktop and phone widths. */
export const METER_COLUMNS =
	"grid-cols-[7rem_1fr_10rem] max-md:grid-cols-[minmax(0,1fr)_auto]";

/** How a share used, 0 to 1, reads: plain, a warning from 80%, an alarm from 90%. */
export function toneOf(used: number): "warning" | "destructive" | null {
	return used >= ALL_BUT_FULL
		? "destructive"
		: used >= NEARLY_FULL
			? "warning"
			: null;
}

/**
 * A thin bar filled to `used`, 0 to 1, in its tone, or in `color` for a
 * share that names who it is, which has no tone. Pass a CSS background image
 * as `trackPattern` to distinguish the unfilled portion.
 */
export function Meter({
	used,
	color,
	trackPattern,
	className,
}: {
	used: number;
	color?: string;
	trackPattern?: string;
	className?: string;
}): JSX.Element {
	const tone = color === undefined ? toneOf(used) : null;
	return (
		<span
			aria-hidden
			style={{ backgroundImage: trackPattern }}
			className={cn(
				"relative h-1 overflow-hidden rounded-full bg-foreground/15",
				className,
			)}
		>
			<span
				className={cn(
					"absolute inset-y-0 left-0 rounded-full bg-foreground",
					tone === "warning" && "bg-warning",
					tone === "destructive" && "bg-destructive",
				)}
				style={{
					width: `${Math.min(Math.max(used, 0), 1) * 100}%`,
					background: color,
				}}
			/>
		</span>
	);
}

/** How full a window may get before it warns, and before it alarms. */
const NEARLY_FULL = 0.8;
const ALL_BUT_FULL = 0.9;
