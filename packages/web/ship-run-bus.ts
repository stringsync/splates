import type { RunState } from "@splates/server/ship";
import { Dispatcher } from "core/events";

/** What the project's page stream says of ship runs, for a run on view to follow. */
export type ShipBusEvents = {
	/** Run `id` moved, and now stands as `state`. */
	run: { id: string; state: RunState };
	/** The stream opened, `again` once it had before. */
	open: boolean;
	/** The stream was given up, so what ran meanwhile went unsaid. */
	dropped: undefined;
};

/** Listen here for a ship run, in place of a stream of its own. */
// The page holds the project's stream already, and on plain HTTP a browser's
// six connections to a host leave every request past them waiting.
export const SHIP_BUS = new Dispatcher<ShipBusEvents>();
