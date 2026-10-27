import type { Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import type { Child, Fs, Ps } from "webappwiz/system";
import { SystemWallClock, type WallClock } from "webappwiz/time";
import { fail } from "../exit";
import type { Document, Storage } from "../storage";
import type { ShipBump } from "./plan";

/** Where a project's records keep its latest ship. */
export function shipRecord(storage: Storage): Document<Ship> {
	return storage.document<Ship>("ship.json");
}

/** Where a ship stands: going, or how it ended. */
export type ShipStatus = "running" | "done" | "failed";

/**
 * What npm waits on the person for: signing in, as `npm login --auth-type=web`
 * asks, a publish's second factor, or a one-time password typed at its prompt.
 */
export interface ShipWait {
	kind: "login" | "2fa" | "otp";
	/** npm's page, which the person opens from any device; null for a typed code. */
	url: string | null;
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
}

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
}

/** How many lines of output a failed ship keeps as its error. */
const TAIL = 20;

// biome-ignore lint/suspicious/noControlCharactersInRegex: color escapes
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
/** npm's sign-in page, and the page a publish's second factor is answered on. */
const NPM_PAGE = /https:\/\/(?:www\.)?npmjs\.com\/(?:login|auth)\S*/;
/** What npm prints around its link, which does not mean the person answered. */
const AROUND_LINK =
	/^(?:press enter|authenticate your account|login at|log in at)/i;
/** webappwiz's release asking before it publishes. */
const RELEASE_PROMPT = /\(y\/n\)\s*$/;
/** npm's prompt for a typed one-time password, which ends without a newline. */
const OTP_PROMPT = /one-time password.*:\s*$|enter otp:\s*$/i;

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
	private child: Child | null = null;
	private stdin: WritableStreamDefaultWriter<Uint8Array> | null = null;
	private going: Promise<void> | null = null;
	private disposed = false;

	constructor(private readonly opts: ShippingOptions) {
		this.record = shipRecord(opts.storage);
		this.clock = opts.clock ?? new SystemWallClock();
	}

	/** Where the output of the latest ship is. */
	get output(): string {
		return `${this.opts.dir}/ship.log`;
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
	 * Types `code` at npm's one-time password prompt, refused when npm asks for
	 * none. The code goes to the child's stdin and is kept nowhere.
	 */
	async answerOtp(code: string): Promise<void> {
		const ship = await this.record.read();
		if (this.stdin === null || ship?.waiting?.kind !== "otp") {
			fail("conflict", "npm is not asking for a one-time password", {
				root: this.opts.root,
			});
		}
		await this.update({ waiting: null });
		await this.stdin.write(new TextEncoder().encode(`${code}\n`));
	}

	/** Starts a ship at `bump`, refused while one runs or when the project names no `ship`. */
	async start(bump: ShipBump = "patch"): Promise<Ship> {
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
		};
		await this.opts.fs.mkdir(this.opts.dir, { recursive: true });
		await this.opts.fs.write(this.output, "");
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
		await this.record.write({
			...left,
			command,
			step: "login",
			waiting: null,
			resumed: left.resumed + 1,
		});
		await this.opts.fs
			.append(
				this.output,
				"\n[splates server restarted: running the ship again to finish it]\n",
			)
			.catch(() => {});
		this.opts.log.info(`resuming the ship of ${left.project}`);
		this.run(command, left.bump ?? "patch");
	}

	/** Waits for the ship under way, if any, to end. */
	async settled(): Promise<void> {
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
		if ((await ps.spawnCapture(["npm", "whoami"], { cwd: root })).exitCode) {
			const code = await this.watch(
				ps.start(["npm", "login", "--auth-type=web"], { cwd: root }),
				"login",
			);
			if (code !== 0) {
				await this.end("failed", await this.tail(`npm login exited ${code}`));
				return;
			}
		}
		await this.update({ step: "ship", waiting: null });
		const code = await this.watch(
			ps.start(["sh", "-c", command], {
				cwd: root,
				env: { SPLATES_SHIP_BUMP: bump },
			}),
			"ship",
		);
		await this.end(
			code === 0 ? "done" : "failed",
			code === 0 ? null : await this.tail(`${command} exited ${code}`),
		);
	}

	/**
	 * Follows `child` to its exit: its output to the file, each npm link it
	 * prints as what the ship waits on, cleared once npm says anything else,
	 * and the release's question answered yes.
	 */
	private async watch(child: Child, step: Ship["step"]): Promise<number> {
		this.child = child;
		const stdin = child.stdin.getWriter();
		this.stdin = stdin;
		let pending = "";
		let asked = false;
		let otp = false;
		const heard = async (text: string) => {
			await this.opts.fs.append(this.output, text).catch(() => {});
			pending += text.replace(ANSI, "");
			const lines = pending.split(/\r?\n/);
			pending = lines.pop() ?? "";
			for (const line of lines) {
				await this.line(line.trim(), step);
			}
			if (RELEASE_PROMPT.test(pending) && !asked) {
				asked = true;
				await stdin.write(new TextEncoder().encode("y\n")).catch(() => {});
			} else if (!RELEASE_PROMPT.test(pending)) {
				asked = false;
			}
			if (OTP_PROMPT.test(pending) && !otp) {
				otp = true;
				await this.update({
					waiting: { kind: "otp", url: null, since: this.stamp() },
				});
			} else if (!OTP_PROMPT.test(pending)) {
				otp = false;
			}
		};
		// One reader at a time, so lines go in the order they came.
		let order = Promise.resolve();
		const read = async (stream: ReadableStream<Uint8Array>) => {
			const decoder = new TextDecoder();
			for await (const chunk of stream) {
				const text = decoder.decode(chunk, { stream: true });
				order = order.then(() => heard(text));
			}
		};
		await Promise.all([read(child.stdout), read(child.stderr)]).catch(() => {});
		await order;
		if (pending.trim() !== "") {
			await this.line(pending.trim(), step);
		}
		this.stdin = null;
		await stdin.close().catch(() => {});
		return child.exited;
	}

	private async line(line: string, step: Ship["step"]): Promise<void> {
		const url = NPM_PAGE.exec(line)?.[0];
		if (url !== undefined) {
			const kind = step === "login" || url.includes("/login") ? "login" : "2fa";
			await this.update({
				waiting: { kind, url, since: this.stamp() },
			});
		} else if (line !== "" && !AROUND_LINK.test(line)) {
			const ship = await this.record.read();
			if (ship?.waiting != null) {
				await this.update({ waiting: null });
			}
		}
	}

	private async end(status: ShipStatus, error: string | null): Promise<void> {
		if (this.disposed) {
			// The server is stopping: left running, to finish as it starts again.
			return;
		}
		await this.update({
			status,
			waiting: null,
			ended: this.stamp(),
			error,
			to: status === "done" ? await this.version() : null,
		});
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
		const output = await this.opts.fs.read(this.output).catch(() => "");
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
