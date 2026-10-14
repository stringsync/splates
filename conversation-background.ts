import type { Resource } from "webappwiz/disposable";
import { Duration } from "webappwiz/time";
import type { AgentConnection } from "./agent-connection";
import type { ConversationDeps, ConversationHost } from "./conversation-host";
import type { Background } from "./conversation-state";
import { fail } from "./exit";

/** How often a background command's output is read again while it runs. */
const OUTPUT_EVERY = Duration.ms(250);

/**
 * The commands the agent left running in the background, as the
 * conversation's state lists them: what each has printed, and stopping one.
 */
export class ConversationBackground {
	constructor(
		private readonly host: ConversationHost,
		private readonly deps: ConversationDeps,
		private readonly connection: AgentConnection,
	) {}

	/** Stops background command `id`, leaving the agent's turn as it is. */
	async stop(id: string): Promise<void> {
		if (this.command(id).state !== "running") {
			return;
		}
		// The agent says it ended as it stops it, which takes it off the list.
		await this.connection.stopTask(id);
	}

	/**
	 * What background command `id` has printed, then more as it prints it,
	 * ending once the command has and all of it is read.
	 */
	output(id: string): ReadableStream<Uint8Array> {
		this.command(id);
		const { fs, timer } = this.deps;
		let read = 0;
		let waiting: Resource | null = null;
		let cancelled = false;
		const next = async (
			stream: ReadableStreamDefaultController<Uint8Array>,
		): Promise<void> => {
			if (cancelled) {
				return;
			}
			const command = this.host.state.background.find((each) => each.id === id);
			const path = command?.output ?? null;
			const size =
				path !== null && (await fs.exists(path))
					? (await fs.stat(path)).size
					: 0;
			if (path !== null && size > read) {
				const bytes = await fs.readBytes(path);
				stream.enqueue(bytes.slice(read));
				read = bytes.length;
			}
			// Read once more after it ends, for what it printed last.
			if (command?.state !== "running" && size <= read) {
				stream.close();
				return;
			}
			waiting = timer.setTimeout(() => {
				void next(stream).catch((error: unknown) => stream.error(error));
			}, OUTPUT_EVERY);
		};
		return new ReadableStream<Uint8Array>({
			start: (stream) => next(stream),
			cancel: () => {
				cancelled = true;
				waiting?.dispose();
			},
		});
	}

	/** Background command `id`, refusing one the agent never left. */
	private command(id: string): Background {
		const { id: conversation, background } = this.host.state;
		const command = background.find((each) => each.id === id);
		if (command === undefined) {
			fail(
				"usage",
				`conversation ${conversation} has no background command ${id}`,
				{
					conversation,
				},
			);
		}
		return command;
	}
}
