import type { RunState } from "@splates/server/ship";
import { MinusIcon, PlusIcon, ShieldCheckIcon } from "lucide-react";
import type { JSX } from "react";
import { Button } from "./components/ui/button";
import { SUPERVISE_MOST } from "./ship-flow";

/**
 * The active ship's Supervise card: how many auto fixes the supervisor has
 * left, with − and + to take back or give one. Unsupervised, it has none and
 * + switches supervision on.
 */
export function ShipRunSupervise({
	supervise,
	disabled = false,
	onFixes,
}: {
	supervise: RunState["supervise"];
	disabled?: boolean;
	onFixes: (fixes: number) => void;
}): JSX.Element {
	const budget = supervise?.budget ?? 0;
	const left = budget - (supervise?.spent ?? 0);
	return (
		<section
			aria-label="Supervise"
			className="flex flex-col gap-2 rounded-lg border border-border bg-card px-3.5 py-3"
		>
			<div className="flex items-center gap-2">
				<span className="flex flex-1 items-center gap-1.5 font-semibold text-sm">
					<ShieldCheckIcon aria-hidden className="size-3.5" />
					Supervise
				</span>
				<Button
					variant="outline"
					size="icon-sm"
					aria-label="Fewer fixes"
					disabled={disabled || left <= 0}
					onClick={() => onFixes(-1)}
				>
					<MinusIcon />
				</Button>
				<output
					aria-label="Fixes left"
					className="w-6 text-center font-medium text-sm tabular-nums"
				>
					{left}
				</output>
				<Button
					variant="outline"
					size="icon-sm"
					aria-label="More fixes"
					disabled={
						disabled || budget >= SUPERVISE_MOST + (supervise?.spent ?? 0)
					}
					onClick={() => onFixes(1)}
				>
					<PlusIcon />
				</Button>
			</div>
			<p className="text-muted-foreground text-xs">
				{supervise === undefined
					? "Off: a failed step waits for you. + gives it auto fixes."
					: `Auto fixes left: when a step fails, an agent fixes it and the ship retries it. ${supervise.spent} of ${budget} used.`}
			</p>
		</section>
	);
}
