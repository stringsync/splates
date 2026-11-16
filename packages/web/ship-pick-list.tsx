import type { Bump, Listed } from "@splates/server/ship";
import type { JSX } from "react";
import { Checkbox } from "./components/ui/checkbox";
import { cn } from "./lib/utils";
import { BumpToggle } from "./ship-bump-toggle";

/**
 * What is picked to ship: each target's name, and for one that takes a
 * bump, the bump picked. A target without a bump (a deploy) maps to null.
 */
export type Picks = ReadonlyMap<string, Bump | null>;

/**
 * Picks what to ship from every target, given as a flat list: tap a line to
 * pick it, and choose patch, minor or major on a picked one that takes a
 * bump. Each change comes back through `onPicks` as the whole pick.
 */
export function ShipPickList({
	targets,
	picks,
	onPicks,
	// vet-ignore objects-over-callbacks: a React component's props, which are how React passes events
}: {
	targets: readonly Listed[];
	picks: Picks;
	onPicks: (picks: Picks) => void;
}): JSX.Element {
	const toggle = (target: Listed) => {
		const next = new Map(picks);
		if (next.has(target.plan.name)) {
			next.delete(target.plan.name);
		} else {
			next.set(target.plan.name, target.plan.bump ?? null);
		}
		onPicks(next);
	};
	const bump = (name: string, to: Bump) => {
		onPicks(new Map(picks).set(name, to));
	};
	return (
		<ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
			{targets.map((target) => {
				const { name } = target.plan;
				const picked = picks.has(name);
				const chosen = picks.get(name);
				const deploy = target.plan.bump === undefined;
				return (
					<li key={name} className="flex min-h-12 items-center gap-2.5 px-3.5">
						<Checkbox
							checked={picked}
							onCheckedChange={() => toggle(target)}
							aria-label={name}
						/>
						{/* The name is the line's wide tap target; the checkbox is what a keyboard or reader uses. */}
						<span
							aria-hidden="true"
							onClick={() => toggle(target)}
							className={cn(
								"min-w-0 flex-1 cursor-pointer select-none self-stretch truncate py-3 text-sm",
								picked ? "font-semibold" : "font-medium",
							)}
						>
							{name}
						</span>
						{!picked && target.plan.unshipped !== undefined && (
							<span
								className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs tabular-nums"
								title="Unshipped commits"
							>
								{target.plan.unshipped}
							</span>
						)}
						{deploy ? (
							<span className="text-muted-foreground text-xs">deploy</span>
						) : (
							picked &&
							chosen != null && (
								<BumpToggle
									name={name}
									bump={chosen}
									onBump={(to) => bump(name, to)}
								/>
							)
						)}
					</li>
				);
			})}
		</ul>
	);
}
