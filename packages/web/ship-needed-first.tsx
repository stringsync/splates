import type { Listed, Offered } from "@splates/server/ship";
import { InfoIcon } from "lucide-react";
import type { JSX } from "react";
import { type Picks, ShipPickList } from "./ship-pick-list";

/**
 * Lists the targets the picks need shipped first as the same checkbox cards
 * as the pick list: tick one to ship it first, and choose its bump. Pass
 * `added` as the ones ticked so far, each with its bump; each change comes
 * back through `onAdded` as the whole set.
 */
export function ShipNeededFirst({
	offered,
	targets,
	added,
	onAdded,
	// vet-ignore objects-over-callbacks: a React component's props, which are how React passes events
}: {
	offered: readonly Offered[];
	targets: readonly Listed[];
	added: Picks;
	onAdded: (added: Picks) => void;
}): JSX.Element {
	const listed = new Map(targets.map((each) => [each.plan.name, each]));
	const shown = offered.flatMap((offer) => {
		const target = listed.get(offer.name);
		return target === undefined ? [] : [target];
	});
	return (
		<div className="flex flex-col gap-3">
			<p
				role="status"
				className="flex items-start gap-2 rounded-lg border bg-muted px-3 py-2 text-muted-foreground text-sm"
			>
				<InfoIcon className="mt-0.5 size-4 shrink-0" />
				<span>
					These targets have unshipped changes that your picks depend on, so
					tick any you want to ship first.
				</span>
			</p>
			<ShipPickList targets={shown} picks={added} onPicks={onAdded} />
			<ul className="flex flex-col gap-1 text-muted-foreground text-xs">
				{offered.map((offer) => (
					<li key={offer.name}>
						{offered.length > 1 && (
							<>
								<span className="font-medium text-foreground">
									{offer.name}
								</span>
								:{" "}
							</>
						)}
						{dependents(offer.for)}
						{offer.error !== undefined && (
							<span className="text-destructive"> ({offer.error})</span>
						)}
					</li>
				))}
			</ul>
			<p className="text-muted-foreground text-sm">
				Unticked ones are skipped: your picks ship against what is already out.
			</p>
		</div>
	);
}

/** "vexml and s2s-staging depend on it", for the targets that do. */
function dependents(names: readonly string[]): string {
	const listed =
		names.length <= 1
			? names.join("")
			: `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
	return `${listed} ${names.length === 1 ? "depends" : "depend"} on it`;
}
