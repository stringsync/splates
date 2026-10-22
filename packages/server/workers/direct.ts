import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Logger } from "webappwiz/log";
import type { Lock, Ps } from "webappwiz/system";
import {
	Duration,
	SystemWallClock,
	sleep,
	type WallClock,
} from "webappwiz/time";
import { z } from "zod";
import type { CloudMachine, CloudProvider, CloudSize } from "../cloud";
import type { WorkerBudget } from "./budget";
import {
	type DirectJob,
	directBootScript,
	directFilesScript,
	directIdleScript,
	directJobScript,
	directReserveScript,
	jobRef,
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

	constructor(private readonly deps: DirectRunnersDeps) {
		this.wall = deps.wall ?? new SystemWallClock();
		this.wait = deps.wait ?? sleep;
	}

	/** Runs `job` on a runner, streaming its output, answering its exit code and files. */
	async run(
		job: DirectRun,
	): Promise<{ code: number; files: Map<string, Uint8Array> }> {
		const id = crypto.randomUUID().slice(0, 8);
		const project = projectKey(job.project);
		const host = await this.place(id, project, job.size, job.signal);
		const at = new Date(this.wall.now()).toISOString();
		const { shell } = this.deps;
		await shell.push(host, job.cwd, job.commit, project, jobRef(id));
		const spec: DirectJob = {
			id,
			project,
			commit: job.commit,
			size: job.size,
			argv: job.argv,
			env: job.env,
			prepare: job.prepare,
			timeout: job.timeout === null ? null : Math.ceil(job.timeout.secs),
			files: job.files.length > 0,
		};
		const child = shell.start(host, directJobScript(spec));
		const hangUp = () => void child.stdin.close().catch(() => {});
		job.signal?.addEventListener("abort", hangUp, { once: true });
		const pump = async (stream: ReadableStream<Uint8Array>) => {
			for await (const bytes of stream) {
				job.output(bytes);
			}
		};
		let code: number;
		try {
			await Promise.all([pump(child.stdout), pump(child.stderr)]);
			code = await child.exited;
		} finally {
			job.signal?.removeEventListener("abort", hangUp);
		}
		const files = new Map<string, Uint8Array>();
		if (job.files.length > 0) {
			const sent = await shell.capture(
				host,
				directFilesScript({ id, project: spec.project, names: job.files }),
			);
			for (const line of sent.stdout.split("\n")) {
				const tab = line.indexOf("\t");
				if (tab > 0) {
					files.set(
						line.slice(0, tab),
						new Uint8Array(Buffer.from(line.slice(tab + 1), "base64")),
					);
				}
			}
		}
		await this.deps.ledger
			?.note({
				row: "job",
				id,
				runner: host.id,
				project: job.project,
				task: job.task,
				what: job.argv.join(" ").slice(0, 200),
				at,
				until: new Date(this.wall.now()).toISOString(),
			})
			.catch(() => {});
		return { code, files };
	}

	/** Every runner made, with what each is doing now. */
	async list(): Promise<DirectRunner[]> {
		const sizes = await this.sizes();
		const machines = await this.deps.cloud.machines(DIRECT_TAG);
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
	): Promise<RunnerHost> {
		const said = new Set<string>();
		const say = (line: string) => {
			if (!said.has(line)) {
				said.add(line);
				this.deps.log.info(line);
			}
		};
		const refused = new Set<string>();
		try {
			for (;;) {
				signal?.throwIfAborted();
				await this.deps.lock.acquire();
				try {
					const placed = await this.placeOnce(id, project, size, refused, say);
					if (placed !== null) {
						return placed;
					}
				} finally {
					await this.deps.lock.release();
				}
				await this.wait(POLL);
			}
		} finally {
			await this.unclaim(id);
		}
	}

	/** One look for room, under the lock: the runner reserved, or null to look again. */
	private async placeOnce(
		id: string,
		project: string,
		size: JobSize,
		refused: Set<string>,
		say: (line: string) => void,
	): Promise<RunnerHost | null> {
		const { cloud } = this.deps;
		const sizes = await this.sizes();
		const machines = (await cloud.machines(DIRECT_TAG)).sort(
			(one, other) =>
				(sizes.get(one.type)?.dollarsPerHour ?? 0) -
				(sizes.get(other.type)?.dollarsPerHour ?? 0),
		);
		const claims = await this.claims();
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
				const claimed = claims
					.filter((claim) => claim.machine === machine.id && claim.job !== id)
					.reduce(
						(sum, claim) => ({
							cpus: sum.cpus + claim.cpus,
							memory: sum.memory + claim.memory,
						}),
						{ cpus: 0, memory: 0 },
					);
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
			await this.claim(id, booting.id, size);
			say(`waiting for runner ${nameOf(booting)} to boot`);
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
				`${cloud.name} has no size with ${sizeLabel(size)} to order now: ask for less with \`splates run --cpus --memory\` or the project's \`job\` in splates.config.ts, or run it here with \`splates run --local\``,
			);
		}
		const budget = await this.deps.budget();
		const refusal = budget.refusal(type.dollarsPerHour);
		if (refusal !== null) {
			if (holds) {
				say(
					`waiting for room on a runner: another would cost $${type.dollarsPerHour.toFixed(2)}/h, and the ${refusal}`,
				);
				return null;
			}
			throw new NoRunner(
				`no runner made: a ${sizeLabel(capacityOf(type), type.dollarsPerHour)} runner is past the budget, ${refusal}. Raise it with \`splates budget raise\`, or run it here with \`splates run --local\``,
			);
		}
		try {
			const machine = await this.make(type);
			await this.claim(id, machine.id, size);
			say(
				`making a runner in ${cloud.name}: ${sizeLabel(capacityOf(type), type.dollarsPerHour)}, a few minutes to boot`,
			);
		} catch (error) {
			if (!(error instanceof TypeRefused)) {
				throw error;
			}
			refused.add(error.type);
		}
		return null;
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

	/** The claims of jobs here waiting for a runner to boot, those whose process is gone dropped. */
	private async claims(): Promise<Claim[]> {
		const read = await readFile(this.deps.claims, "utf8").catch(() => "[]");
		const parsed = Claims.safeParse(JSON.parse(read));
		return (parsed.success ? parsed.data : []).filter((claim) =>
			this.deps.ps.alive(claim.pid),
		);
	}

	private async claim(
		job: string,
		machine: string,
		size: JobSize,
	): Promise<void> {
		const claims = (await this.claims()).filter((each) => each.job !== job);
		await this.keep([...claims, { job, machine, ...size, pid: process.pid }]);
	}

	private async unclaim(job: string): Promise<void> {
		await this.deps.lock.acquire();
		try {
			const claims = await this.claims();
			if (claims.some((each) => each.job === job)) {
				await this.keep(claims.filter((each) => each.job !== job));
			}
		} finally {
			await this.deps.lock.release();
		}
	}

	private async keep(claims: Claim[]): Promise<void> {
		await mkdir(dirname(this.deps.claims), { recursive: true });
		await writeFile(this.deps.claims, JSON.stringify(claims));
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
}

const Claims = z.array(
	z.object({
		job: z.string(),
		/** The cloud's id of the machine it waits for. */
		machine: z.string(),
		cpus: z.number(),
		memory: z.number(),
		pid: z.number(),
	}),
);

type Claim = z.infer<typeof Claims>[number];

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
