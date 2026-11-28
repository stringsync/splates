import type { Resource } from "core/disposable";
import type { ProcessEntry } from "core/system";
import { Duration } from "core/time";
import {
	type AgentConnection,
	ASYNC_TASK_STATE,
	type AsyncTaskUpdate,
	foldBackground,
} from "../agents";
import { fail } from "../exit";
import { descendants } from "../workers";
import type { ConversationDeps, ConversationHost } from "./host";
import { ignoredProcess, plainCommand } from "./left-running";
import type { Background } from "./state";

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
		const command = this.command(id);
		if (command.state !== "running") {
			return;
		}
		if (command.canStop === false) {
			fail("usage", `background command ${id} cannot be stopped from here`, {
				conversation: this.host.state.id,
			});
		}
		if (command.pid !== undefined) {
			const exclude = this.connection.pid === null ? [] : [this.connection.pid];
			await this.deps.machine.stopProcessTree([command.pid], exclude);
			this.markStopped(id);
			return;
		}
		if (this.host.state.agent === "antigravity") {
			const agentPid = this.connection.pid;
			if (agentPid !== null) {
				const table = await this.deps.machine.processes().catch(() => []);
				const targets = antigravityTargets(table, agentPid, command.command);
				if (targets.length > 0) {
					await this.deps.machine.stopProcessTree(targets, [agentPid]);
				}
			}
			this.markStopped(id);
			return;
		}
		// The agent says it ended as it stops it, which takes it off the list.
		await this.connection.stopTask(id);
	}

	private markStopped(id: string): void {
		const at = this.host.now();
		const update: AsyncTaskUpdate = {
			sessionUpdate: ASYNC_TASK_STATE,
			asyncTaskId: id,
			state: "stopped",
		};
		this.host.log.write({ kind: "background", update, at });
		foldBackground(this.host.state, update, at);
		this.host.changed();
	}

	/**
	 * What background command `id` has printed, then more as it prints it,
	 * ending once the command has and all of it is read.
	 */
	output(id: string): ReadableStream<Uint8Array> {
		this.command(id);
		const { timer } = this.deps;
		const { machine } = this.deps;
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
			const { size, bytes } =
				path === null
					? { size: 0, bytes: new Uint8Array(0) }
					: await machine.read(path, read);
			if (bytes.byteLength > 0) {
				stream.enqueue(bytes);
				read += bytes.byteLength;
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

/**
 * Root descendant pids under `agentPid` that belong to Antigravity's background
 * `command`, skipping agent machinery (`mcp`, `caffeinate`, zombies).
 */
function antigravityTargets(
	table: ProcessEntry[],
	agentPid: number,
	command: string | null,
): number[] {
	const under = new Set(descendants(table, agentPid));
	const candidates = table.filter(
		(each) => under.has(each.pid) && !ignoredProcess(each.command),
	);
	const candidatePids = new Set(candidates.map((each) => each.pid));
	const roots = candidates.filter((each) => !candidatePids.has(each.ppid));
	if (roots.length <= 1 || command === null) {
		return roots.map((each) => each.pid);
	}
	const said = plainCommand(command).slice(0, 60);
	if (said !== "") {
		const matched = roots.filter((root) => {
			const tree = [root.pid, ...descendants(table, root.pid)];
			return tree.some((pid) => {
				const entry = table.find((each) => each.pid === pid);
				return (
					entry !== undefined && plainCommand(entry.command).includes(said)
				);
			});
		});
		if (matched.length > 0) {
			return matched.map((each) => each.pid);
		}
	}
	return roots.map((each) => each.pid);
}
