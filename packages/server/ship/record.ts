import type { Document, Storage } from "../storage";
import type { ShipBump } from "./plan";
import type { StagedPackage } from "./release-steps";
import type { Stage, StageKey } from "./stages";

/**
 * Where a project's records keep its latest ship, or that of its ship
 * `target` when its repository names several.
 */
export function shipRecord(storage: Storage, target?: string): Document<Ship> {
	return storage.document<Ship>(
		target === undefined ? "ship.json" : `ship.${target}.json`,
	);
}

/** Where a ship stands: going, or how it ended. */
export type ShipStatus = "running" | "done" | "failed";

/**
 * What npm waited on the person for, on its own page: signing in, a
 * publish's second factor, or the approval of each version a stage-only
 * token staged. A ship no longer waits on any, so only a record kept from
 * before holds one, readable for history.
 */
export interface ShipWait {
	kind: "login" | "2fa" | "approve";
	/** npm's page, which the person opens from any device. */
	url: string;
	/** When npm began waiting, as ISO time. */
	since: string;
	/** For `approve`: the packages staged and not yet approved. */
	packages?: StagedPackage[];
}

/**
 * A project's latest ship, kept in its records so a restarted server shows it
 * and finishes one it left running.
 */
export interface Ship {
	/** The project's slug, as `?project=` names it. */
	project: string;
	/** The `ship` command from its `splates.config.ts`. */
	command: string;
	/** The approved release type, passed to the command and kept across restarts. */
	bump: ShipBump;
	status: ShipStatus;
	/** Signing in to npm first (ships before the trusted job), or running the ship command. */
	step: "login" | "ship";
	/** The root `package.json` version as the ship started. */
	from: string | null;
	/** The root `package.json` version once it is done; null before. */
	to: string | null;
	started: string;
	ended: string | null;
	/** What npm waited on the person for, in a record kept from before; null now. */
	waiting: ShipWait | null;
	/** The last of the output of a ship that failed. */
	error: string | null;
	/** How many times a restart ran it again to finish it. */
	resumed: number;
	/** Where its output is; the project's own `ship.log` unless its cascade named one. */
	log?: string;
	/** The steps it took, each with its slice of the log. */
	stages?: Stage[];
}

/** The steps a ship takes itself, as {@link Ship.stages} keeps them. */
export const SHIP_STAGES: StageKey[] = ["push", "command", "remote"];
