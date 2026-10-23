import type { Logger } from "webappwiz/log";
import type { Lock, Ps } from "webappwiz/system";
import {
	Duration,
	SystemTimer,
	SystemWallClock,
	sleep,
	type Timer,
	type WallClock,
} from "webappwiz/time";
import type { CloudMachine, CloudProvider, CloudSize } from "../cloud";
import type { WorkerBudget } from "./budget";
import { RunnerClaims } from "./direct-claims";
import { runOnHost, type Tell } from "./direct-job";
import type {
	DirectJobReport,
	DirectRunnerReport,
} from "./direct-runner-report";
import {
	directBootScript,
	directIdleScript,
	directReserveScript,
	type Reservation,
	type Reserved,
} from "./direct-script";
import type { RunnerHost, RunnerShell } from "./direct-ssh";
import {
	fits,
	type JobSize,
	locationOf,
	runnerSizes,
	sizeLabel,
} from "./job-size";
import { NoRunner } from "./no-runner";
import { TypeRefused } from "./provider";
import type { RunnerLedger } from "./runner-ledger";
import { SNAPSHOT_TAG } from "./snapshot";

/** The tag every runner `splates run` made carries in the cloud, its value the runner's name. */
export const DIRECT_TAG = "splates-run";

/** The tag of a machine the server made as a worker, which counts with `DIRECT_TAG` machines against the runner cap. */
export const WORKER_TAG = "splates-worker";

/** What a runner's name starts with. */
export const DIRECT_PREFIX = "splates-run-";

/** How long a runner may take to boot, or stay unreachable, before it counts as broken and is deleted. */
export const BOOT_LIMIT = Duration.mins(15);

/** How long a runner stands idle before `reap` deletes it. */
export const DIRECT_IDLE = Duration.mins(10);

/** How often a job waiting for a runner looks again. */
const POLL = Duration.secs(5);

/** A heavy job `DirectRunners.run` runs. */
export interface DirectRun {
	/** The project's main tree's git dir, which its clone on a runner is kept by. */
	project: string;
	/** The checkout the commit is in, which is pushed from. */
	cwd: string;
	commit: string;
	size: JobSize;
	argv: string[];
	env: Record<string, string>;
	prepare: string | null;
	timeout: Duration | null;
	/** Names of files the command writes in `$SPLATES_JOB_FILES`, to come back. */
	files: string[];
	task: string | null;
	output: (bytes: Uint8Array) => void;
	signal?: AbortSignal;
}

/** A runner `splates run` made, as `list` says. */
export interface DirectRunner {
	id: string;
	type: string;
	size: JobSize | null;
	dollarsPerHour: number | null;
	address: string | null;
	/** `busy`, `idle 120s`, `booting`, or `unreachable`. */
	state: string;
	createdAt: number;
}

/**
 * The runners `splates run` makes for itself in the project's cloud, with
 * no `splates server`: each a machine tagged `DIRECT_TAG`, reached over SSH,
 * holding as many jobs at once as fit in its CPUs and memory. The cloud's
 * tags and the runner itself say what there is and what each holds, so
 * nothing is kept here but the budget's ledger and the claims of jobs
 * waiting for a runner to boot. A job goes to a runner with room, else
 * waits for one booting that will have room, else has one made, the
 * cheapest size that holds it, as the budget allows; past the budget it
 * waits while a runner that could hold it is busy, and is refused when
 * none could.
 */
export class DirectRunners {
	private readonly wall: WallClock;
	private readonly wait: (duration: Duration) => Promise<void>;
	private readonly timer: Timer;
	private readonly status: DirectStatus;
	private readonly claims: RunnerClaims;

	constructor(private readonly deps: DirectRunnersDeps) {
		this.wall = deps.wall ?? new SystemWallClock();
		this.wait = deps.wait ?? sleep;
		this.timer = deps.timer ?? new SystemTimer();
		this.claims = new RunnerClaims(deps.claims, deps.ps);
		this.status = deps.status ?? {
			job: (_report, line) => {
				if (line !== null) {
					deps.log.info(line);
				}
			},
			runners: () => {},
		};
	}

