import type { JSX } from "react";
import { useNow } from "./hooks/use-now";
import { spanOf } from "./merge-lines";
import type { TargetSummary } from "./ship-run-summary";

/** How long a target has taken, ticking while it runs. */
export function TargetTime({
	target,
}: {
	target: TargetSummary;
}): JSX.Element | null {
	const now = useNow(target.status === "running");
	if (target.started === undefined) {
		return null;
	}
	return (
		<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
			{spanOf((target.ended ?? now) - target.started)}
		</span>
	);
}
