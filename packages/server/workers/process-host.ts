import type { Resource } from "webappwiz/disposable";
import type { Child, ProcessEntry, Ps } from "webappwiz/system";
import type { Timer } from "webappwiz/time";
import { Duration } from "webappwiz/time";
import { z } from "zod";
import { SERVING } from "../server/shared";
import type { WorkerChannel } from "./channel";
import type { WorkerSession } from "./session";

/** What a server opens a `process` channel with. */
export const ProcessParams = z.object({
	argv: z.array(z.string()).min(1),
	cwd: z.string(),
	env: z.record(z.string(), z.string()).default({}),
});

/** What the server says on a process's channel that is not stdin. */
const ProcessMessage = z.discriminatedUnion("type", [
	z.object({ type: z.literal("kill"), signal: z.string().optional() }),
	z.object({ type: z.literal("end") }),
	/** Say `started` again, for a server that took the channel back and never heard it. */
	z.object({ type: z.literal("describe") }),
]);

/** How often a running process's descendants are noted, for when it dies without ending them. */
const WATCH_EVERY = Duration.secs(2);

/**
 * One process a `process` channel started on the worker, such as an agent:
 * its stdout as the channel's bytes, its stdin from them, and its pid,
 * stderr and exit code as messages. Its stdout is read only while the
 * session has room, so a server away for long stalls the process
 * rather than losing what it says. Closing the channel kills it, and
 * everything it started.
 */
export class WorkerProcessHost implements Resource {
	private readonly child: Child;
	private readonly stdin: WritableStreamDefaultWriter<Uint8Array>;
	/** Every descendant seen while the child ran, for the ones it leaves behind. */
	private readonly seen = new Set<number>();
	private ended = false;
	private watch: Resource | null = null;

	constructor(
		private readonly channel: WorkerChannel,
		private readonly session: WorkerSession,
		private readonly ps: Ps,
		opts: WorkerProcessHostOptions = {},
	) {
		const { timer = null } = opts;
		const { argv, cwd, env } = ProcessParams.parse(channel.params);
		try {
			this.child = ps.start(argv, {
				cwd,
				env,
				unset: [SERVING],
			});
		} catch (error) {
			throw new Error(
				`cannot start ${argv[0]} in ${cwd}: ${error instanceof Error ? error.message : String(error)}`,
				{ cause: error },
			);
		}
		this.stdin = this.child.stdin.getWriter();
		channel.send({ type: "started", pid: this.child.pid });
		channel.events.on("data", ({ bytes }) => {
			void this.stdin.write(bytes).catch(() => {});
		});
		channel.events.on("message", ({ body }) => this.told(body));
		channel.events.on("close", () => this.dispose());
		this.watch =
			timer?.setInterval(() => void this.note(), WATCH_EVERY) ?? null;
		void this.run(argv, cwd);
	}

	dispose(): void {
		this.watch?.dispose();
		void this.end();
	}

	/** Remembers what runs under the child now. */
	private async note(): Promise<void> {
		const { pid } = this.child;
		if (pid === null || this.ended) {
			return;
		}
		const table = await this.ps.processes().catch(() => []);
		for (const each of descendants(table, pid)) {
			this.seen.add(each);
		}
	}

	/**
	 * Ends what the child left running when it exited by itself: reparented
	 * to init, those commands would keep their ports and memory after its
	 * slot is freed. Only a remembered process still in the table whose
	 * parent is init, gone, or another remembered one is ended, so a pid the
	 * system has since reused is left alone.
	 */
	private async reap(): Promise<void> {
		this.watch?.dispose();
		if (this.ended || this.seen.size === 0) {
			return;
		}
		const table = await this.ps.processes().catch(() => []);
		const present = new Set(table.map((each) => each.pid));
		const left = table
			.filter(
				(each) =>
					this.seen.has(each.pid) &&
					(each.ppid === 1 ||
						!present.has(each.ppid) ||
						this.seen.has(each.ppid)),
			)
			.map((each) => each.pid);
		if (left.length > 0) {
			await this.ps
				.spawn(["kill", "-TERM", ...left.map(String)])
				.catch(() => {});
		}
	}

	/**
	 * Ends the child with `signal`, and everything under it with the same:
	 * the commands an agent runs, dev servers among them, lead process
	 * groups of their own and outlive it otherwise, holding their ports
	 * after its slot is freed. Listed before the child goes, while they
	 * are still its descendants.
	 */
	private async end(signal?: NodeJS.Signals): Promise<void> {
		const { pid } = this.child;
		this.ended = true;
		const under =
			pid === null
				? []
				: descendants(await this.ps.processes().catch(() => []), pid);
		this.child.kill(signal);
		if (under.length > 0) {
			const name = (signal ?? "SIGTERM").replace(/^SIG/, "");
			await this.ps
				.spawn(["kill", `-${name}`, ...under.map(String)])
				.catch(() => {});
		}
	}

	private told(body: unknown): void {
		const parsed = ProcessMessage.safeParse(body);
		if (!parsed.success) {
			return;
		}
		if (parsed.data.type === "kill") {
			void this.end(parsed.data.signal as NodeJS.Signals | undefined);
		} else if (parsed.data.type === "describe") {
			this.channel.send({ type: "started", pid: this.child.pid });
		} else {
			void this.stdin.close().catch(() => {});
		}
	}

	private async run(argv: string[], cwd: string): Promise<void> {
		const decoder = new TextDecoder();
		await Promise.all([
			this.pump(this.child.stdout, (bytes) => this.channel.write(bytes)),
			this.pump(this.child.stderr, (bytes) =>
				this.channel.send({
					type: "stderr",
					text: decoder.decode(bytes, { stream: true }),
				}),
			),
		]);
		const code = await this.child.exited.catch((error: unknown) => {
			if (!this.channel.closed) {
				this.channel.send({
					type: "stderr",
					text: `cannot start ${argv[0]} in ${cwd}: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
			return 127;
		});
		await this.reap();
		if (!this.channel.closed) {
			this.channel.send({ type: "exit", code });
			this.channel.dispose();
		}
	}

	private async pump(
		stream: ReadableStream<Uint8Array>,
		send: (bytes: Uint8Array) => boolean,
	): Promise<void> {
		try {
			for await (const bytes of stream) {
				if (this.channel.closed) {
					return;
				}
				if (!send(bytes)) {
					await this.session.drained();
				}
			}
		} catch {
			// A process that never started has no output; its exit says why.
		}
	}
}

/** What a {@link WorkerProcessHost} is set up with, beyond its channel. */
export interface WorkerProcessHostOptions {
	/** What notes the child's descendants while it runs; absent to note none. */
	timer?: Timer | null;
	/** Where it runs its process, kept from its siblings; absent to run it as this worker's user alone. */
}

/** Every process under `pid` in `table`, children first. */
export function descendants(table: ProcessEntry[], pid: number): number[] {
	const children = new Map<number, number[]>();
	for (const each of table) {
		children.set(each.ppid, [...(children.get(each.ppid) ?? []), each.pid]);
	}
	const found: number[] = [];
	const look = (under: number): void => {
		for (const child of children.get(under) ?? []) {
			if (!found.includes(child)) {
				found.push(child);
				look(child);
			}
		}
	};
	look(pid);
	return found;
}