	/** Runs `job` on a runner, streaming its output, answering its exit code and files. */
	async run(
		job: DirectRun,
	): Promise<{ code: number; files: Map<string, Uint8Array> }> {
		const id = crypto.randomUUID().slice(0, 8);
		const what = job.argv.join(" ").slice(0, 200);
		const report: DirectJobReport = {
			id,
			runner: null,
			project: job.project,
			task: job.task,
			what,
			phase: "placing",
			code: null,
			reason: null,
			since: this.wall.now(),
		};
		const said = new Set<string>();
		const tell: Tell = (phase, line, patch = {}) => {
			Object.assign(report, { phase, ...patch });
			const fresh = line !== null && !said.has(line);
			if (line !== null) {
				said.add(line);
			}
			this.status.job({ ...report }, fresh ? line : null);
		};
		// Heard again each minute, so a server tells one still going from one gone.
		const heartbeat = this.timer.setInterval(
			() => this.status.job({ ...report }, null),
			HEARTBEAT,
		);
		try {
			const ran = await this.runReported(id, job, tell);
			const took = Duration.ms(this.wall.now() - report.since).human();
			tell(
				"done",
				ran.code === 0 ? `done in ${took}` : `exited ${ran.code} after ${took}`,
				{ code: ran.code },
			);
			return ran;
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			tell("failed", `failed: ${reason}`, { reason });
			throw error;
		} finally {
			heartbeat.dispose();
		}
	}

	private async runReported(
		id: string,
		job: DirectRun,
		tell: Tell,
	): Promise<{ code: number; files: Map<string, Uint8Array> }> {
		const project = projectKey(job.project);
		tell("placing", `finding a runner with ${sizeLabel(job.size)}`);
		const host = await this.place(id, project, job.size, job.signal, tell);
		return await runOnHost(this.deps, host, {
			id,
			project,
			job,
			tell,
			wall: this.wall,
		});
	}

	/** Every runner made, with what each is doing now. */
	async list(): Promise<DirectRunner[]> {
		const sizes = await this.sizes();
		const machines = await this.deps.cloud.machines(DIRECT_TAG);
		this.status.runners(machines.map((each) => runnerReport(each, sizes)));
		return Promise.all(
			machines.map(async (machine) => {
				const size = sizes.get(machine.type);
				return {
					id: nameOf(machine),
					type: machine.type,
					size: size === undefined ? null : capacityOf(size),
					dollarsPerHour: size?.dollarsPerHour ?? null,
					address: machine.ipv4,
					state: await this.state(machine),
					createdAt: machine.createdAt,
				};
			}),
		);
	}

	/**
	 * Deletes each runner idle `idle` or longer, every idle one once the
	 * budget's day or month is spent, and each that never booted or has been
	 * unreachable past `BOOT_LIMIT`; answers what it deleted, and why.
	 */
	async reap(idle: Duration = DIRECT_IDLE): Promise<string[]> {
		const reaped: string[] = [];
		const stopped = (await this.deps.budget()).stopped();
		await this.deps.lock.acquire();
		try {
			for (const machine of await this.deps.cloud.machines(DIRECT_TAG)) {
				const state = await this.state(machine);
				const old = this.age(machine) >= BOOT_LIMIT.ms;
				const idleFor = /^idle (\d+)s$/.exec(state)?.[1];
				const why =
					(state === "booting" || state === "unreachable") && old
						? `${state} past ${BOOT_LIMIT.mins} minutes`
						: idleFor !== undefined && stopped !== null
							? stopped
							: idleFor !== undefined && Number(idleFor) >= idle.secs
								? `idle ${Duration.secs(Number(idleFor)).human()}`
								: null;
				if (why !== null) {
					await this.delete(machine);
					reaped.push(`${nameOf(machine)}: ${why}`);
					this.status.runners([
						{ ...runnerReport(machine, new Map()), state: "deleted" },
					]);
				}
			}
		} finally {
			await this.deps.lock.release();
		}
		return reaped;
	}

	/**
	 * Finds job `id` room on a runner, waiting for one to boot or having one
	 * made as needed, and answers the runner, its room reserved.
	 */
	private async place(
		id: string,
		project: string,
		size: JobSize,
		signal: AbortSignal | undefined,
		tell: Tell,
	): Promise<RunnerHost> {
		const refused = new Set<string>();
		try {
			for (;;) {
				signal?.throwIfAborted();
				await this.deps.lock.acquire();
				try {
					const placed = await this.placeOnce(id, project, size, refused, tell);
					if (placed !== null) {
						return placed;
					}
				} finally {
					await this.deps.lock.release();
				}
				await this.wait(POLL);
			}
		} finally {
			await this.deps.lock.acquire();
			try {
				await this.claims.release(id);
			} finally {
				await this.deps.lock.release();
			}
		}
	}

