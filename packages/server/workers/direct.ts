import { type Logger, MemoryLogger } from "webappwiz/log";
import type { Lock, Ps } from "webappwiz/system";
import {
	Duration,
	SystemTimer,
	SystemWallClock,
	sleep,
	type Timer,
	type WallClock,
} from "webappwiz/time";
import type { FlyRunners } from "../cloud/fly-runners";
import type { FlyMachine, FlySize } from "../cloud/fly-types";
import { CORES_HELD } from "../server/cores";
import { HEAVY_HELD } from "../server/heavy";
import type { WorkerBudget } from "./budget";
import { RunnerClaims } from "./direct-claims";
import type {
	DirectJobReport,
	DirectPhase,
	DirectRunnerReport,
} from "./direct-runner-report";
import { fits, type JobSize, runnerSizes, sizeLabel } from "./job-size";
import type { JobSnapshot } from "./job-snapshot";
import { NoRunner } from "./no-runner";
import { TypeRefused } from "./provider";
import { WorkerRegistry } from "./registry";
import type { RunnerLedger } from "./runner-ledger";

/**
 * The runners `splates run` makes for itself in the project's Fly app, with
 * no `splates server`: each a machine carrying `DIRECT_TAG`, reached through
 * Fly's proxy as the server reaches its own (`FlyRunners`), holding as many
 * jobs at once as fit in its CPUs and memory. The cloud's list says what
 * there is; what this machine's jobs hold of each, and when each last ran
 * one, is kept here (`RunnerClaims`), under a lock, so two `splates run`s
 * here never overfill one. A job goes to a runner with room, else has one
 * made, the cheapest size that holds it, as the budget allows; past the
 * budget it waits while a runner that could hold it is busy, and is
 * refused when none could.
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
		const report: DirectJobReport = {
			id,
			runner: null,
			project: job.project,
			task: job.task,
			what: job.argv.join(" ").slice(0, 200),
			phase: "placing",
			code: null,
			reason: null,
			since: this.wall.now(),
			phaseSince: this.wall.now(),
			detail: null,
		};
		const said = new Set<string>();
		const tell: Tell = (phase, line, patch = {}) => {
			if (phase !== report.phase || report.phaseSince === undefined) {
				report.phaseSince = this.wall.now();
			}
			Object.assign(report, { phase, ...patch });
			// What a wait is for is the line that began it; later phases clear it.
			if (line !== null && WAITING.includes(phase)) {
				report.detail = line;
			} else if (!WAITING.includes(phase)) {
				report.detail = null;
			}
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
			tell("placing", `finding a runner with ${sizeLabel(job.size)}`);
			const machine = await this.place(id, job.size, job.signal, tell);
			let ran: { code: number; files: Map<string, Uint8Array> };
			try {
				ran = await this.runOn(machine, job, tell);
			} finally {
				await this.locked(() => this.claims.release(id, this.wall.now()));
			}
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

	/** Every runner made, with what each is doing now. */
	async list(): Promise<DirectRunner[]> {
		const sizes = await this.sizes();
		const machines = await this.machines();
		const address = await this.address();
		this.status.runners(machines.map((each) => runnerReport(each, sizes)));
		return Promise.all(
			machines.map(async (machine) => {
				const size = sizes.get(sizeOf(machine));
				return {
					id: nameOf(machine),
					type: sizeOf(machine),
					size: size === undefined ? null : capacityOf(size),
					dollarsPerHour: size?.dollarsPerHour ?? null,
					address,
					state: await this.state(machine),
					createdAt: createdAt(machine),
				};
			}),
		);
	}

	/**
	 * Stops counting each runner whose machine has stopped itself, as one
	 * does `idle` after its last job: from when it stopped, as near as that
	 * is known, so a laptop that slept leaves no spend running. Nothing is
	 * deleted by time. Answers the runners it settled.
	 */
	async settle(): Promise<string[]> {
		return await this.locked(() => this.settleLocked());
	}

	/** `settle`, for a caller that holds the lock. */
	private async settleLocked(): Promise<string[]> {
		const settled: string[] = [];
		const budget = await this.deps.budget();
		const counted = new Set(budget.running());
		for (const machine of await this.machines()) {
			const name = nameOf(machine);
			if (!counted.has(name) || !ASLEEP.includes(machine.state)) {
				continue;
			}
			const used = await this.claims.used(machine.id);
			const stopped = Math.min(
				this.wall.now(),
				(used ?? createdAt(machine)) + budget.runnerIdle().ms,
			);
			await budget.ended(name, stopped);
			settled.push(name);
		}
		return settled;
	}

	/** Deletes runner `name`, or every runner when it is null, answering what it deleted. */
	async destroy(name: string | null): Promise<string[]> {
		const deleted: string[] = [];
		await this.locked(async () => {
			for (const machine of await this.machines()) {
				if (name !== null && nameOf(machine) !== name) {
					continue;
				}
				await this.delete(machine);
				deleted.push(nameOf(machine));
				this.status.runners([
					{ ...runnerReport(machine, new Map()), state: "deleted" },
				]);
			}
		});
		return deleted;
	}

	/** Opens the job's channel to `machine` and runs it there. */
	private async runOn(
		machine: FlyMachine,
		job: DirectRun,
		tell: Tell,
	): Promise<{ code: number; files: Map<string, Uint8Array> }> {
		const name = nameOf(machine);
		tell("booting", `reaching ${name}`, { runner: name });
		await this.counting(machine);
		const socket = await this.deps.runners.reach(machine.id, job.signal);
		const registry = new WorkerRegistry(new MemoryLogger());
		try {
			const accepted = registry.accept(socket, "provisioned", name);
			socket.send("ready");
			await accepted;
			const runner = registry.worker(name);
			if (runner === undefined) {
				throw new Error(`${name} answered as another runner`);
			}
			tell("running", `on ${name}: ${shortened(job.argv.join(" "))}`);
			return await runner.job(
				{
					project: job.project,
					commit: job.commit,
					task: job.task,
					prepare: job.prepare,
					argv: job.argv,
					env: {
						...job.env,
						// What it asked is its own on the runner: it runs in the slot
						// and core claim the placement already holds.
						[HEAVY_HELD]: "runner",
						[CORES_HELD]: String(Math.max(1, Math.floor(job.size.cpus))),
					},
					files: job.files,
					timeoutMs: job.timeout === null ? null : job.timeout.ms,
				},
				{
					bundle: (tip) => this.deps.snapshot.bundle(job.cwd, job.commit, tip),
					output: job.output,
					...(job.signal === undefined ? {} : { signal: job.signal }),
				},
			);
		} finally {
			registry.dispose();
			socket.dispose();
		}
	}

	/** Finds job `id` room on a runner, having one made as needed, its room claimed. */
	private async place(
		id: string,
		size: JobSize,
		signal: AbortSignal | undefined,
		tell: Tell,
	): Promise<FlyMachine> {
		const refused = new Set<string>();
		for (;;) {
			signal?.throwIfAborted();
			const placed = await this.locked(() =>
				this.placeOnce(id, size, refused, tell),
			);
			if (placed !== null) {
				return placed;
			}
			await this.wait(POLL);
		}
	}

	/** One look for room, under the lock: the runner claimed, or null to look again. */
	private async placeOnce(
		id: string,
		size: JobSize,
		refused: Set<string>,
		tell: Tell,
	): Promise<FlyMachine | null> {
		const { cloud } = this.deps.runners;
		await this.settleLocked();
		const sizes = await this.sizes();
		const machines = (await this.machines()).sort(
			(one, other) =>
				Number(other.state === "started") - Number(one.state === "started") ||
				(sizes.get(sizeOf(one))?.dollarsPerHour ?? 0) -
					(sizes.get(sizeOf(other))?.dollarsPerHour ?? 0),
		);
		this.status.runners(machines.map((each) => runnerReport(each, sizes)));
		let holds = false;
		for (const machine of machines) {
			const type = sizes.get(sizeOf(machine));
			if (type === undefined || !fits(size, capacityOf(type))) {
				continue;
			}
			holds = true;
			const claimed = await this.claims.claimed(machine.id, id);
			if (
				fits(
					{
						cpus: size.cpus + claimed.cpus,
						memory: size.memory + claimed.memory,
					},
					capacityOf(type),
				)
			) {
				await this.claims.claim(id, machine.id, size);
				return machine;
			}
		}
		const [type] = runnerSizes(await cloud.sizes(), size, (name) =>
			refused.has(name),
		);
		if (type === undefined) {
			throw new NoRunner(
				`Fly.io has no size with ${sizeLabel(size)}: ask for less with \`splates run --cpus --memory\` or the project's \`job\` in splates.config.ts`,
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
				`making ${nameOf(machine)} in Fly.io: ${sizeLabel(capacityOf(type), type.dollarsPerHour)}`,
				{ runner: nameOf(machine) },
			);
			return machine;
		} catch (error) {
			if (!(error instanceof TypeRefused)) {
				throw error;
			}
			refused.add(error.type);
			return null;
		}
	}

	/** Counts a runner started again as running from now, which `settle` stopped counting. */
	private async counting(machine: FlyMachine): Promise<void> {
		const name = nameOf(machine);
		const budget = await this.deps.budget();
		const size = (await this.sizes()).get(sizeOf(machine));
		if (size !== undefined && !budget.running().includes(name)) {
			await budget.started(name, size.name, size.dollarsPerHour);
		}
	}

	/** Makes a runner of `type`, counted in the budget and the ledger from now. */
	private async make(type: FlySize): Promise<FlyMachine> {
		const name = `${DIRECT_PREFIX}${crypto.randomUUID().slice(0, 6)}`;
		const machine = await this.deps.runners.make(name, type, {
			[DIRECT_TAG]: name,
		});
		const budget = await this.deps.budget();
		await budget.started(name, type.name, type.dollarsPerHour);
		await this.deps.ledger
			?.note({
				row: "runner",
				id: name,
				type: type.name,
				cpus: type.cpus,
				memory: type.memory,
				provider: "fly",
				dollarsPerHour: type.dollarsPerHour,
				at: new Date(this.wall.now()).toISOString(),
			})
			.catch(() => {});
		return machine;
	}

	private async delete(machine: FlyMachine): Promise<void> {
		await this.deps.runners.cloud.destroy(machine.id);
		await this.claims.forget(machine.id);
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

	private async state(machine: FlyMachine): Promise<string> {
		if ((await this.claims.holding(machine.id)) > 0) {
			return "busy";
		}
		const used = await this.claims.used(machine.id);
		return machine.state === "started" && used !== null
			? `idle ${Math.round((this.wall.now() - used) / 1000)}s`
			: machine.state;
	}

	/** How many runners are up in the app, the server's and `splates run`'s alike, from its own list. */
	private async runnersUp(): Promise<number> {
		return (await this.deps.runners.cloud.list()).filter(
			(machine) =>
				(machine.config.metadata[DIRECT_TAG] !== undefined ||
					machine.config.metadata[WORKER_TAG] !== undefined) &&
				UP.includes(machine.state),
		).length;
	}

	private async machines(): Promise<FlyMachine[]> {
		return (await this.deps.runners.cloud.list()).filter(
			(machine) => machine.config.metadata[DIRECT_TAG] !== undefined,
		);
	}

	private async address(): Promise<string> {
		return `${await this.deps.runners.cloud.appName()}.fly.dev`;
	}

	private async sizes(): Promise<Map<string, FlySize>> {
		return new Map(
			(await this.deps.runners.cloud.sizes()).map((size) => [size.name, size]),
		);
	}

	private async locked<T>(body: () => Promise<T>): Promise<T> {
		await this.deps.lock.acquire();
		try {
			return await body();
		} finally {
			await this.deps.lock.release();
		}
	}
}

