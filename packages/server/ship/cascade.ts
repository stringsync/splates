import type { Fs } from "webappwiz/system";
import type { Storage } from "../storage";
import type { Pin } from "./graph";
import { ShipHistory } from "./history";
import type { ShipStep } from "./plan";
import { upgraded } from "./progress";
import type { Ship } from "./run";
import type { Stage, StageKey } from "./stages";

/** A past ship and the outcome of each project it included. */
export interface Cascade {
	/** What history keeps it under. */
	id: string;
	/** The project it started from, or {@link CHANGED}. */
	from: string;
	/**
	 * `done` once every project is done or dropped, `stopped` once one
	 * failed or its bump task went unmerged, `abandoned` once the person
	 * ended it; whatever had shipped stays shipped.
	 */
	status: "running" | "done" | "stopped" | "abandoned";
	started: string;
	ended: string | null;
	/** In dependency order, as the plan the person approved had them. */
	steps: CascadeStep[];
}

/**
 * Where one project of a cascade stands: `waiting` on the projects it takes
 * from, `registry` while npm does not yet serve the versions its bump takes,
 * `bumping` while its bump task is open, `asking` while that task
 * waits on the person, `stopped` once that task was removed unmerged,
 * `shipping` while its ship runs, `failed` once the ship failed, `done`,
 * `dropped` when it has nothing to take, or `abandoned` with the whole run.
 * A stopped or failed project stops the whole run.
 */
export type CascadeStatus =
	| "waiting"
	| "registry"
	| "bumping"
	| "asking"
	| "stopped"
	| "shipping"
	| "failed"
	| "done"
	| "dropped"
	| "abandoned";

/** One project's part in a cascade, as its plan named it and how far it came. */
export interface CascadeStep extends ShipStep {
	/** How this step adopts upstream versions; agent adoption waits for its task to merge. */
	adopt?: "mechanical" | "agent";
	instructions?: string;
	status: CascadeStatus;
	/** When it first found its bump's versions not yet served by npm, while `registry`. */
	registrySince?: string;
	/** Its bump task's number in its own project, once added. */
	task: number | null;
	/** When its ship started, as its project's `ship.json` has it, once started. */
	ship: string | null;
	/** What its ship published, at the versions it went to, once done. */
	published: Pin[];
	/** Why it stopped, failed or was dropped; null otherwise. */
	note: string | null;
	/** Its steps in the order it takes them, each with its times, last check and log. */
	stages: Stage[];
}

/** Browse past ships and their logs with `kept` and `stageLog`; no old run resumes. */
export class Cascades {
	readonly history: ShipHistory;
	constructor(storage: Storage, fs: Fs) {
		this.history = new ShipHistory(storage, fs);
	}
	async current(): Promise<Cascade | null> {
		return null;
	}
	async shown(): Promise<{ cascade: Cascade | null; ship: Ship | null }> {
		return { cascade: null, ship: null };
	}
	async kept(
		id: string,
	): Promise<{ cascade: Cascade; ship: Ship | null } | null> {
		const cascade = await this.history.read(id);
		return cascade === null ? null : { cascade: upgraded(cascade), ship: null };
	}
	async stageLog(
		id: string,
		slug: string,
		key: StageKey,
	): Promise<string | null> {
		const shown = await this.kept(id);
		const stage = shown?.cascade.steps
			.find((step) => step.slug === slug)
			?.stages.find((each) => each.key === key);
		return stage?.log == null ? null : this.history.slice(id, slug, stage.log);
	}
}
