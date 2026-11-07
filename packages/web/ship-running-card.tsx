import { age } from "@splates/server/age";
import type { Cascade } from "@splates/server/ship";
import { shipName } from "@splates/server/ship/browser";
import { ChevronRightIcon } from "lucide-react";
import type { JSX } from "react";
import { cn } from "./lib/utils";
import { shipActivity, shipLine } from "./ship-activity";

const FINISHED = new Set(["done", "dropped"]);

/**
 * The ship under way, or the finished one whose recap waits, as one card
 * pinned above the planner; it opens the ship's page.
 */
export function ShipRunningCard({
	cascade,
	href,
}: {
	cascade: Cascade;
	href: string;
}): JSX.Element {
	const activity = shipActivity({ cascade, ship: null });
	const name = shipName(cascade.from);
	const title =
		cascade.status === "done"
			? `Shipped ${name}`
			: cascade.status === "abandoned"
				? `${name} ship abandoned`
				: cascade.status === "stopped"
					? `${name} ship stopped`
					: `Shipping ${name}`;
	const finished = cascade.steps.filter((step) =>
		FINISHED.has(step.status),
	).length;
	const share =
		cascade.status === "done"
			? 1
			: cascade.steps.length === 0
				? 0
				: finished / cascade.steps.length;
	return (
		// Pinned under the app's sticky header, which a phone's notch pushes down.
		<div className="sticky top-[calc(var(--top-bar-height)+env(safe-area-inset-top))] z-20 -mx-4 bg-background px-4 pt-1 pb-2">
			<a
				href={href}
				aria-label={`${title}: open the ship`}
				className="block rounded-lg border bg-card p-3 text-sm shadow-sm hover:bg-accent/50"
			>
				<span className="flex items-center gap-2">
					<span
						aria-hidden
						className={cn(
							"size-2 shrink-0 rounded-full",
							activity === "error"
								? "bg-destructive"
								: activity === "waiting"
									? "bg-warning"
									: "bg-success",
						)}
					/>
					<span className="truncate font-medium">{title}</span>
					<span className="ml-auto shrink-0 text-muted-foreground text-xs">
						{age(cascade.started)}
					</span>
					<ChevronRightIcon aria-hidden className="size-3.5 shrink-0" />
				</span>
				<span
					role="progressbar"
					aria-label="Ship progress"
					aria-valuemin={0}
					aria-valuemax={cascade.steps.length}
					aria-valuenow={finished}
					className="mt-2 block h-1.5 overflow-hidden rounded-full bg-muted"
				>
					<span
						className="block h-full bg-primary"
						style={{ width: `${share * 100}%` }}
					/>
				</span>
				<span className="mt-1 block truncate text-muted-foreground text-xs">
					{cascade.status === "done"
						? "Open it to see how it went"
						: (shipLine({ cascade, ship: null }) ?? "starting")}
				</span>
			</a>
		</div>
	);
}
