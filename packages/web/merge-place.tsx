import type { Need } from "@stringsync/splates-server/plans";
import type { JSX } from "react";
import { cn } from "./lib/utils";

/**
 * A queued merge's place in line for the premerge lock, as the page says it:
 * `next` for the first, else `2nd in line`, `3rd in line`, and so on.
 */
export function placeInLine(place: number): string {
	if (place <= 1) {
		return "next";
	}
	const tens = place % 100;
	const suffix =
		tens >= 11 && tens <= 13
			? "th"
			: place % 10 === 1
				? "st"
				: place % 10 === 2
					? "nd"
					: place % 10 === 3
						? "rd"
						: "th";
	return `${place}${suffix} in line`;
}

/**
 * A queued merge's place in line, muted beside its row's icon; nothing for
 * a merge not waiting, or one whose place is not known.
 */
export function MergePlace({
	need,
	className,
}: {
	need: Need;
	className?: string;
}): JSX.Element | null {
	if (
		need.kind !== "working" ||
		need.merge !== "queued" ||
		need.mergePlace === undefined
	) {
		return null;
	}
	return (
		<span
			title="Its place in line for the machine's one merge test"
			className={cn("shrink-0 text-muted-foreground text-xs", className)}
		>
			{placeInLine(need.mergePlace)}
		</span>
	);
}
