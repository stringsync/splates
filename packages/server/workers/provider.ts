import type { Duration } from "webappwiz/time";

/** The provider would not make a worker of `type`, though another type may do. */
export class TypeRefused extends Error {
	constructor(
		readonly type: string,
		reason: string,
	) {
		super(reason);
		this.name = "TypeRefused";
	}
}

/** The platforms a provider's machines run, as people name them. */
export const PLATFORMS = ["linux", "macos", "windows"] as const;
export type Platform = (typeof PLATFORMS)[number];

/** One kind of machine a provider can make, and what it costs. */
export interface WorkerType {
	/** What it is known by, as `splates worker add --type` names it. */
	name: string;
	platform: Platform;
	/** How many agents a worker of this type runs at once. */
	slots: number;
	/** Its CPUs, which heavy jobs are placed by; absent where the provider does not say. */
	cpus?: number;
	/** Its memory in GB, which heavy jobs are placed by; absent where the provider does not say. */
	memory?: number;
	/** What the user pays for one per hour, in US dollars. */
	dollarsPerHour: number;
	/** What one costs per hour on spot, in US dollars, for a provider with a spot market; absent for none. */
	spotDollarsPerHour?: number;
	/**
	 * How the provider bills a worker of this type: `"hour"` for each started
	 * hour in full from its creation until it is destroyed, so one idle past
	 * its limit is kept until its paid hour is nearly over; `"second"` for
	 * only the time it ran, so it is destroyed as soon as it is idle.
	 */
	billing: "hour" | "second";
}

/**
 * What a snapshot is built from: a shell script, run as root on a fresh
 * machine of the platform, that installs what a worker needs. It holds no
 * credentials, so the snapshot holds none.
 */
export interface SnapshotRecipe {
	platform: Platform;
	/** The splates version it installs. */
	version: string;
	script: string;
}

/** A snapshot a provider built, which workers boot from. */
export interface Snapshot {
	/** The provider's own name for it, opaque to splates. */
	id: string;
	/** The splates version its recipe installed. */
	version: string;
	/** When it was built, epoch milliseconds. */
	builtAt: number;
}

/** What it costs to keep a snapshot a provider built, as its API says. */
export interface WorkerImage {
	/** The snapshot's id, as `Snapshot.id`. */
	id: string;
	gigabytes: number;
	/** In US dollars. */
	dollarsPerMonth: number;
}

/** What a provider is asked to make. */
export interface WorkerSpec {
	/** What the server knows the worker by, and the provider names its machine for. */
	id: string;
	/** One of the provider's `types()`. */
	type: string;
	/** The snapshot it boots from, as `snapshot` answered it; null while none is ready. */
	snapshot: string | null;
	/**
	 * The recipe's script when `snapshot` is null: the machine boots from
	 * the provider's stock image and runs it as root, before `join`, to
	 * become what a snapshot would have been. Null with a snapshot.
	 */
	recipe: string | null;
	/**
	 * What the machine runs once booted, until it succeeds and before
	 * `boot`, with `SPLATES_HOME` a directory only root reads: it spends a
	 * join token, single use and short-lived, and keeps the key it answers
	 * there in `worker.env`, as `NAME=value` lines.
	 */
	join: string[];
	/**
	 * Added to the environment of `join`, where the join token is, since an
	 * argument would show in the process list to every user of the machine.
	 * It is a secret: put it where only the machine reads it, never in a
	 * log.
	 */
	joinEnv: Record<string, string>;
	/**
	 * What the machine runs once `join` has, and runs again if it stops:
	 * the worker, dialing its server with the key `join` kept, handed
	 * it in its environment, so a restart needs no token.
	 */
	boot: string[];
	/**
	 * The server's own build, when it runs from a checkout, which may be
	 * ahead of the release the snapshot installed: once `join` has, the
	 * machine fetches `url` showing `token` in `OWN_BUILD_HEADER`, with the
	 * service token `join` kept, and runs it as `boot`'s splates. A fetch
	 * that fails leaves the snapshot's. The token is a secret, as
	 * `joinEnv` is. None for a server on a release.
	 */
	build?: { url: string; token: string } | null;
}

/** A machine a provider made for splates. */
export interface ProvisionedMachine {
	/** The worker's id, as its `WorkerSpec` gave it. */
	id: string;
	type: string;
	/** Whether its machine is on spare capacity that may be taken back; absent when the provider has no such kind. */
	spot?: boolean;
}

/**
 * WorkerProvider is the seam onto whatever makes worker machines: a cloud
 * API in the user's own account, or anything else a repo's
 * `splates.config.ts` names as `workerProvider`:
 *
 * ```ts
 * export default { workerProvider: new MyProvider() } satisfies ConfigFile;
 * ```
 *
 * It assumes nothing of where cloud credentials live or where the work is
 * done, so a provider may run it in-process or ask a remote API. Machines
 * boot from a snapshot splates asks it to build, ready to work, and are
 * made only when work waits for them: none is kept warm.
 */
export interface WorkerProvider {
	/**
	 * How long a worker it made may sit idle, no agent on it and none queued
	 * that it could take, before it is destroyed, at the end of its paid hour
	 * when it bills by the hour; `DEFAULT_IDLE_AFTER` (15 minutes) when unset.
	 */
	readonly idleAfter?: Duration;
	/**
	 * The provider its bill is pulled into the spend ledger as, as
	 * `digitalocean`, which the Billing page sets each month's estimate of
	 * its runners beside; absent when no bill is pulled for it.
	 */
	readonly billing?: string;
	/** The types it makes, with what each costs per hour, as near what it bills as it can tell. */
	types(): Promise<WorkerType[]>;
	/**
	 * Builds a snapshot from `recipe`, answering it once workers can boot
	 * from it. Building one again replaces the last: a provider need keep
	 * only the newest.
	 */
	snapshot(recipe: SnapshotRecipe): Promise<Snapshot>;
	/** The snapshots it keeps and what each costs to keep, for the Billing page; absent when it bills nothing for them. */
	images?(): Promise<WorkerImage[]>;
	/**
	 * Makes a machine as `spec` says, answering once it is booting. Throws
	 * `TypeRefused` when the provider will not make its type now, leaving it
	 * out of `types` for a while, so another type is taken.
	 */
	create(spec: WorkerSpec): Promise<ProvisionedMachine>;
	/** Destroys worker `id`'s machine; silent when it is already gone. */
	destroy(id: string): Promise<void>;
	/** Every machine it made for splates that still exists. */
	list(): Promise<ProvisionedMachine[]>;
	/**
	 * Deletes what it left behind besides workers' machines, such as a
	 * snapshot's builder a build that died kept running, answering a name
	 * for each; asked every few minutes.
	 */
	sweep?(): Promise<string[]>;
}