	/** One look for room, under the lock: the runner reserved, or null to look again. */
	private async placeOnce(
		id: string,
		project: string,
		size: JobSize,
		refused: Set<string>,
		tell: Tell,
	): Promise<RunnerHost | null> {
		const { cloud } = this.deps;
		const sizes = await this.sizes();
		const machines = (await cloud.machines(DIRECT_TAG)).sort(
			(one, other) =>
				(sizes.get(one.type)?.dollarsPerHour ?? 0) -
				(sizes.get(other.type)?.dollarsPerHour ?? 0),
		);
		this.status.runners(machines.map((each) => runnerReport(each, sizes)));
		let booting: CloudMachine | null = null;
		let holds = false;
		for (const machine of machines) {
			const type = sizes.get(machine.type);
			if (type === undefined || !fits(size, capacityOf(type))) {
				continue;
			}
			holds = true;
			const answer = await this.reserve(machine, {
				id,
				project,
				size,
				capacity: capacityOf(type),
			});
			if (answer === "ok" && machine.ipv4 !== null) {
				return { id: nameOf(machine), address: machine.ipv4 };
			}
			if (answer === "booting" && booting === null) {
				const claimed = await this.claims.claimed(machine.id, id);
				const room = capacityOf(type);
				if (
					fits(
						{
							cpus: size.cpus + claimed.cpus,
							memory: size.memory + claimed.memory,
						},
						room,
					)
				) {
					booting = machine;
				}
			}
		}
		if (booting !== null) {
			await this.claims.claim(id, booting.id, size);
			const half = Math.floor(this.age(booting) / 30_000) * 30;
			tell(
				"booting",
				`waiting for ${nameOf(booting)} to boot${half === 0 ? "" : `, ${Duration.secs(half).human()} so far`}`,
				{ runner: nameOf(booting) },
			);
			return null;
		}
		const [type] = runnerSizes(
			[...sizes.values()],
			cloud.defaults,
			size,
			(name) => refused.has(name),
		);
		if (type === undefined) {
			throw new NoRunner(
				`${cloud.name} has no size with ${sizeLabel(size)} to order now: ask for less with \`splates run --cpus --memory\` or the project's \`job\` in splates.config.ts`,
			);
		}
		const budget = await this.deps.budget();
		const refusal =
			budget.refusal(type.dollarsPerHour) ??
			budget.runnersRefusal(await this.runnersUp());
		if (refusal !== null) {
			if (holds) {
				tell(
					"waiting",
					`waiting for room on a runner: another would cost $${type.dollarsPerHour.toFixed(2)}/h, and the ${refusal}`,
				);
				return null;
			}
			throw new NoRunner(
				`no runner made: a ${sizeLabel(capacityOf(type), type.dollarsPerHour)} runner is past the budget, ${refusal}. Raise it with \`splates budget ${refusal.startsWith("runner limit") ? "set runners" : "raise"}\``,
			);
		}
		try {
			const machine = await this.make(type);
			await this.claims.claim(id, machine.id, size);
			this.status.runners([runnerReport(machine, sizes)]);
			tell(
				"making",
				`making ${nameOf(machine)} in ${cloud.name}: ${sizeLabel(capacityOf(type), type.dollarsPerHour)}, a few minutes to boot`,
				{ runner: nameOf(machine) },
			);
		} catch (error) {
			if (!(error instanceof TypeRefused)) {
				throw error;
			}
			refused.add(error.type);
		}
		return null;
	}

	/** How many runners are up in the cloud's account, the server's and `splates run`'s alike, from its own list. */
	private async runnersUp(): Promise<number> {
		const { cloud } = this.deps;
		return (
			(await cloud.machines(DIRECT_TAG)).length +
			(await cloud.machines(WORKER_TAG)).length
		);
	}

	/** Makes a runner of `type`, counted in the budget and the ledger from now. */
	private async make(type: CloudSize): Promise<CloudMachine> {
		const { cloud } = this.deps;
		const name = `${DIRECT_PREFIX}${crypto.randomUUID().slice(0, 6)}`;
		// `runnerSizes` offers only sizes some location stocks.
		const location = locationOf(type, cloud.defaults) as string;
		const [snapshot] = await cloud.snapshots(SNAPSHOT_TAG, "linux");
		const spec = (image: string, recipe: string | null) => ({
			name,
			type: type.name,
			image,
			location,
			userData: directBootScript(this.deps.publicKey, recipe),
			tags: { [DIRECT_TAG]: name },
		});
		let machine: CloudMachine;
		try {
			machine = await cloud.create(
				snapshot === undefined
					? spec(cloud.defaults.image, this.deps.recipe)
					: spec(snapshot, null),
			);
		} catch (error) {
			// A snapshot boots machines only in its own location.
			if (snapshot === undefined || error instanceof TypeRefused) {
				throw error;
			}
			machine = await cloud.create(
				spec(cloud.defaults.image, this.deps.recipe),
			);
		}
		const budget = await this.deps.budget();
		await budget.started(name, type.name, type.dollarsPerHour);
		await this.deps.ledger
			?.note({
				row: "runner",
				id: name,
				type: type.name,
				cpus: type.cpus,
				memory: type.memory,
				provider: cloud.billing,
				dollarsPerHour: type.dollarsPerHour,
				at: new Date(this.wall.now()).toISOString(),
			})
			.catch(() => {});
		return machine;
	}

