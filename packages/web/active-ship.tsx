import type { JSX } from "react";
import { ShipRun } from "./ship-run";
import type { Live } from "./use-live-ships";

/**
 * The ship under way, as the Ships page and a ship's run-command card both
 * show it. `closed` is the id of a run the person put away.
 */
export function ActiveShip({
	live,
	closed,
	onClose,
	act,
}: {
	live: Live | null;
	closed: string | null;
	onClose: (id: string | null) => void;
	act: (action: "abandon" | "retry" | "agent") => Promise<void>;
}): JSX.Element {
	if (live === null) {
		return <p className="text-muted-foreground text-sm">Reading…</p>;
	}
	if (live.cascade == null || live.cascade.id === closed) {
		return (
			<p className="text-muted-foreground text-sm">
				No ship is under way. <a href="#ships">Plan one</a>
			</p>
		);
	}
	return (
		<ShipRun
			cascade={live.cascade}
			ship={live.ship}
			onClose={() => onClose(live.cascade?.id ?? null)}
			abandon={() => act("abandon")}
			retry={() => act("retry")}
			agent={() => act("agent")}
		/>
	);
}
