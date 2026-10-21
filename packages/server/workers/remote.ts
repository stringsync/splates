import type * as acp from "@agentclientprotocol/sdk";
import type { ListeningEntry, ProcessEntry } from "webappwiz/system";
import { z } from "zod";
import type { Launch, ProcessHandle } from "../agents";
import type { GitResult } from "../git";
import { RemotePty } from "../terminal";
import { CallAnswer, type CallRequest, READ_PART, SERVERS } from "./call-host";
import type { WorkerChannel } from "./channel";
import type { ProjectCheckout } from "./checkouts";
import type { WorkerMachine, WorkerRead } from "./machine";
import { WAKE, type WakeTarget } from "./magic-packet";
import type { Json } from "./protocol";
import { RemoteProcess } from "./remote-process";
import type { WorkerSession } from "./session";
import { KEYS, type SentKey, type TaskKey } from "./task-keys";

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

/**
 * How a worker joined: over this machine's socket, by its own say-so, or
 * made by the `WorkerProvider` when work waited for it.
 */
export type WorkerKind = "local" | "registered" | "provisioned";

/**
 * The coordinator's handle on one worker: what it said of itself in its
 * hello, and the work it can be given. Its session outlives any one
 * connection, so a call or process started before a drop finishes after it.
 */
export class RemoteWorker implements WorkerMachine {
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
	) {}

	get connected(): boolean {
		return this.session.connected;
	}

	/** `start`, as the `Launch` that conversations start their agents with. */
	readonly launch: Launch = (argv, cwd, env) => this.start(argv, cwd, env);

	/**
	 * Starts `argv` in `cwd` on the worker, its stdio piped back here,
	 * proxying its requests with each of `keys`, which `sendKeys` sent: the
	 * process gets only a placeholder and the proxy's URL.
	 */
	start(
		argv: string[],
		cwd: string,
		env: Record<string, string> = {},
		keys: TaskKey[] = [],
	): RemoteProcess {
		return new RemoteProcess(
			// Which worker it is, so a task it clones is recorded on this one.
			this.session.open("process", {
				argv,
				cwd,
				env: { SPLATES_WORKER: this.id, ...env },
				...(keys.length === 0 ? {} : { keys }),
			}),
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
			this.session,
		);
	}

	/**
	 * Opens a connection to `port` on the worker's loopback, such as a task's
	 * dev server, as a `port` channel for a `PortPipe` to carry.
	 */
	port(port: number): WorkerChannel {
		return this.session.open("port", { port });
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

	async checkout(request: ProjectCheckout): Promise<string> {
		return z.string().parse(await this.call({ method: "checkout", request }));
	}

	async removeCheckout(path: string): Promise<void> {
		await this.call({ method: "removeCheckout", path });
	}

	/** What it offers its sessions; none from a worker too old to say. */
	async servers(): Promise<acp.McpServer[]> {
		const { negotiated } = this.session;
		if (negotiated?.ok !== true || !negotiated.capabilities.includes(SERVERS)) {
			return [];
		}
		return ServersAnswer.parse(await this.call({ method: "servers" }));
	}

	/** Whether it sends a magic packet when asked: a worker on 1.4 on. */
	get wakes(): boolean {
		const { negotiated } = this.session;
		return negotiated?.ok === true && negotiated.capabilities.includes(WAKE);
	}

	/** Whether it keeps keys it is sent and proxies its agents': a worker of its own machine on 1.5 on. */
	get keeps(): boolean {
		const { negotiated } = this.session;
		return negotiated?.ok === true && negotiated.capabilities.includes(KEYS);
	}

	/** Has it keep `keys`, in its memory alone, in place of every key it kept. */
	async sendKeys(keys: SentKey[]): Promise<void> {
		await this.call({ method: "keys", keys });
	}

	/** Has it send the magic packet that wakes `target`, from its network. */
	async wake(target: WakeTarget): Promise<void> {
		await this.call({ method: "wake", ...target });
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

const ServersAnswer = z.array(
	z.object({
		type: z.literal("http"),
		name: z.string(),
		url: z.string(),
		headers: z.array(z.object({ name: z.string(), value: z.string() })),
	}),
);
