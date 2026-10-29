import type { ListeningEntry, ProcessEntry } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { z } from "zod";
import type { Launch, ProcessHandle } from "../agents";
import type { GitResult } from "../git";
import { RemotePty } from "../terminal";
import { CallAnswer, type CallRequest, READ_PART } from "./call-host";
import type { WorkerChannel } from "./channel";
import type { WorkerMachine, WorkerRead } from "./machine";
import { WorkerProcess } from "./process";
import type { Json } from "./protocol";
import type { WorkerSession } from "./session";

/** Where and how big a shell on a worker starts, as `Pty` takes it. */
export interface RemotePtyOptions {
	argv: string[];
	cwd: string;
	cols: number;
	rows: number;
	env?: Record<string, string>;
}

/** Spread into each request, which the channel gives its id. */
type Call = CallRequest extends infer Each
	? Each extends { id: number }
		? Omit<Each, "id">
		: never
	: never;

/** How long each kind of call may go unanswered before it is given up on. */
export type CallBounds = Record<Call["method"], Duration>;

/**
 * How long a worker may take over each call before whatever waits on it
 * gives up: long enough for a slow worker's honest answer, short enough
 * that a link gone silent, or a call hung on the worker, frees the caller.
 */
export const CALL_BOUNDS: CallBounds = {
	git: Duration.mins(5),
	read: Duration.mins(1),
	exists: Duration.mins(1),
	processes: Duration.mins(1),
	listening: Duration.mins(1),
	scratch: Duration.mins(1),
};

/**
 * How a worker joined: over this machine's socket, or by its own say-so.
 */
export type WorkerKind = "local" | "registered";

/**
 * The server's handle on one worker: what it said of itself in its
 * hello, and the work it can be given. Its session outlives any one
 * connection, so a call or process started before a drop finishes after it.
 */
export class ConnectedWorker implements WorkerMachine {
	private calls: WorkerChannel | undefined;
	private nextCall = 1;
	/** The pieces of a git call's output heard so far, by call. */
	private readonly parts = new Map<
		number,
		{ stdout: string; stderr: string }
	>();
	private readonly pending = new Map<
		number,
		{ resolve(result: unknown): void; reject(error: Error): void }
	>();

	constructor(
		readonly id: string,
		/** Slots, platform and build, as its last hello said. */
		public info: { [key: string]: Json },
		readonly session: WorkerSession,
		/** How its last connection arrived. */
		public kind: WorkerKind = "registered",
		private readonly bounds: CallBounds = CALL_BOUNDS,
	) {}

	/**
	 * Whether the worker checked this server's signing key before it
	 * sent its own key; false for one that joined before join tokens carried
	 * it, which re-joining makes verified.
	 */
	verified = false;

	get connected(): boolean {
		return this.session.connected;
	}

	/** `start`, as the `Launch` that conversations start their agents with. */
	readonly launch: Launch = (argv, cwd, env) => this.start(argv, cwd, env);

	/** Starts `argv` in `cwd` on the worker, its stdio piped back here. */
	start(
		argv: string[],
		cwd: string,
		env: Record<string, string> = {},
	): WorkerProcess {
		return new WorkerProcess(
			// Which worker it is, so what it runs knows it runs on one.
			this.session.open("process", {
				argv,
				cwd,
				env: { SPLATES_WORKER: this.id, ...env },
			}),
			this.session,
			this.id,
		);
	}

	/**
	 * Takes back the process `handle` names, which this worker kept running
	 * while its server restarted: its output replays from past `held`,
	 * the last frame the server wrote down, or from wherever the worker's
	 * replay starts for null.
	 */
	resume(handle: ProcessHandle, held: number | null): WorkerProcess {
		if (handle.worker !== this.id) {
			throw new Error(
				`the process runs on worker ${handle.worker}, not ${this.id}`,
			);
		}
		return new WorkerProcess(
			this.session.resume(handle.channel, "process", null, held),
			this.session,
			this.id,
			{ resumed: true },
		);
	}

	/** Starts a shell on a pseudo-terminal of the worker's. */
	pty({ argv, cwd, cols, rows, env = {} }: RemotePtyOptions): RemotePty {
		return new RemotePty(
			this.session.open("pty", { argv, cwd, cols, rows, env }),
			this.id,
		);
	}

	/**
	 * Takes back a shell the worker kept through a server restart, by
	 * the `handle` the last run's `pty` had; it says its pid and screen again
	 * once asked to describe itself. One the worker no longer runs exits.
	 */
	resumePty(handle: ProcessHandle): RemotePty {
		if (handle.worker !== this.id) {
			throw new Error(
				`the shell runs on worker ${handle.worker}, not ${this.id}`,
			);
		}
		return new RemotePty(
			this.session.resume(handle.channel, "pty", null, null),
			this.id,
			this.session,
		);
	}