	private async delete(machine: CloudMachine): Promise<void> {
		await this.deps.cloud.delete(machine.id);
		const name = nameOf(machine);
		await (await this.deps.budget()).ended(name);
		await this.deps.ledger
			?.note({
				row: "runner-ended",
				id: name,
				at: new Date(this.wall.now()).toISOString(),
			})
			.catch(() => {});
	}

	/** Reserves room for job `id` on `machine`; a machine not reachable yet is booting. */
	private async reserve(
		machine: CloudMachine,
		reservation: Reservation,
	): Promise<Reserved | "unreachable"> {
		if (machine.ipv4 === null || machine.status !== "running") {
			return this.age(machine) < BOOT_LIMIT.ms ? "booting" : "unreachable";
		}
		const answer = await this.deps.shell
			.capture(
				{ id: nameOf(machine), address: machine.ipv4 },
				directReserveScript(reservation),
			)
			.catch(() => null);
		const said = answer?.code === 0 ? answer.stdout.trim() : null;
		if (said === "ok" || said === "full" || said === "booting") {
			return said;
		}
		return this.age(machine) < BOOT_LIMIT.ms ? "booting" : "unreachable";
	}

	private async state(machine: CloudMachine): Promise<string> {
		if (machine.ipv4 === null || machine.status !== "running") {
			return "booting";
		}
		const answer = await this.deps.shell
			.capture(
				{ id: nameOf(machine), address: machine.ipv4 },
				directIdleScript(),
			)
			.catch(() => null);
		const said = answer?.code === 0 ? answer.stdout.trim() : "";
		return said === ""
			? "unreachable"
			: said.replace(/^idle (\d+)$/, "idle $1s");
	}

	private age(machine: CloudMachine): number {
		return this.wall.now() - machine.createdAt;
	}

	private async sizes(): Promise<Map<string, CloudSize>> {
		return new Map(
			(await this.deps.cloud.sizes()).map((size) => [size.name, size]),
		);
	}
}

/** What `DirectRunners` runs on. */
export interface DirectRunnersDeps {
	cloud: CloudProvider;
	/** The machine's worker budget, read afresh, which the server shares. */
	budget: () => Promise<WorkerBudget>;
	/** The spend ledger the Billing page reads runners from. */
	ledger: RunnerLedger | null;
	shell: RunnerShell;
	/** The runner key's public half, which each runner made lets in. */
	publicKey: string;
	/** What a runner of the stock image runs to have what a job needs; a snapshot has it already. */
	recipe: string | null;
	/** Held while a job looks for room or a runner is reaped, so two here never race. */
	lock: Lock;
	/** The file the claims of jobs waiting for a runner to boot are kept in. */
	claims: string;
	ps: Ps;
	log: Logger;
	wall?: WallClock;
	wait?: (duration: Duration) => Promise<void>;
	/** Times the heartbeat of a job's report. */
	timer?: Timer;
	/** Told each step of each job and the runners as listed; lines to the log by default. */
	status?: DirectStatus;
}

/**
 * Where `DirectRunners` says how its jobs and runners stand: a line for the
 * person at each new step, null on a report that only says it is still so,
 * and the runners as it listed them, for a server's Runners page.
 */
export interface DirectStatus {
	job(report: DirectJobReport, line: string | null): void;
	runners(runners: DirectRunnerReport[]): void;
}

/** How often a job's report is sent again while it goes on. */
const HEARTBEAT = Duration.mins(1);

function runnerReport(
	machine: CloudMachine,
	sizes: ReadonlyMap<string, CloudSize>,
): DirectRunnerReport {
	const size = sizes.get(machine.type);
	return {
		id: nameOf(machine),
		type: machine.type,
		cpus: size?.cpus ?? null,
		memory: size?.memory ?? null,
		dollarsPerHour: size?.dollarsPerHour ?? null,
		address: machine.ipv4,
		state:
			machine.status === "running" && machine.ipv4 !== null ? "up" : "booting",
		createdAt: machine.createdAt,
	};
}

/** A project's key on a runner, apart from every other's. */
export function projectKey(project: string): string {
	return new Bun.CryptoHasher("sha256")
		.update(project)
		.digest("hex")
		.slice(0, 16);
}

function nameOf(machine: CloudMachine): string {
	return machine.tags[DIRECT_TAG] ?? machine.name;
}

function capacityOf(size: CloudSize): JobSize {
	return { cpus: size.cpus, memory: size.memory };
}
