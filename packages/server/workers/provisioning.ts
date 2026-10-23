import { randomBytes } from "node:crypto";
import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import type { Logger } from "webappwiz/log";
import {
	SystemTimer,
	SystemWallClock,
	type Timer,
	type WallClock,
} from "webappwiz/time";
import type { WorkerAccess } from "./access";
import type { BudgetHeld, WorkerAlert, WorkerBudget } from "./budget";
import { BUDGET_EVERY, lookAtBudget } from "./budget-stop";
import { WORKER_JOIN } from "./creds";
import { DEFAULT_IDLE_AFTER, IdleWorkers } from "./idle";
import { OWN_BUILD_PATH, type OwnBuild } from "./own-build";
import { type ProvisionOptions, pickType } from "./pick-type";
import type {
	ProvisionedMachine,
	WorkerImage,
	WorkerProvider,
	WorkerSpec,
	WorkerType,
} from "./provider";
import { type DirectSweep, ProviderReconciler, SWEEP_EVERY } from "./reconcile";
import { JOIN_WITHIN, type WorkerRecords } from "./records";
import type { WorkerRegistry } from "./registry";
import { RunnerDialer } from "./runner-dialer";
import type { RunnerLedger } from "./runner-ledger";
import type { HeldSlot, Scheduler } from "./scheduler";
import { SNAPSHOT_SPLATES, type Snapshots } from "./snapshot";

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
 * other worker does, and is destroyed when it is removed. Once the day's
 * or month's limit is reached, it stops every made worker, and it destroys
 * one left idle.
 */
