import type { Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import type { Fs, Ps, TerminalChild } from "webappwiz/system";
import { SystemWallClock, type WallClock } from "webappwiz/time";
import { fail } from "../exit";
import type { Document, Storage } from "../storage";
import { ReleaseGit } from "./git";
import {
	ANSI,
	AROUND_LINK,
	NPM_ENV,
	NPM_PAGE,
	OTP_PROMPT,
	quietly,
	RELEASE_PROMPT,
	TERMINAL,
	typedCodeError,
} from "./npm-terminal";
import type { ShipBump } from "./plan";
import {
	type ReleaseStep,
	ReleaseStepsFollower,
	readReleaseSteps,
	releaseFailure,
} from "./release-steps";
import {
	begun,
	ended,
	pendingStage,
	type Stage,
	type StageKey,
} from "./stages";
import { checkNpm, TOKEN_REFUSED } from "./token";

/** Where a project's records keep its latest ship. */
export function shipRecord(storage: Storage): Document<Ship> {
	return storage.document<Ship>("ship.json");
}

/** Where a ship stands: going, or how it ended. */
export type ShipStatus = "running" | "done" | "failed";

/**
 * What npm waits on the person for, on its own page: signing in, as
 * `npm login --auth-type=web` asks, or a publish's second factor.
 */
export interface ShipWait {
	kind: "login" | "2fa";
	/** npm's page, which the person opens from any device. */
	url: string;
	/** When npm began waiting, as ISO time. */
	since: string;
}

/**
 * A project's latest ship, kept in its records so a restarted server shows it
 * and finishes one it left running.
 */
export interface Ship {
	/** The project's slug, as `?project=` names it. */
	project: string;
	/** The `ship` command from its `splates.config.ts`. */
	command: string;
	/** The approved release type, passed to the command and kept across restarts. */
	bump: ShipBump;
	status: ShipStatus;
	/** Signing in to npm first, or running the ship command. */
	step: "login" | "ship";
	/** The root `package.json` version as the ship started. */
	from: string | null;
	/** The root `package.json` version once it is done; null before. */
	to: string | null;
	started: string;
	ended: string | null;
	/** What npm waits on the person for now, or null. */
	waiting: ShipWait | null;
	/** The last of the output of a ship that failed. */
	error: string | null;
	/** How many times a restart ran it again to finish it. */
	resumed: number;
	/** Where its output is; the project's own `ship.log` unless its cascade named one. */
	log?: string;
	/** Its steps (npm sign-in, 2FA, the ship command), each with its slice of the log; absent from older ships. */
	stages?: Stage[];
}

/** The steps a ship takes itself, as {@link Ship.stages} keeps them. */
export const SHIP_STAGES: StageKey[] = [
	"push",
	"login",
	"otp",
	"command",
	"remote",
];

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
	/** The project's slug. */
	slug: () => Promise<string>;
	clock?: WallClock;
	/**
	 * The long-lived npm token the project's creds keep as `NPM_TOKEN`, or
	 * undefined for none. With one, the ship publishes under it and asks the
	 * person for no sign-in.
	 */
	npmToken?: () => Promise<string | undefined>;
	/** Release-branch checks; the project at root by default. */
	git?: Pick<ReleaseGit, "sync">;
}

/** The error of a ship the person stopped. */
const STOPPED = "stopped: the person abandoned the ship";

/** How many lines of output a failed ship keeps as its error. */
const TAIL = 20;

/**
 * Runs a project's ship on the server's machine, under the person's own npm
 * sign-in: `npm login --auth-type=web` when `npm whoami` says there is none,
 * then the project's `ship` command from its main tree. The link each npm
 * page asks the person to open is kept as `waiting` for the page to show,
 * and the release's own question is answered yes, since the person asked for
 * the ship. Its output goes to a file for the page to follow.
 */
export class Shipping implements Resource {
	private readonly record: Document<Ship>;
	private readonly clock: WallClock;
	private child: TerminalChild | null = null;
	private going: Promise<void> | null = null;
	private disposed = false;
	/** Whether the person stopped the ship under way. */
	private stopped = false;
	/** Whether npm asked for a typed one-time password, which stops the ship. */
	private typed = false;
	/** Who `npm whoami` says is signed in, for the link to their 2FA settings. */
	private user: string | null = null;
	/** Where the ship under way writes its output. */
	private log: string | null = null;
	/** How many bytes its log holds, where the next step's slice begins. */
	private bytes = 0;
	/** Where in the log what the child printed last began. */
	private heardFrom = 0;

	constructor(private readonly opts: ShippingOptions) {
		this.record = shipRecord(opts.storage);
		this.clock = opts.clock ?? new SystemWallClock();
	}

