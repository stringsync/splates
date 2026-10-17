import type { Resource } from "webappwiz/disposable";
import type { Child, ProcessEntry, Ps } from "webappwiz/system";
import { z } from "zod";
import { SERVING } from "./supervise";
import type { WorkerChannel } from "./worker-channel";
import { relays } from "./worker-relay";
import type { WorkerSession } from "./worker-session";

/** What a coordinator opens a `process` channel with. */
export const ProcessParams = z.object({
	argv: z.array(z.string()).min(1),
	cwd: z.string(),
	env: z.record(z.string(), z.string()).default({}),
});

/** What the coordinator says on a process's channel that is not stdin. */
const ProcessMessage = z.discriminatedUnion("type", [
	z.object({ type: z.literal("kill"), signal: z.string().optional() }),
	z.object({ type: z.literal("end") }),
	/** Say `started` again, for a coordinator that took the channel back and never heard it. */
	z.object({ type: z.literal("describe") }),
]);

/**
 * One process a `process` channel started on the worker, such as an agent:
 * its stdout as the channel's bytes, its stdin from them, and its pid,
 * stderr and exit code as messages. Its stdout is read only while the
 * session has room, so a coordinator away for long stalls the process
 * rather than losing what it says. Closing the channel kills it, and
 * everything it started.
 */
export class WorkerProcessHost implements Resource {
	private readonly child: Child;
	private readonly stdin: WritableStreamDefaultWriter<Uint8Array>;

	constructor(
		private readonly channel: WorkerChannel,
		private readonly session: WorkerSession,
		private readonly ps: Ps,
		/**
		 * This worker's relay, which a process told where `splates server` is
		 * reaches it through instead, since the coordinator's own address is
		 * its machine's loopback; null to leave its env as it is.
		 */
		relay: string | null = null,
	) {
		const { argv, cwd, env } = ProcessParams.parse(channel.params);
		this.child = ps.start(argv, {
			cwd,
			env:
				relay !== null && env.SPLATES_DEV !== undefined && relays(session)
					? { ...env, SPLATES_DEV: relay }
					: env,
			unset: [SERVING],
		});
		this.stdin = this.child.stdin.getWriter();
		channel.send({ type: "started", pid: this.child.pid });
		channel.events.on("data", ({ bytes }) => {
			void this.stdin.write(bytes).catch(() => {});
		});
		channel.events.on("message", ({ body }) => this.told(body));
		channel.events.on("close", () => this.dispose());
		void this.run(argv, cwd);
	}

	dispose(): void {
		void this.end();
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