export class WorkerProvisioning
	implements Eventful<WorkerProvisioningEvents>, Resource
{
	private readonly dispatcher = new Dispatcher<WorkerProvisioningEvents>();
	readonly events = this.dispatcher.events;
	private watching: (() => void) | null = null;
	private readonly wall: WallClock;
	private tick: Resource | null = null;
	private sweeping: Resource | null = null;
	private readonly reconciler: ProviderReconciler;
	private scheduler: Scheduler | null = null;
	private readonly idle: IdleWorkers;
	/** Keeps the runners the server reaches dialed; null for a provider whose machines dial in. */
	private readonly dialer: RunnerDialer | null;

	constructor(private readonly opts: WorkerProvisioningOptions) {
		this.wall = opts.wall ?? new SystemWallClock();
		this.reconciler = new ProviderReconciler({ ...opts, wall: this.wall });
		this.idle = new IdleWorkers(opts.records, this.wall);
		const { provider } = opts;
		this.dialer =
			provider.reach === undefined
				? null
				: new RunnerDialer({
						reach: {
							reach: (id, signal) =>
								(provider.reach as NonNullable<typeof provider.reach>).call(
									provider,
									id,
									signal,
								),
						},
						registry: opts.registry,
						records: opts.records,
						log: opts.log,
						wall: this.wall,
					});
		// Made before a restart: dialed again, since none dials in.
		for (const record of opts.records.all) {
			if (record.provisioned !== null && !record.removing) {
				this.dialer?.dial(record.id);
			}
		}
	}

	get budget(): WorkerBudget {
		return this.opts.budget;
	}

	/** The server's own build, which each worker made runs; null on a release. */
	get ownBuild(): OwnBuild | null {
		return this.opts.ownBuild ?? null;
	}

	/**
	 * Looks at the budget again, as after it changed, so a raise carries on
	 * the agents a stop held at once.
	 */
	async refill(): Promise<void> {
		if (this.scheduler !== null) {
			await this.look(this.scheduler);
		}
	}

	/**
	 * How many runners are up in the provider's account, whoever made them;
	 * null when it cannot be asked. A runner's record with no machine behind
	 * it does not count.
	 */
	async runnersUp(): Promise<number | null> {
		const { provider } = this.opts;
		try {
			return provider.running
				? await provider.running()
				: (await provider.list()).length;
		} catch (error) {
			this.opts.log.error(
				`the runners up could not be counted: ${String(error)}`,
			);
			return null;
		}
	}

	/** The types of worker the provider makes. */
	types(): Promise<WorkerType[]> {
		return this.opts.provider.types();
	}

	/** The snapshots its provider keeps and what each costs; none when it cannot say. */
	async images(): Promise<WorkerImage[]> {
		return (await this.opts.provider.images?.()) ?? [];
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
		const { provider, records, registry } = this.opts;
		const type = pickType(await provider.types(), opts);
		const coordinator = this.opts.coordinator();
		if (this.dialer === null && coordinator === null) {
			throw new Error(
				"a provisioned worker dials the page at its tunnel host: start `splates server` with a tunnel (`splates tunnel setup`)",
			);
		}
		const id = `${type.name}-${randomBytes(3).toString("hex")}`;
		const provisioned = {
			type: type.name,
			dollarsPerHour: type.dollarsPerHour,
			...(type.cpus === undefined ? {} : { cpus: type.cpus }),
			...(type.memory === undefined ? {} : { memory: type.memory }),
		};
		await records.set(id, {
			provisioned: {
				...provisioned,
				billing: type.billing,
				createdAt: this.wall.now(),
			},
		});
		registry.expect(id, "provisioned");
		// Reached, it needs nothing to dial in with: no join or service token.
		const spec =
			this.dialer !== null || coordinator === null
				? reachedSpec(id, type.name)
				: await this.dialingSpec(id, type, coordinator);
		await this.opts.budget.started(id, type.name, type.dollarsPerHour);
		await this.keepMade(id, type, type.dollarsPerHour);
		let made: ProvisionedMachine;
		try {
			made = await this.reconciler.creating(id, () => provider.create(spec));
		} catch (error) {
			registry.forget(id);
			await records.remove(id);
			await this.opts.budget.ended(id);
			await this.keepEnded(id);
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
			await this.keepMade(id, type, rate);
		}
		this.dialer?.dial(id);
		this.opts.log.info(
			`provisioned ${id}, a ${type.name} at $${rate.toFixed(2)}/hour${made.spot === true ? " on spot" : ""}`,
		);
		return { id, ...provisioned, dollarsPerHour: rate };
	}

	/**
	 * What a worker that dials in is made with: a join token, with a service
	 * token where the tunnel's Access asks one, and the commands that join
	 * and run it against `coordinator`.
	 */
	private async dialingSpec(
		id: string,
		type: WorkerType,
		coordinator: string,
	): Promise<WorkerSpec> {
		const { snapshots, records } = this.opts;
		// A runner never waits for a snapshot to be built: with none ready it
		// runs the recipe on a stock image, and the build goes on behind it.
		const snapshot = await snapshots.ready(type.platform);
		const { token } = await records.invite(
			(await this.opts.access?.mint()) ?? null,
		);
		return {
			id,
			type: type.name,
			snapshot: snapshot?.id ?? null,
			recipe: snapshot === null ? snapshots.recipe(type.platform) : null,
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
			build:
				this.opts.ownBuild == null
					? null
					: {
							url: new URL(OWN_BUILD_PATH, coordinator).href,
							token: this.opts.ownBuild.grant(),
						},
		};
	}

	/** Destroys the machine of worker `id`, one a provider made. */
	async destroy(id: string): Promise<void> {
		this.dialer?.forget(id);
		this.idle.forget(id);
		await this.opts.provider.destroy(id);
		await this.opts.budget.ended(id);
		await this.keepEnded(id);
	}

	/** Keeps runner `id`, of `type` at `dollarsPerHour`, in the ledger the Billing page reads. */
	private async keepMade(
		id: string,
		type: WorkerType,
		dollarsPerHour: number,
	): Promise<void> {
		await this.opts.ledger?.note({
			row: "runner",
			id,
			type: type.name,
			...(type.cpus === undefined ? {} : { cpus: type.cpus }),
			...(type.memory === undefined ? {} : { memory: type.memory }),
			provider: this.opts.provider.billing ?? null,
			dollarsPerHour,
			at: new Date(this.wall.now()).toISOString(),
		});
	}

	/** Keeps that runner `id` is destroyed now in the ledger. */
	private async keepEnded(id: string): Promise<void> {
		await this.opts.ledger?.note({
			row: "runner-ended",
			id,
			at: new Date(this.wall.now()).toISOString(),
		});
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
	 * Tracks idle workers as `scheduler` changes, and looks at the budget as
	 * time passes, until disposed.
	 */
	watch(scheduler: Scheduler): void {
		this.scheduler = scheduler;
		this.watching?.();
		this.tick?.dispose();
		this.watching = scheduler.events.on("changed", () => {
			this.idle.track(scheduler, this.opts.busy?.() ?? []);
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
	 * it allows again, and destroys made workers past their time.
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
	}

	/**
	 * Destroys each made worker that has not joined by the time its join
	 * token ran out, and each idle
	 * past its provider's `idleAfter`, as `IdleWorkers.due` says.
	 */
	private async retire(scheduler: Scheduler): Promise<void> {
		const { provider, retire, log } = this.opts;
		if (retire === undefined) {
			return;
		}
		this.idle.track(scheduler, this.opts.busy?.() ?? []);
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

	dispose(): void {
		this.dialer?.dispose();
		this.watching?.();
		this.watching = null;
		this.tick?.dispose();
		this.tick = null;
		this.sweeping?.dispose();
		this.sweeping = null;
	}
}

/** What a worker the server reaches is made with: nothing to join or run, since its image serves jobs. */
function reachedSpec(id: string, type: string): WorkerSpec {
	return {
		id,
		type,
		snapshot: null,
		recipe: null,
		join: [],
		joinEnv: {},
		boot: [],
		build: null,
	};
}

/** What `WorkerProvisioning` makes workers with. */
export interface WorkerProvisioningOptions {
	provider: WorkerProvider;
	snapshots: Snapshots;
	records: WorkerRecords;
	registry: WorkerRegistry;
	/** Where a made worker gets the service token it passes Cloudflare Access with; none by default. */
	access?: WorkerAccess | null;
	/** Reaps the runners `splates run` made in the project's cloud with each sweep; none by default. */
	direct?: DirectSweep;
	/**
	 * The URL a made worker dials its server at, from wherever it runs:
	 * the page's tunnel host; null when the page has none, so none is made.
	 */
	coordinator: () => string | null;
	/** What made workers may cost, which placement makes none past. */
	budget: WorkerBudget;
	/** The server's own build, which each worker made runs, when it runs from a checkout; none on a release. */
	ownBuild?: OwnBuild | null;
	/** Where each runner's life is kept for good, for the Billing page; nowhere by default. */
	ledger?: RunnerLedger;
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
	/**
	 * The made workers kept from being destroyed as idle for a reason of
	 * their own: a job running on a runner, or the one kept warm.
	 */
	busy?: () => Iterable<string>;
	log: Logger;
	wall?: WallClock;
	timer?: Timer;
}
