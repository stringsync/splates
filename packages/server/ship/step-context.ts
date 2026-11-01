import type { Duration, WallClock } from "core/time";
import type { Cascade } from "./cascade";
import type { ShipProject } from "./graph";
import type { ShipLive } from "./live";
import type { ShipRegistry } from "./registry";
import type { Shipping } from "./run";

/** A new ship keeps its project snapshots alongside the legacy-compatible timeline. */
export interface StepRecord {
	cascade: Cascade;
	projects: ShipProject[];
}

/** What a stage needs from the step runner that executes it. */
export interface StepContext {
	clock: WallClock;
	signal: AbortSignal;
	live: Pick<ShipLive, "check">;
	registry: Pick<ShipRegistry, "published">;
	pause?: () => Promise<void>;
	/** The path of a step's log. */
	logOf(id: string, slug: string): string;
	active(record: StepRecord): Promise<boolean>;
	save(record: StepRecord): Promise<void>;
	log(id: string, slug: string, text: string): Promise<void>;
	stamp(after?: Duration): string;
	/** Records the publisher of the step in flight, so Abandon can stop it. */
	publishing(shipping: Pick<Shipping, "stop"> | null): void;
}