	async git(
		cwd: string,
		args: string[],
		env?: Record<string, string>,
	): Promise<GitResult> {
		return GitAnswer.parse(
			await this.call({
				method: "git",
				cwd,
				args,
				chunked: true,
				...(env === undefined ? {} : { env }),
			}),
		);
	}

	async processes(): Promise<ProcessEntry[]> {
		return ProcessesAnswer.parse(await this.call({ method: "processes" }));
	}

	async listening(): Promise<ListeningEntry[]> {
		return ListeningAnswer.parse(await this.call({ method: "listening" }));
	}

	async exists(path: string): Promise<boolean> {
		return z.boolean().parse(await this.call({ method: "exists", path }));
	}

	async scratch(agent: string, cwd: string): Promise<void> {
		await this.call({ method: "scratch", agent, cwd });
	}

	async read(path: string, from: number): Promise<WorkerRead> {
		// In pieces a frame holds, until what is there is read.
		const pieces: Uint8Array[] = [];
		let size = 0;
		let have = 0;
		do {
			const answer = ReadAnswer.parse(
				await this.call({
					method: "read",
					path,
					from: from + have,
					limit: READ_PART,
				}),
			);
			const piece = new Uint8Array(Buffer.from(answer.bytes, "base64"));
			pieces.push(piece);
			have += piece.byteLength;
			size = answer.size;
			if (piece.byteLength === 0) {
				break;
			}
		} while (from + have < size);
		return { size, bytes: Buffer.concat(pieces) };
	}

	private call(request: Call): Promise<unknown> {
		const id = this.nextCall++;
		const answered = Promise.withResolvers<unknown>();
		const within = this.bounds[request.method];
		// The session outlives a drop, so this bounds the wait, not the connection.
		const timeout = this.session.timer.setTimeout(() => {
			if (!this.pending.delete(id)) {
				return;
			}
			this.parts.delete(id);
			answered.reject(
				new Error(
					`worker ${this.id} did not answer the ${request.method} call within ${within.secs}s${this.connected ? "" : ", its link down"}`,
				),
			);
		}, within);
		this.pending.set(id, {
			resolve: (result) => {
				timeout.dispose();
				answered.resolve(result);
			},
			reject: (error) => {
				timeout.dispose();
				answered.reject(error);
			},
		});
		this.channel().send({ ...request, id });
		return answered.promise;
	}

	/** One `calls` channel for every call, opened on the first. */
	private channel(): WorkerChannel {
		if (this.calls !== undefined && !this.calls.closed) {
			return this.calls;
		}
		const calls = this.session.open("calls");
		calls.events.on("message", ({ body, seq }) => {
			// Nothing here outlives a restart, so an answer is held once heard.
			calls.ack(seq);
			const answer = CallAnswer.safeParse(body);
			if (!answer.success) {
				return;
			}
			if ("part" in answer.data) {
				const parts = this.parts.get(answer.data.id) ?? {
					stdout: "",
					stderr: "",
				};
				parts[answer.data.part] += answer.data.text;
				this.parts.set(answer.data.id, parts);
				return;
			}
			const waiting = this.pending.get(answer.data.id);
			this.pending.delete(answer.data.id);
			if ("error" in answer.data) {
				this.parts.delete(answer.data.id);
				waiting?.reject(new Error(`worker ${this.id}: ${answer.data.error}`));
			} else {
				const parts = this.parts.get(answer.data.id);
				this.parts.delete(answer.data.id);
				waiting?.resolve(
					parts === undefined
						? answer.data.result
						: {
								...(answer.data.result as object),
								stdout: parts.stdout + (answer.data.result as GitResult).stdout,
								stderr: parts.stderr + (answer.data.result as GitResult).stderr,
							},
				);
			}
		});
		calls.events.on("close", () => {
			for (const waiting of this.pending.values()) {
				waiting.reject(new Error(`worker ${this.id} closed its calls`));
			}
			this.pending.clear();
			this.parts.clear();
		});
		this.calls = calls;
		return calls;
	}
}

const GitAnswer = z.object({
	code: z.number(),
	stdout: z.string(),
	stderr: z.string(),
});
const ProcessesAnswer = z.array(
	z.object({
		pid: z.number(),
		ppid: z.number(),
		pgid: z.number(),
		tpgid: z.number(),
		command: z.string(),
	}),
);
const ListeningAnswer = z.array(
	z.object({
		pid: z.number(),
		host: z.string(),
		port: z.number(),
		cwd: z.string().nullable(),
	}),
);
const ReadAnswer = z.object({ size: z.number(), bytes: z.string() });
