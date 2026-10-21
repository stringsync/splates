import { randomBytes } from "node:crypto";
import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import type { Logger } from "webappwiz/log";
import {
	Duration,
	SystemTimer,
	SystemWallClock,
	type Timer,
	type WallClock,
} from "webappwiz/time";
import type { WorkerAccess } from "./access";
import type {
	BudgetHeld,
	RaiseOffer,
	WorkerAlert,
	WorkerBudget,
} from "./budget";
import { BUDGET_EVERY, lookAtBudget } from "./budget-stop";
import { ComingWorkers } from "./coming";
import { WORKER_JOIN } from "./creds";
import { DEFAULT_IDLE_AFTER, IdleWorkers } from "./idle";
import { type ProvisionOptions, pickType } from "./pick-type";
import type {
	ProvisionedMachine,
	WorkerProvider,
	WorkerType,
} from "./provider";
import { ProviderReconciler, SWEEP_EVERY } from "./reconcile";
import { JOIN_WITHIN, type WorkerRecords } from "./records";
import type { WorkerRegistry } from "./registry";
import type { HeldSlot, Scheduler } from "./scheduler";
import { SNAPSHOT_SPLATES, type Snapshots } from "./snapshot";

/** How long placement waits after a failed provision before it asks the provider again. */
export const PROVISION_BACKOFF = Duration.mins(5);

/** A worker a provider was asked to make. */
export interface Provisioned {
	id: string;
	type: string;
	dollarsPerHour: number;
}

export type WorkerProvisioningEvents = {
	/** A limit reached a tier it had not yet in its window. */
	alert: WorkerAlert;
	/**
	 * Made workers were stopped, `reason` saying which limit was reached,
	 * with the agents still on them, which should stop at their checkpoint.
	 */
	stopping: { reason: string; held: HeldSlot[] };
	/** The budget allows made workers again: the conversations a stop held should carry on. */
	carrying: { held: BudgetHeld[] };
};

/**
 * Makes workers through a `WorkerProvider`: each boots from the snapshot
 * for its platform and spends a join token minted for it, joining as any
 * other worker does, and is destroyed when it is removed. Watching a
 * scheduler, it makes one whenever agents queue for want of a slot and
 * those already being made would not seat them, as far as the budget
 * allows; past it, the queue says which limit holds it. Once the day's or
 * month's limit is reached, it stops every made worker.
 */
