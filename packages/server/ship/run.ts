import type { Resource } from "core/disposable";
import type { Logger } from "core/log";
import type { Fs, Ps, TerminalChild } from "core/system";
import { SystemWallClock, type WallClock } from "core/time";
import { fail } from "../exit";
import type { Document, Storage } from "../storage";
import { ReleaseGit } from "./git";
import {
	ANSI,
	NPM_ENV,
	quietly,
	RELEASE_PROMPT,
	TERMINAL,
} from "./npm-terminal";
import type { ShipBump } from "./plan";
import { SHIP_STAGES, type Ship, type ShipStatus, shipRecord } from "./record";
import {
	type ReleaseStep,
	ReleaseStepsFollower,
	readReleaseSteps,
	releaseFailure,
} from "./release-steps";
import type { ShipLock } from "./ship-lock";
import {
	begun,
	ended,
	pendingStage,
	type Stage,
	type StageKey,
} from "./stages";

export type { Ship, ShipStatus, ShipWait } from "./record";
export { SHIP_STAGES, shipRecord } from "./record";

/** What a {@link Shipping} works with. */
export interface ShippingOptions {
	/** The project's records, which keep the ship as `ship.json`. */
	storage: Storage;
	fs: Fs;
	ps: Ps;
	log: Logger;
	/** The project's main tree, where the ship command runs. */
	root: string;
	/** The project's directory under the splates home, which keeps the output. */
	dir: string;
	/** The `ship` command its `splates.config.ts` names, or null for none. */
	command: string | null;
	/**
	 * Run in the root before the command, via `sh -c`: merges bring the main
	 * tree dependencies it has never installed, and the command's checks need
	 * them. A nonzero exit fails the ship before it releases anything.
	 */
	prepare?: string | null;
	/** The project's slug, or the name of the ship target that `target` names. */
	slug: () => Promise<string>;
	/**
	 * The name of the ship target this runs, for a repository whose `ships`
	 * name several: its record and output are its own.
	 */
	target?: string;
	/** The version the target is at; the root `package.json`'s by default. */
	version?: () => Promise<string | null>;
	/** Shared by the targets of one repository, so only one ships at a time. */
	lock?: ShipLock;
	clock?: WallClock;
	/** Release-branch checks; the project at root by default. */
	git?: Pick<ReleaseGit, "sync">;
}

/** The error of a ship the person stopped. */
const STOPPED = "stopped: the person abandoned the ship";

/** How many lines of output a failed ship keeps as its error. */
const TAIL = 20;

/**
 * Runs a project's ship on the server's machine: pushes the release branch,
 * then runs the project's `ship` command from its main tree. Publishing runs
 * in a job npm trusts, so no step waits on the person; the release's own
 * question is answered yes, since the person asked for the ship. Its output
 * goes to a file for the page to follow.
 */
export class Shipping implements Resource {
	private readonly record: Document<Ship>;
	private readonly clock: WallClock;
	private child: TerminalChild | null = null;
	private going: Promise<void> | null = null;
	private disposed = false;
	/** Whether the person stopped the ship under way. */
	private stopped = false;
	/** Where the ship under way writes its output. */
	private log: string | null = null;
	/** How many bytes its log holds, where the next step's slice begins. */
	private bytes = 0;
	constructor(private readonly opts: ShippingOptions) {
		this.record = shipRecord(opts.storage, opts.target);
		this.clock = opts.clock ?? new SystemWallClock();
	}

	/** Where the output of a ship whose cascade names no log goes. */
	get output(): string {
		return `${this.opts.dir}/ship${this.opts.target === undefined ? "" : `.${this.opts.target}`}.log`;
	}

	/** Where the ship command writes the steps of its Release. */
	get events(): string {
		return `${this.log ?? this.output}.events`;
	}

	/** Where the output of the latest ship is. */
	async outputOf(): Promise<string> {
		return this.log ?? (await this.record.read())?.log ?? this.output;
	}

	/** The latest ship, going or ended, or null when the project never shipped. */
	current(): Promise<Ship | null> {
		return this.record.read();
	}

	/** Whether a ship runs here now. */
	get running(): boolean {
		return this.going !== null;
	}

