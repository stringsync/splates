import { MinusIcon, PlusIcon, ShieldCheckIcon } from "lucide-react";
import type { JSX } from "react";
import { Button } from "./components/ui/button";
import { Switch } from "./components/ui/switch";
import { SUPERVISE_MOST } from "./ship-flow";

/**
 * The Review screen's Supervise card: whether the ship starts supervised,
 * and how many fixes its supervisor may send to agents by itself.
 */
export function ShipSupervise({
	on,
	budget,
	onOn,
	onFixes,
}: {
	on: boolean;
	budget: number;
	onOn: (on: boolean) => void;
	onFixes: (budget: number) => void;
}): JSX.Element {
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
				<Switch aria-label="Supervise" checked={on} onCheckedChange={onOn} />
			</div>
			<p className="text-muted-foreground text-xs">
				When a step fails, an agent fixes it and the ship retries it. After the
				last fix, a failure waits for you.
			</p>
			{on && (
				<div className="flex items-center gap-2 pt-0.5">
					<span className="flex-1 text-sm">Fixes</span>
					<Button
						variant="outline"
						size="icon-sm"
						aria-label="Fewer fixes"
						disabled={budget <= 1}
						onClick={() => onFixes(budget - 1)}
					>
						<MinusIcon />
					</Button>
					<output
						aria-label="Fixes"
						className="w-6 text-center font-medium text-sm tabular-nums"
					>
						{budget}
					</output>
					<Button
						variant="outline"
						size="icon-sm"
						aria-label="More fixes"
						disabled={budget >= SUPERVISE_MOST}
						onClick={() => onFixes(budget + 1)}
					>
						<PlusIcon />
					</Button>
				</div>
			)}
		</section>
	);
}
