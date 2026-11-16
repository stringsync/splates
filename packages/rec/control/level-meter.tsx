import { litSegments, SEGMENTS, type Zone, zoneOf } from "./levels";
import { cn } from "./lib/utils";

const LIT: Record<Zone, string> = {
	green: "bg-success",
	yellow: "bg-warning",
	red: "bg-destructive",
};

/** Shows how loud the mic is as lit segments, green for speech, yellow when loud and red near clipping; pass the peak level, 0 to 1. */
export function LevelMeter({
	level,
	className,
}: {
	level: number;
	className?: string;
}) {
	const lit = litSegments(level);
	return (
		<div className={cn("flex h-2 gap-0.5", className)} aria-hidden>
			{Array.from({ length: SEGMENTS }, (_, index) => (
				<span
					key={index}
					className={cn(
						"flex-1 rounded-[1px] bg-foreground/10",
						index < lit && LIT[zoneOf(index)],
					)}
				/>
			))}
		</div>
	);
}