	/**
	 * Starts a ship at `bump`, refused while one runs or when the project
	 * names no `ship`. Its output goes to `log`, added to what is there, as a
	 * retry in a cascade's history adds to it, or else to {@link output},
	 * written afresh.
	 */
	async start(
		bump: ShipBump = "patch",
		{ log }: { log?: string } = {},
	): Promise<Ship> {
		const command =
			this.opts.command ??
			fail(
				"not_found",
				"this project names no `ship` command in splates.config.ts",
				{ root: this.opts.root },
			);
		if (this.going !== null) {
			fail("conflict", "a ship is under way already", {
				root: this.opts.root,
			});
		}
		const { lock } = this.opts;
		if (lock !== undefined && lock.holder !== null && lock.holder !== this) {
			fail("conflict", "another ship is under way in this repository", {
				root: this.opts.root,
			});
		}
		const ship: Ship = {
			project: await this.opts.slug(),
			command,
			bump,
			status: "running",
			step: "ship",
			from: await this.version(),
			to: null,
			started: this.stamp(),
			ended: null,
			waiting: null,
			error: null,
			resumed: 0,
			log: log ?? this.output,
			stages: SHIP_STAGES.map((key) => pendingStage(key)),
		};
		const { fs } = this.opts;
		const path = ship.log as string;
		await fs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
		if (log === undefined || !(await fs.exists(path))) {
			await fs.write(path, "");
		}
		this.log = path;
		await fs.write(this.events, "");
		this.bytes = (await fs.readBytes(path)).byteLength;
		this.stopped = false;
		await this.record.write(ship);
		this.run(command, bump);
		return ship;
	}

	/**
	 * Runs again a ship a server that stopped left running, which finishes it:
	 * the release's RELEASE file has it publish what it had not.
	 */
	async resume(): Promise<void> {
		const left = await this.record.read();
		if (left?.status !== "running" || this.going !== null) {
			return;
		}
		const command = this.opts.command ?? left.command;
		this.log = left.log ?? this.output;
		this.bytes = await this.opts.fs
			.readBytes(this.log)
			.then((bytes) => bytes.byteLength)
			.catch(() => 0);
		this.stopped = false;
		await this.record.write({
			...left,
			command,
			step: "ship",
			waiting: null,
			resumed: left.resumed + 1,
			// What did not end runs again; what ended stays as it was.
			...(left.stages === undefined
				? {}
				: {
						stages: left.stages.map((stage) =>
							stage.ended === null ? { ...stage, state: "pending" } : stage,
						),
					}),
		});
		await this.say(
			"\n[splates server restarted: running the ship again to finish it]\n",
		);
		this.opts.log.info(`resuming the ship of ${left.project}`);
		this.run(command, left.bump ?? "patch");
	}

	/** Waits for the ship under way, if any, to end. */
	async settled(): Promise<void> {
		await this.going;
	}

	/**
	 * Stops the ship under way, as abandoning its cascade does: its command is
	 * killed and the ship ends failed. What it published stays published.
	 */
	async stop(): Promise<void> {
		if (this.going === null) {
			return;
		}
		this.stopped = true;
		this.child?.kill();
		await this.going;
	}

	dispose(): void {
		this.disposed = true;
		this.child?.kill();
	}

	private run(command: string, bump: ShipBump): void {
		if (this.opts.lock !== undefined) {
			this.opts.lock.holder = this;
		}
		this.going = this.steps(command, bump)
			.catch(async (error: unknown) => {
				await this.end("failed", String(error));
			})
			.finally(() => {
				if (this.opts.lock?.holder === this) {
					this.opts.lock.holder = null;
				}
				this.going = null;
				this.child = null;
			});
	}

	private async steps(command: string, bump: ShipBump): Promise<void> {
		const { ps, root } = this.opts;
		await this.sync("push");
		await this.update({ step: "ship", waiting: null });
		await this.stage("command", (stage) => ({
			...begun(stage, this.stamp()),
			log: { from: this.bytes, to: null },
		}));
		const { prepare } = this.opts;
		if (prepare) {
			await this.say(`$ ${prepare}\n`);
			const prepared = await this.watch(
				ps.startOnTerminal(["sh", "-c", prepare], { ...TERMINAL, cwd: root }),
				"ship",
			);
			if (prepared !== 0 || this.stopped) {
				await this.end(
					"failed",
					this.stopped ? STOPPED : `${prepare} exited ${prepared}`,
				);
				return;
			}
		}
		const code = await this.watch(
			ps.startOnTerminal(quietly(command), {
				...TERMINAL,
				cwd: root,
				env: {
					...NPM_ENV,
					SPLATES_SHIP_BUMP: bump,
					SPLATES_SHIP_EVENTS: this.events,
				},
			}),
			"ship",
		);
		if (code === 0 && !this.stopped) {
			await this.stage("command", (stage) => this.closed(stage, "done"));
			await this.sync("remote");
		}
		await this.end(
			code === 0 && !this.stopped ? "done" : "failed",
			this.stopped
				? STOPPED
				: code === 0
					? null
					: (releaseFailure(await this.releaseStepsOf()) ??
						(await this.tail(`${command} exited ${code}`))),
		);
	}

	private async releaseStepsOf(): Promise<ReleaseStep[]> {
		return readReleaseSteps(
			await this.opts.fs.read(this.events).catch(() => ""),
		);
	}