/** The metadata every runner `splates run` made carries in the cloud, its value the runner's name. */
export const DIRECT_TAG = "splates-run";

/** The metadata of a machine the server made as a worker, which counts with `DIRECT_TAG` machines against the runner cap. */
export const WORKER_TAG = "splates-worker";

/** What a runner's name starts with. */
export const DIRECT_PREFIX = "splates-run-";

/** How often a job waiting for room looks again. */
const POLL = Duration.secs(5);

/** The states of a machine that has stopped itself, or is about to. */
const ASLEEP = ["stopping", "stopped", "suspended"];

/** The states of a machine that is up, billing for its CPUs. */
const UP = ["created", "starting", "started", "stopping"];

/** A heavy job `DirectRunners.run` runs. */
export interface DirectRun {
	/** The project's main tree's git dir, which its clone on a runner is kept by. */
	project: string;
	/** The checkout the commit is in, which its bundle is made from. */
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
	/** `busy`, `idle 120s`, or the machine's state, as `stopped`. */
	state: string;
	createdAt: number;
}

/** What `DirectRunners` runs on. */
export interface DirectRunnersDeps {
	/** Makes and reaches the runners, in the project's Fly app. */
	runners: FlyRunners;
	/** The machine's worker budget, read afresh, which the server shares. */
	budget: () => Promise<WorkerBudget>;
	/** The spend ledger the Billing page reads runners from. */
	ledger: RunnerLedger | null;
	/** Makes the bundle a runner lacks of a job's commit. */
	snapshot: JobSnapshot;
	/** Held while a job looks for room or a runner is settled or deleted, so two here never race. */
	lock: Lock;
	/** The file what this machine's jobs hold of the runners is kept in. */
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

/** Tells a job's step: its phase, a line for the person or null, and what else changed. */
type Tell = (
	phase: DirectPhase,
	line: string | null,
	patch?: Partial<DirectJobReport>,
) => void;

/** How often a job's report is sent again while it goes on. */
const HEARTBEAT = Duration.mins(1);

function runnerReport(
	machine: FlyMachine,
	sizes: ReadonlyMap<string, FlySize>,
): DirectRunnerReport {
	const size = sizes.get(sizeOf(machine));
	return {
		id: nameOf(machine),
		type: sizeOf(machine),
		cpus: size?.cpus ?? null,
		memory: size?.memory ?? null,
		dollarsPerHour: size?.dollarsPerHour ?? null,
		address: null,
		state: machine.state === "started" ? "up" : "booting",
		createdAt: createdAt(machine),
	};
}

function nameOf(machine: FlyMachine): string {
	return machine.config.metadata[DIRECT_TAG] ?? machine.name;
}

function sizeOf(machine: FlyMachine): string {
	return machine.config.metadata["splates-size"] ?? "";
}

function createdAt(machine: FlyMachine): number {
	return Date.parse(machine.created_at);
}

function capacityOf(size: FlySize): JobSize {
	return { cpus: size.cpus, memory: size.memory };
}

function shortened(text: string): string {
	return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

/** The phases a job waits in, whose line says what for. */
const WAITING: readonly DirectPhase[] = [
	"placing",
	"making",
	"booting",
	"waiting",
	"sending",
	"preparing",
];