export class WorkerProvisioning
	implements Eventful<WorkerProvisioningEvents>, Resource
{
	private readonly dispatcher = new Dispatcher<WorkerProvisioningEvents>();
	readonly events = this.dispatcher.events;
	private readonly coming = new ComingWorkers();
	private watching: (() => void) | null = null;
	private asking = false;
	private failedAt: number | null = null;
	private readonly wall: WallClock;
	private tick: Resource | null = null;
	private sweeping: Resource | null = null;
	private readonly reconciler: ProviderReconciler;
	private offering: RaiseOffer | null = null;
	private scheduler: Scheduler | null = null;
	private readonly idle: IdleWorkers;

	constructor(private readonly opts: WorkerProvisioningOptions) {
		this.wall = opts.wall ?? new SystemWallClock();
		this.reconciler = new ProviderReconciler({ ...opts, wall: this.wall });
		this.idle = new IdleWorkers(opts.records, this.wall);
	}

	get budget(): WorkerBudget {
		return this.opts.budget;
	}

	/** What a raise would buy while the budget holds the queue; null when it does not. */
	offer(): RaiseOffer | null {
		return this.offering;
	}

	/**
	 * Looks at the budget and the queue again, as after the budget changed,
	 * so a raise carries on the agents a stop held at once.
	 */
	async refill(): Promise<void> {
		if (this.scheduler !== null) {
			await this.look(this.scheduler);
		}
	}

	/** The types of worker the provider makes. */
	types(): Promise<WorkerType[]> {
		return this.opts.provider.types();
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
		const type = pickType(await provider.types(), opts);
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
		await records.set(id, {
			provisioned: {
				...provisioned,
				billing: type.billing,
				createdAt: this.wall.now(),
			},
		});
		registry.expect(id, "provisioned");
		this.coming.expect(id, type.slots);
		const { token } = await records.invite(
			(await this.opts.access?.mint()) ?? null,
		);
		await this.opts.budget.started(id, type.name, type.dollarsPerHour);
		let made: ProvisionedMachine;
		try {
			made = await this.reconciler.creating(id, () =>
				provider.create({
					id,
					type: type.name,
					snapshot: snapshot.id,
					join: [
						SNAPSHOT_SPLATES,
						"worker",
						"join",
						"--coordinator",
						coordinator,
						"--id",
						id,
						"--key-file",
					],
					joinEnv: { [WORKER_JOIN]: token },
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
						"--key-file",
					],
				}),
			);
		} catch (error) {
			this.coming.forget(id);
			registry.forget(id);
			await records.remove(id);
			await this.opts.budget.ended(id);
			throw error;
		}
		// Counted at the regular rate until the machine says it got spot.
		let rate = type.dollarsPerHour;
		if (made.spot === true) {
			rate = type.spotDollarsPerHour ?? rate;
			await records.set(id, {
				provisioned: {
					...provisioned,
					dollarsPerHour: rate,
					billing: type.billing,
					createdAt: this.wall.now(),
					spot: true,
				},
			});
			await this.opts.budget.started(id, type.name, rate);
		}
		this.opts.log.info(
			`provisioned ${id}, a ${type.name} at $${rate.toFixed(2)}/hour${made.spot === true ? " on spot" : ""}`,
		);
		return { id, ...provisioned, dollarsPerHour: rate };
	}

	/** Destroys the machine of worker `id`, one a provider made. */
	async destroy(id: string): Promise<void> {
		this.coming.forget(id);
		this.idle.forget(id);
		await this.opts.provider.destroy(id);
		await this.opts.budget.ended(id);
	}

	/**
	 * Squares the records with what the provider says exists: a made worker
	 * whose machine is gone is forgotten, and a machine no record knows,
	 * seen so for `ORPHAN_AFTER`, is destroyed, as one a failed or
	 * interrupted provision left; then the provider sweeps what it leaves
	 * outside its machines. Answers the workers forgotten.
	 */
	reconcile(): Promise<string[]> {
		return this.reconciler.reconcile();
	}

	/**
	 * Makes workers for `scheduler`'s queue as it changes, keeping who holds
	 * slots on made workers for the budget's split, and looks at the budget
	 * as time passes, until disposed.
	 */
	watch(scheduler: Scheduler): void {
		this.scheduler = scheduler;
		this.watching?.();
		this.tick?.dispose();
		this.watching = scheduler.events.on("changed", () => {
			void this.opts.budget.ran(scheduler.held()).catch((error: unknown) => {
				this.opts.log.error(
					`who ran on made workers could not be kept: ${String(error)}`,
				);
			});
			this.idle.track(scheduler);
			void this.fill(scheduler);
		});
		const timer = this.opts.timer ?? new SystemTimer();
		this.tick = timer.setInterval(
			() => void this.look(scheduler),
			BUDGET_EVERY,
		);
		this.sweeping?.dispose();
		this.sweeping = timer.setInterval(
			() =>
				void this.reconcile().catch((error: unknown) => {
					this.opts.log.error(
						`made workers could not be squared with the provider: ${String(error)}`,
					);
				}),
			SWEEP_EVERY,
		);
	}

	/**
	 * Alerts each tier the budget newly reached, stops the made workers once
	 * the day's or month's limit is, carries on the agents a stop held once
	 * it allows again, and fills the queue as far as it now allows.
	 */
	async look(scheduler: Scheduler): Promise<void> {
		try {
			await lookAtBudget(
				{
					alert: (alert) => this.dispatcher.dispatch("alert", alert),
					stopping: (stopped) => this.dispatcher.dispatch("stopping", stopped),
					carrying: (carried) => this.dispatcher.dispatch("carrying", carried),
				},
				this.opts,
			);
		} catch (error) {
			this.opts.log.error(
				`the worker budget could not be looked at: ${String(error)}`,
			);
		}
		await this.retire(scheduler);
		await this.fill(scheduler);
	}

	/**
	 * Destroys each made worker that has not joined by the time its join
	 * token ran out, so placement makes another in its place, and each idle
	 * past its provider's `idleAfter`, as `IdleWorkers.due` says.
	 */
	private async retire(scheduler: Scheduler): Promise<void> {
		const { provider, retire, log } = this.opts;
		if (retire === undefined) {
			return;
		}
		try {
			this.idle.learn(await provider.types());
		} catch {
			// A type no longer offered keeps the platform last seen.
		}
		this.idle.track(scheduler);
		const unjoined = this.unjoined();
		if (unjoined.length > 0) {
			log.error(
				`made workers ${unjoined.join(", ")} did not join within ${JOIN_WITHIN.mins} minutes, so their join tokens ran out: destroying them`,
			);
		}
		const idle = this.idle
			.due(provider.idleAfter ?? DEFAULT_IDLE_AFTER)
			.filter((id) => !unjoined.includes(id));
		if (idle.length > 0) {
			log.info(`idle made workers ${idle.join(", ")}: destroying them`);
		}
		const due = [...unjoined, ...idle];
		if (due.length > 0) {
			await retire(due);
		}
	}

	/** The made workers asked for `JOIN_WITHIN` ago or more that have yet to join, which now never can. */
	private unjoined(): string[] {
		const now = this.wall.now();
		return this.opts.records.all
			.filter(
				(record) =>
					record.joinedAt === null &&
					!record.removing &&
					record.provisioned?.createdAt != null &&
					now - record.provisioned.createdAt >= JOIN_WITHIN.ms,
			)
			.map((record) => record.id);
	}

	/** Makes one worker when the queue has more waiting than is on its way, then looks again. */
	private async fill(scheduler: Scheduler): Promise<void> {
		if (this.asking) {
			return;
		}
		const { registry, budget, provider, log } = this.opts;
		const waiting = scheduler.queue();
		// A sleeping worker woken for the queue seats it before any is made.
		const seats = this.coming.seats(registry) + (this.opts.waking?.() ?? 0);
		if (waiting.length <= seats) {
			scheduler.withhold(null);
			this.offering = null;
			return;
		}
		if (
			this.failedAt !== null &&
			this.wall.now() - this.failedAt < PROVISION_BACKOFF.ms
		) {
			return;
		}
		this.asking = true;
		try {
			// One whose agent no type holds a key for waits for a worker that does.
			const holds = this.opts.holds ?? (() => true);
			const types = await provider.types();
			const first = waiting
				.slice(seats)
				.find((entry) => types.some((type) => holds(type.name, entry.agent)));
			if (first === undefined) {
				scheduler.withhold(null);
				return;
			}
			const type = pickType(types, {
				platform: first.platform,
				agent: first.agent,
				runs: (name) => holds(name, first.agent),
			});
			const refusal = budget.refusal(type.dollarsPerHour);
			scheduler.withhold(refusal);
			const shortfall = budget.shortfall(type.dollarsPerHour);
			this.offering =
				shortfall === null
					? null
					: {
							...shortfall,
							type: type.name,
							platform: type.platform,
							slots: type.slots,
							dollarsPerHour: type.dollarsPerHour,
							clears: Math.min(type.slots, waiting.length - seats),
						};
			if (refusal !== null) {
				return;
			}
			await this.provision({ type: type.name });
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
		this.tick?.dispose();
		this.tick = null;
		this.sweeping?.dispose();
		this.sweeping = null;
	}
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
	/** What made workers may cost, which placement makes none past. */
	budget: WorkerBudget;
	/**
	 * Stops the made workers `ids` once the day's or month's limit is
	 * reached: they take no new agents, and are destroyed once those on
	 * them end. Answers the agents still on them.
	 */
	stop?: (ids: string[]) => Promise<HeldSlot[]>;
	/**
	 * Destroys the made workers `ids`, idle past their limit: each takes no
	 * new agent and is destroyed once any that arrived since ends.
	 */
	retire?: (ids: string[]) => Promise<void>;
	/** Whether workers of `type` hold the key `agent` runs on; all do, unless said. */
	holds?: (type: string, agent: string) => boolean;
	/** The slots of sleeping workers woken for the queue that have yet to join; none, unless said. */
	waking?: () => number;
	log: Logger;
	wall?: WallClock;
	timer?: Timer;
}