	/** A visible gate before publishing, and a check that the release commit reached origin. */
	private async sync(key: "push" | "remote"): Promise<void> {
		if (this.stopped || this.disposed) {
			throw new Error(STOPPED);
		}
		await this.stage(key, (stage) => ({
			...begun(stage, this.stamp(), "checking"),
			log: { from: this.bytes, to: null },
		}));
		try {
			const git = this.opts.git ?? new ReleaseGit(this.opts.ps, this.opts.root);
			const result = await git.sync();
			if (this.stopped || this.disposed) {
				throw new Error(STOPPED);
			}
			await this.say(`${result}\n`);
			await this.stage(key, (stage) => ({
				...this.closed(stage, "done"),
				check: { at: this.stamp(), result },
			}));
		} catch (error) {
			await this.say(`${String(error)}\n`);
			throw error;
		}
	}

	/**
	 * Follows `child` to its exit: its output to the file and the release's
	 * question answered yes.
	 */
	private async watch(
		child: TerminalChild,
		step: Ship["step"],
	): Promise<number> {
		this.child = child;
		let pending = "";
		let asked = false;
		const heard = async (text: string) => {
			await this.say(text);
			pending = (pending + text.replace(ANSI, "")).split(/\r?\n/).pop() ?? "";
			if (RELEASE_PROMPT.test(pending) && !asked) {
				asked = true;
				child.write("y\n");
			} else if (!RELEASE_PROMPT.test(pending)) {
				asked = false;
			}
		};
		// One reader at a time, so lines go in the order they came.
		let order = Promise.resolve();
		const decoder = new TextDecoder();
		// A terminal's output ends only when it is closed, not when the child
		// exits, so the reader runs beside the wait and the close ends it.
		const reading = (async () => {
			for await (const chunk of child.output) {
				const text = decoder.decode(chunk, { stream: true });
				order = order.then(() => heard(text));
			}
		})().catch(() => {});
		const following =
			step === "ship"
				? new ReleaseStepsFollower(this.opts.fs, this.events, {
						keep: async (steps) => {
							await this.stage("command", (stage) => ({
								...stage,
								releaseSteps: steps,
							}));
						},
					})
				: null;
		const code = await child.exited;
		await following?.flush();
		// What the child printed last may still be on its way.
		await Bun.sleep(20);
		child.close();
		await reading;
		await order;
		return code;
	}

	private async end(status: ShipStatus, error: string | null): Promise<void> {
		if (this.disposed) {
			// The server is stopping: left running, to finish as it starts again.
			return;
		}
		const at = this.stamp();
		await this.update({
			status,
			waiting: null,
			ended: at,
			error,
			to: status === "done" ? await this.version() : null,
		});
		for (const key of SHIP_STAGES) {
			await this.stage(key, (stage) =>
				stage.ended !== null
					? stage
					: stage.started === null
						? // The ship never got there.
							{ ...stage, state: "skipped", ended: at }
						: this.closed(stage, status === "done" ? "done" : "failed"),
			);
		}
	}

	/** `stage` ended now in `state`, its log slice closed where the log is. */
	private closed(stage: Stage, state: "done" | "failed"): Stage {
		return {
			...ended(stage, this.stamp(), state),
			log: stage.log === null ? null : { ...stage.log, to: this.bytes },
		};
	}

	/** Changes the step `key` of the ship under way, kept by a ship that has steps. */
	private async stage(
		key: StageKey,
		change: (stage: Stage) => Stage,
	): Promise<void> {
		await this.record.update((ship) => {
			if (ship === null) {
				throw new Error("the ship's record is gone");
			}
			return ship.stages === undefined
				? ship
				: {
						...ship,
						stages: ship.stages.map((stage) =>
							stage.key === key ? change(stage) : stage,
						),
					};
		});
	}

	/** Adds `text` to the ship's log, counting where the next slice begins. */
	private async say(text: string): Promise<void> {
		this.bytes += new TextEncoder().encode(text).byteLength;
		await this.opts.fs.append(this.log ?? this.output, text).catch(() => {});
	}

	private async update(change: Partial<Ship>): Promise<void> {
		await this.record.update((ship) => {
			if (ship === null) {
				throw new Error("the ship's record is gone");
			}
			return { ...ship, ...change };
		});
	}

	/** The root `package.json` version, or null when it has none. */
	private async version(): Promise<string | null> {
		if (this.opts.version !== undefined) {
			return this.opts.version();
		}
		try {
			const { version } = JSON.parse(
				await this.opts.fs.read(`${this.opts.root}/package.json`),
			) as { version?: unknown };
			return typeof version === "string" ? version : null;
		} catch {
			return null;
		}
	}

	/** The last lines of the output, or `otherwise` when it printed nothing. */
	private async tail(otherwise: string): Promise<string> {
		const output = await this.opts.fs
			.read(await this.outputOf())
			.catch(() => "");
		const last = output
			.replace(ANSI, "")
			.trim()
			.split("\n")
			.slice(-TAIL)
			.join("\n");
		return last === "" ? otherwise : `${otherwise}:\n${last}`;
	}

	private stamp(): string {
		return new Date(this.clock.now()).toISOString();
	}
}
