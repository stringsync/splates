import type { ListeningEntry, ProcessEntry } from "webappwiz/system";
import { z } from "zod";
import type { Launch, ProcessHandle } from "./agent-process";
import type { GitResult } from "./git";
import { RemoteProcess } from "./remote-process";
import { RemotePty } from "./remote-pty";
import { CallAnswer, type CallRequest } from "./worker-call-host";
import type { WorkerChannel } from "./worker-channel";
import type { WorkerMachine, WorkerRead } from "./worker-machine";
import type { Json } from "./worker-protocol";
import type { WorkerSession } from "./worker-session";

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

/** How a worker joined: over this machine's socket, or by its own say-so. */
export type WorkerKind = "local" | "registered";

/**
 * The coordinator's handle on one worker: what it said of itself in its
 * hello, and the work it can be given. Its session outlives any one
 * connection, so a call or process started before a drop finishes after it.
 */
export class RemoteWorker implements WorkerMachine {
	private calls: WorkerChannel | undefined;
	private nextCall = 1;
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
	) {}

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
	): RemoteProcess {
		return new RemoteProcess(
			this.session.open("process", { argv, cwd, env }),
			this.session,
			this.id,
		);
	}

	/**
	 * Takes back the process `handle` names, which this worker kept running
	 * while its coordinator restarted: its output replays from past `held`,
	 * the last frame the coordinator wrote down, or from wherever the worker's
	 * replay starts for null.
	 */
	resume(handle: ProcessHandle, held: number | null): RemoteProcess {
		if (handle.worker !== this.id) {
			throw new Error(
				`the process runs on worker ${handle.worker}, not ${this.id}`,
			);
		}
		return new RemoteProcess(
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
	 * Takes back a shell the worker kept through a coordinator restart, by
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
		);
	}

	/**
	 * Opens a connection to `port` on the worker's loopback, such as a task's
	 * dev server, as a `port` channel for a `PortPipe` to carry.
	 */
	port(port: number): WorkerChannel {
		return this.session.open("port", { port });
	}

	async git(cwd: string, args: string[]): Promise<GitResult> {
		return GitAnswer.parse(await this.call({ method: "git", cwd, args }));
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

	async read(path: string, from: number): Promise<WorkerRead> {
		const { size, bytes } = ReadAnswer.parse(
			await this.call({ method: "read", path, from }),
		);
		return { size, bytes: new Uint8Array(Buffer.from(bytes, "base64")) };
	}

	private call(request: Call): Promise<unknown> {
		const id = this.nextCall++;
		const answered = Promise.withResolvers<unknown>();
		this.pending.set(id, answered);
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
			const waiting = this.pending.get(answer.data.id);
			this.pending.delete(answer.data.id);
			if ("error" in answer.data) {
				waiting?.reject(new Error(`worker ${this.id}: ${answer.data.error}`));
			} else {
				waiting?.resolve(answer.data.result);
			}
		});
		calls.events.on("close", () => {
			for (const waiting of this.pending.values()) {
				waiting.reject(new Error(`worker ${this.id} closed its calls`));
			}
			this.pending.clear();
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
