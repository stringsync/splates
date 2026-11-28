import type * as acp from "@agentclientprotocol/sdk";
import type { Resource } from "core/disposable";
import type { Fs } from "core/system";
import { Duration, type Timer } from "core/time";
import type { ConversationHost } from "../conversations";
import {
	ASYNC_TASK_SPAWNED,
	ASYNC_TASK_STATE,
	type AsyncTaskUpdate,
	foldBackground,
} from "./acp-extensions";
import { toolIn } from "./tool-calls";

/** How long `run_command` waits before backgrounding a command, when its input does not say. */
const DEFAULT_WAIT = Duration.secs(10);

/** How long past that wait to look, so its transcript has the task in it. */
const SLACK = Duration.secs(1);

/** What holds the ACP session, whose id names Antigravity's brain folder. */
export interface SessionHolder {
	readonly sessionId: string | null;
}

/** A task Antigravity backgrounded a command into: its own id, and its log. */
export interface AntigravityTask {
	id: string;
	log: string | null;
}

// Antigravity's `run_command` waits up to `WaitMsBeforeAsync` for a command,
// then leaves it running as a task of its own and tells only the model so:
// over ACP its tool call just stays in progress until the command exits. Its
// transcript, under the brain folder named for the ACP session, says the
// task's id and log, which this reads to list it on the Background card.
/**
 * Lists on the Background card each command Antigravity backgrounds, with
 * its task id and log, and ends it with its exit code. Hand it every update
 * the agent sends; dispose it with the connection.
 */
export class AntigravityBackground implements Resource {
	/** The tool calls still waiting to be backgrounded, by their id. */
	private readonly waiting = new Map<string, Resource>();
	/** The task each backgrounded tool call went to, by the call's id. */
	private readonly tasks = new Map<string, string>();
	private disposed = false;

	constructor(
		private readonly host: Pick<
			ConversationHost,
			"state" | "log" | "now" | "changed"
		>,
		private readonly deps: { fs: Fs; timer: Timer; home: string },
		private readonly connection: SessionHolder,
	) {}

	/** Takes in an update the agent sent, after it was folded into the state. */
	heard(update: acp.SessionUpdate): void {
		if (
			this.disposed ||
			(update.sessionUpdate !== "tool_call" &&
				update.sessionUpdate !== "tool_call_update")
		) {
			return;
		}
		const id = update.toolCallId;
		const tool = toolIn(this.host.state, id);
		if (tool === null || tool.kind !== "execute") {
			return;
		}
		if (tool.status !== "completed" && tool.status !== "failed") {
			const command = commandIn(update.rawInput);
			if (command !== null && !this.waiting.has(id) && !this.tasks.has(id)) {
				this.waiting.set(
					id,
					this.deps.timer.setTimeout(
						() => void this.backgrounded(id, command),
						waitIn(update.rawInput).add(SLACK),
					),
				);
			}
			return;
		}
		this.waiting.get(id)?.dispose();
		this.waiting.delete(id);
		const task = this.tasks.get(id);
		if (task === undefined) {
			return;
		}
		this.tasks.delete(id);
		const code = exitCodeIn(tool.output);
		this.say({
			sessionUpdate: ASYNC_TASK_STATE,
			asyncTaskId: task,
			state:
				tool.status === "failed" || (code ?? 0) !== 0 ? "failed" : "completed",
			...(code === null ? {} : { summary: `exit code ${code}` }),
		});
	}

	dispose(): void {
		this.disposed = true;
		for (const each of this.waiting.values()) {
			each.dispose();
		}
		this.waiting.clear();
	}

	/** Lists tool call `id`'s command, still running past its wait, as backgrounded. */
	private async backgrounded(id: string, command: string): Promise<void> {
		this.waiting.delete(id);
		const session = this.connection.sessionId;
		const tool = toolIn(this.host.state, id);
		if (
			session === null ||
			tool === null ||
			tool.status === "completed" ||
			tool.status === "failed"
		) {
			return;
		}
		const taken = new Set(this.tasks.values());
		const found = await this.deps.fs
			.read(transcriptPath(this.deps.home, session))
			.then((transcript) => taskIn(transcript, session, command, taken))
			.catch(() => null);
		const after = toolIn(this.host.state, id);
		if (
			this.disposed ||
			after === null ||
			after.status === "completed" ||
			after.status === "failed"
		) {
			return;
		}
		// Unnamed in the transcript, it is still backgrounded, with no log.
		const task = found ?? { id: `antigravity:${id}`, log: null };
		this.tasks.set(id, task.id);
		this.say({
			sessionUpdate: ASYNC_TASK_SPAWNED,
			asyncTaskId: task.id,
			name: command,
			taskType: "shell",
			description: command,
			toolCallId: id,
			command,
			...(task.log === null ? {} : { outputFilePath: task.log }),
		});
	}

	private say(update: AsyncTaskUpdate): void {
		const at = this.host.now();
		this.host.log.write({ kind: "background", update, at });
		foldBackground(this.host.state, update, at);
		this.host.changed();
	}
}

/** Where Antigravity keeps session `session`'s transcript, under its home. */
export function transcriptPath(home: string, session: string): string {
	return `${home}/brain/${session}/.system_generated/logs/transcript_full.jsonl`;
}

/**
 * The task the transcript says `command` was backgrounded into, the latest
 * of them not in `taken`; null when it names none.
 */
export function taskIn(
	transcript: string,
	session: string,
	command: string,
	taken: ReadonlySet<string> = new Set(),
): AntigravityTask | null {
	let found: AntigravityTask | null = null;
	for (const line of transcript.split("\n")) {
		if (!line.includes("background task with task id:")) {
			continue;
		}
		let content: unknown;
		try {
			content = (JSON.parse(line) as { content?: unknown }).content;
		} catch {
			continue;
		}
		if (typeof content !== "string") {
			continue;
		}
		const id = /background task with task id: (\S+)/.exec(content)?.[1];
		const description = /^Task Description: (.*)$/m.exec(content)?.[1];
		if (
			id === undefined ||
			!id.startsWith(`${session}/`) ||
			taken.has(id) ||
			description?.trim() !== command.trim()
		) {
			continue;
		}
		const log = /^Task logs are available at: file:\/\/(\S+)$/m.exec(
			content,
		)?.[1];
		found = { id, log: log === undefined ? null : decodeURI(log) };
	}
	return found;
}

/** The exit code `run_command`'s output opens with, as `Command exited with code 1.` */
export function exitCodeIn(output: string): number | null {
	const code = /Command exited with code (-?\d+)/.exec(output)?.[1];
	return code === undefined ? null : Number(code);
}

function commandIn(input: unknown): string | null {
	const command = (input as { CommandLine?: unknown } | null | undefined)
		?.CommandLine;
	return typeof command === "string" && command.trim() !== "" ? command : null;
}

function waitIn(input: unknown): Duration {
	const wait = (input as { WaitMsBeforeAsync?: unknown } | null | undefined)
		?.WaitMsBeforeAsync;
	return typeof wait === "number" && wait >= 0
		? Duration.ms(wait)
		: DEFAULT_WAIT;
}