	/** Where the output of a ship whose cascade names no log goes. */
	get output(): string {
		return `${this.opts.dir}/ship.log`;
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
		const ship: Ship = {
			project: await this.opts.slug(),
			command,
			bump,
			status: "running",
			step: "login",
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
		this.typed = false;
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
		this.typed = false;
		await this.record.write({
			...left,
			command,
			step: "login",
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
		this.going = this.steps(command, bump)
			.catch(async (error: unknown) => {
				await this.end("failed", String(error));
			})
			.finally(() => {
				this.going = null;
				this.child = null;
			});
	}

	private async steps(command: string, bump: ShipBump): Promise<void> {
		const { ps, root } = this.opts;
		await this.sync("push");
		const at = this.stamp();
		await this.stage("login", (stage) => ({
			...begun(stage, at, "checking"),
			log: { from: this.bytes, to: null },
		}));
		const token = await this.opts.npmToken?.();
		const { env, whoami } = await checkNpm(this.opts, token);
		const signedIn = whoami.exitCode === 0;
		this.user = signedIn ? whoami.stdout.trim() || null : null;
		await this.stage("login", (stage) => ({
			...stage,
			check: {
				at: this.stamp(),
				result: signedIn
					? `npm whoami: ${whoami.stdout.trim() || "signed in"}${token === undefined ? "" : " (NPM_TOKEN from the creds store)"}`
					: "npm whoami: not signed in",
			},
		}));
		if (!signedIn && token !== undefined) {
			await this.end("failed", TOKEN_REFUSED);
			return;
		}
		if (!signedIn) {
			await this.stage("login", (stage) => ({ ...stage, state: "running" }));
			const code = await this.watch(
				ps.startOnTerminal(quietly("npm login --auth-type=web"), {
					...TERMINAL,
					cwd: root,
					env: NPM_ENV,
				}),
				"login",
			);
			if (code !== 0 || this.stopped || this.typed) {
				await this.end(
					"failed",
					this.stopped
						? STOPPED
						: this.typed
							? typedCodeError(this.user)
							: await this.tail(`npm login exited ${code}`),
				);
				return;
			}
		}
		await this.stage("login", (stage) => this.closed(stage, "done"));
		await this.update({ step: "ship", waiting: null });
		await this.stage("command", (stage) => ({
			...begun(stage, this.stamp()),
			log: { from: this.bytes, to: null },
		}));
		const code = await this.watch(
			ps.startOnTerminal(quietly(command), {
				...TERMINAL,
				cwd: root,
				env: {
					...env,
					SPLATES_SHIP_BUMP: bump,
					SPLATES_SHIP_EVENTS: this.events,
				},
			}),
			"ship",
		);
		if (code === 0 && !this.stopped && !this.typed) {
			await this.stage("command", (stage) => this.closed(stage, "done"));
			await this.sync("remote");
		}
		await this.end(
			code === 0 && !this.stopped && !this.typed ? "done" : "failed",
			this.stopped
				? STOPPED
				: this.typed
					? typedCodeError(this.user)
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
	 * Follows `child` to its exit: its output to the file, each npm link it
	 * prints as what the ship waits on, cleared once npm says anything else,
	 * and the release's question answered yes.
	 */
	private async watch(
		child: TerminalChild,
		step: Ship["step"],
	): Promise<number> {
		this.child = child;
		let pending = "";
		let asked = false;
		const heard = async (text: string) => {
			this.heardFrom = this.bytes;
			await this.say(text);
			pending += text.replace(ANSI, "");
			const lines = pending.split(/\r?\n/);
			pending = lines.pop() ?? "";
			for (const line of lines) {
				await this.line(line.trim(), step);
			}
			if (RELEASE_PROMPT.test(pending) && !asked) {
				asked = true;
				child.write("y\n");
			} else if (!RELEASE_PROMPT.test(pending)) {
				asked = false;
			}
			if (OTP_PROMPT.test(pending) && !this.typed) {
				// splates never takes a typed code: the ship stops, saying how to
				// have npm ask on its own page instead.
				this.typed = true;
				await this.asked();
				child.kill();
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
						keep: (steps) =>
							this.stage("command", (stage) => ({
								...stage,
								releaseSteps: steps,
							})),
					})
				: null;
		const code = await child.exited;
		await following?.flush();
		// What the child printed last may still be on its way.
		await Bun.sleep(20);
		child.close();
		await reading;
		await order;
		if (pending.trim() !== "") {
			await this.line(pending.trim(), step);
		}
		return code;
	}

	private async line(line: string, step: Ship["step"]): Promise<void> {
		const url = NPM_PAGE.exec(line)?.[0];
		if (url !== undefined) {
			const kind = step === "login" || url.includes("/login") ? "login" : "2fa";
			await this.update({
				waiting: { kind, url, since: this.stamp() },
			});
			if (kind === "login") {
				await this.stage("login", (stage) => ({ ...stage, state: "asking" }));
			} else {
				await this.asked();
			}
		} else if (line !== "" && !AROUND_LINK.test(line)) {
			const ship = await this.record.read();
			if (ship?.waiting != null) {
				await this.update({ waiting: null });
				await this.answered(ship.waiting.kind);
			}
		}
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
						? // npm never asked for a second factor, or the ship never got there.
							{ ...stage, state: "skipped", ended: at }
						: this.closed(stage, status === "done" ? "done" : "failed"),
			);
		}
	}

	/** npm asked for a publish's second factor: its step waits on the person. */
	private async asked(): Promise<void> {
		await this.stage("otp", (stage) => ({
			...begun(stage, this.stamp(), "asking"),
			log: stage.log ?? { from: this.heardFrom, to: null },
		}));
	}

	/** npm moved on from what it waited on the person for. */
	private async answered(kind: ShipWait["kind"]): Promise<void> {
		await this.stage(kind === "login" ? "login" : "otp", (stage) =>
			stage.state === "asking" ? { ...stage, state: "running" } : stage,
		);
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
