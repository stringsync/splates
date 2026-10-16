import type { Resource } from "webappwiz/disposable";
import type { Child, Ps } from "webappwiz/system";
import { z } from "zod";
import { SERVING } from "./supervise";
import type { WorkerChannel } from "./worker-channel";
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
]);

/**
 * One process a `process` channel started on the worker, such as an agent:
 * its stdout as the channel's bytes, its stdin from them, and its pid,
 * stderr and exit code as messages. Its stdout is read only while the
 * session has room, so a coordinator away for long stalls the process
 * rather than losing what it says. Closing the channel kills it.
 */
export class WorkerProcessHost implements Resource {
	private readonly child: Child;
	private readonly stdin: WritableStreamDefaultWriter<Uint8Array>;

	constructor(
		private readonly channel: WorkerChannel,
		private readonly session: WorkerSession,
		ps: Ps,
	) {
		const { argv, cwd, env } = ProcessParams.parse(channel.params);
		this.child = ps.start(argv, { cwd, env, unset: [SERVING] });
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
		this.child.kill();
	}

	private told(body: unknown): void {
		const parsed = ProcessMessage.safeParse(body);
		if (!parsed.success) {
			return;
		}
		if (parsed.data.type === "kill") {
			this.child.kill(parsed.data.signal as NodeJS.Signals | undefined);
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
