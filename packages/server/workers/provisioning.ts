import { randomBytes } from "node:crypto";
import type { Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import { Duration, SystemWallClock, type WallClock } from "webappwiz/time";
import type { Platform, Scheduler } from "../scheduler";
import type { WorkerAccess } from "./access";
import type { WorkerProvider, WorkerType } from "./provider";
import type { WorkerRecords } from "./records";
import type { WorkerRegistry } from "./registry";
import { SNAPSHOT_SPLATES, type Snapshots, snapshotRecipe } from "./snapshot";

/** How long placement waits after a failed provision before it asks the provider again. */
export const PROVISION_BACKOFF = Duration.mins(5);

/** A worker a provider was asked to make. */
export interface Provisioned {
	id: string;
	type: string;
	dollarsPerHour: number;
}

/** What `WorkerProvisioning` makes workers with. */
export interface WorkerProvisioningOptions {
	provider: WorkerProvider;
	snapshots: Snapshots;
	records: WorkerRecords;
	registry: WorkerRegistry;
	/** Where a made worker gets the service token it passes Cloudflare Access with; none by default. */
	access?: WorkerAccess | null;
	/**
	 * The URL a made worker dials its coordinator at, from wherever it runs:
	 * the page's tunnel host; null when the page has none, so none is made.
	 */
	coordinator: () => string | null;
	/** How many workers placement may have made at once. */
	limit: number;
	log: Logger;
	wall?: WallClock;
}

/**
 * Makes workers through a `WorkerProvider`: each boots from the snapshot
 * for its platform and spends a join token minted for it, joining as any
 * other worker does, and is destroyed when it is removed. Watching a
 * scheduler, it makes one whenever agents queue for want of a slot and
 * those already being made would not seat them, up to `limit`.
 */
export class WorkerProvisioning implements Resource {
	/** Slots of the workers asked for that have yet to dial, by id. */
	private readonly coming = new Map<string, number>();
	private watching: (() => void) | null = null;
	private asking = false;
	private failedAt: number | null = null;
	private readonly wall: WallClock;

	constructor(private readonly opts: WorkerProvisioningOptions) {
		this.wall = opts.wall ?? new SystemWallClock();
	}

	/** Whether worker `id` is one a provider made. */
	made(id: string): boolean {
		return (this.opts.records.of(id)?.provisioned ?? null) !== null;
	}

	/**
	 * Asks the provider for a worker of `type`, by default the cheapest that
	 * runs on `platform`, or on any platform a snapshot can be built for.
	 * Answers once its machine boots; it joins later, on its own.
	 */
	async provision(opts: ProvisionOptions = {}): Promise<Provisioned> {
		const { provider, snapshots, records, registry } = this.opts;
		const type = pick(await provider.types(), opts);
		const coordinator = this.opts.coordinator();
		if (coordinator === null) {
			throw new Error(
				"a provisioned worker dials the page at its tunnel host: start `splates server` with a tunnel (`splates tunnel setup`)",
			);
		}
		const snapshot = await snapshots.current(type.platform);
		const id = `${type.name}-${randomBytes(3).toString("hex")}`;
		const provisioned = {
			type: type.name,
			dollarsPerHour: type.dollarsPerHour,
		};
		await records.set(id, { provisioned });
		registry.expect(id, "provisioned");
		this.coming.set(id, type.slots);
		const { token } = await records.invite(
			(await this.opts.access?.mint()) ?? null,
		);
		try {
			await provider.create({
				id,
				type: type.name,
				snapshot: snapshot.id,
				boot: [
					SNAPSHOT_SPLATES,
					"worker",
					"run",
					"--coordinator",
					coordinator,
					"--id",
					id,
					"--slots",
					String(type.slots),
					"--join",
					token,
					"--ephemeral",
				],
			});
		} catch (error) {
			this.coming.delete(id);
			registry.forget(id);
			await records.remove(id);
			throw error;
		}
		this.opts.log.info(
			`provisioned ${id}, a ${type.name} at $${type.dollarsPerHour.toFixed(2)}/hour`,
		);
		return { id, ...provisioned };
	}

	/** Destroys the machine of worker `id`, one a provider made. */
	async destroy(id: string): Promise<void> {
		this.coming.delete(id);
		await this.opts.provider.destroy(id);
	}

	/**
	 * Squares the records with what the provider says exists: a made worker
	 * whose machine is gone is forgotten; a machine no record knows is left
	 * be and logged, since splates destroys only what it made.
	 */
	async reconcile(): Promise<string[]> {
		const { provider, records, registry, log } = this.opts;
		const machines = await provider.list();
		const exists = new Set(machines.map((machine) => machine.id));
		const gone: string[] = [];
		for (const record of records.all) {
			if (record.provisioned !== null && !exists.has(record.id)) {
				await records.remove(record.id);
				if (record.access !== null) {
					await this.opts.access
						?.revoke(record.access)
						.catch((error: unknown) => {
							log.error(
								`could not revoke ${record.id}'s service token ${record.access}: ${String(error)}`,
							);
						});
				}
				registry.forget(record.id);
				gone.push(record.id);
			}
		}
		for (const machine of machines) {
			if (records.of(machine.id) === undefined) {
				log.error(
					`the worker provider has a machine ${machine.id} that splates does not know: destroy it by hand if it is not yours`,
				);
			}
		}
		return gone;
	}

	/** Makes workers for `scheduler`'s queue as it changes, until disposed. */
	watch(scheduler: Scheduler): void {
		this.watching?.();
		this.watching = scheduler.events.on("changed", () => {
			void this.fill(scheduler);
		});
	}

	/** Makes one worker when the queue has more waiting than is on its way, then looks again. */
	private async fill(scheduler: Scheduler): Promise<void> {
		if (this.asking) {
			return;
		}
		const { registry, records, limit, log } = this.opts;
		for (const id of this.coming.keys()) {
			if (registry.worker(id)?.connected !== false) {
				this.coming.delete(id);
			}
		}
		const waiting = scheduler.queue();
		const seats = [...this.coming.values()].reduce(
			(sum, slots) => sum + slots,
			0,
		);
		const made = records.all.filter((each) => each.provisioned !== null);
		const [first] = waiting.slice(seats);
		if (
			first === undefined ||
			made.length >= limit ||
			(this.failedAt !== null &&
				this.wall.now() - this.failedAt < PROVISION_BACKOFF.ms)
		) {
			return;
		}
		this.asking = true;
		try {
			await this.provision({ platform: first.platform });
			this.failedAt = null;
		} catch (error) {
			this.failedAt = this.wall.now();
			log.error(
				`no worker could be provisioned for the queue: ${error instanceof Error ? error.message : String(error)}`,
			);
			return;
		} finally {
			this.asking = false;
		}
		await this.fill(scheduler);
	}

	dispose(): void {
		this.watching?.();
		this.watching = null;
	}
}

/** What worker `WorkerProvisioning.provision` is asked for. */
export interface ProvisionOptions {
	/** The provider's type to make; by default its cheapest. */
	type?: string;
	/** The platform the cheapest must run; null or unset for any. */
	platform?: Platform | null;
}

/**
 * The type `opts` asks for: the one it names, else the cheapest on its
 * platform among those splates can build a snapshot for.
 */
function pick(types: WorkerType[], opts: ProvisionOptions): WorkerType {
	if (opts.type !== undefined) {
		const named = types.find((each) => each.name === opts.type);
		if (named === undefined) {
			throw new Error(
				`the worker provider makes no ${opts.type}: it makes ${types.map((each) => each.name).join(", ") || "nothing"}`,
			);
		}
		return named;
	}
	const [cheapest] = types
		.filter(
			(each) =>
				(opts.platform == null || each.platform === opts.platform) &&
				snapshotRecipe(each.platform, "") !== null,
		)
		.sort((one, other) => one.dollarsPerHour - other.dollarsPerHour);
	if (cheapest === undefined) {
		throw new Error(
			`the worker provider makes no worker splates can boot${opts.platform == null ? "" : ` on ${opts.platform}`}`,
		);
	}
	return cheapest;
}
