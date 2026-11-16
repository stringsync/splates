import { useEffect, useRef } from "react";
import type { ShipFlow, Stage } from "./ship-flow";

/** The screens deep `stage` is: 0 for the pick, 1 for Needed first, 2 for Review after it. */
export function shipDepth(stage: Stage): number {
	return stage.at === "pick"
		? 0
		: stage.at === "needed" || stage.offered.length === 0
			? 1
			: 2;
}

/**
 * Call in the Ships page with its flow and `depth`: each screen gets its own
 * history entry, so the browser's Back and a phone's edge swipe move one
 * screen, and the flow follows them.
 */
export function useShipHistory(flow: ShipFlow, depth: number): void {
	const shown = useRef(depth);
	shown.current = depth;
	useEffect(() => {
		if (entryDepth() > 0) {
			history.replaceState({ ...history.state, shipDepth: 0 }, "");
		}
		const follow = () => {
			const target = entryDepth();
			const here = shipDepth(flow.state.stage);
			if (target < here) {
				for (let step = here; step > target; step--) {
					flow.back();
				}
			} else if (target > here) {
				// Forward to a screen whose plan is gone.
				history.back();
			}
		};
		window.addEventListener("popstate", follow);
		return () => window.removeEventListener("popstate", follow);
	}, [flow]);
	useEffect(() => {
		if (depth > entryDepth()) {
			history.pushState({ ...history.state, shipDepth: depth }, "");
		}
	}, [depth]);
}

/** Back to screen `depth` from the one shown, through the browser's history. */
export function backToShipDepth(from: number, depth: number): void {
	history.go(depth - from);
}

/** The depth the current history entry was pushed for; a reload starts at the pick, so deeper entries are rewritten. */
function entryDepth(): number {
	const state: unknown = history.state;
	const depth =
		typeof state === "object" && state !== null && "shipDepth" in state
			? state.shipDepth
			: 0;
	return typeof depth === "number" ? depth : 0;
}
