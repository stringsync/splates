import type { Resource } from "core/disposable";
import type { ProcessEntry } from "core/system";
import { Duration } from "core/time";
import {
	ASYNC_TASK_SPAWNED,
	ASYNC_TASK_STATE,
	type AsyncTaskUpdate,
	foldBackground,
} from "../agents";
import { descendants } from "../workers";
import type { ConversationDeps, ConversationHost } from "./host";

/** How long to wait between checks on whether a found process has exited. */
export const CHECK_EVERY = Duration.secs(3);

/**
 * Lists on the Background card what any agent leaves running past its turn.
 * Call `started` as a turn starts and `ended` as it ends; dispose it with
 * the conversation.
 */
// Most agents say nothing of what they leave behind, so this reads the
// agent's process tree: each process a turn started that outlives it is
// logged as a background update, and marked ended once it leaves the table.
export class LeftRunning implements Resource {
	/** The agent's descendants already accounted for: there before a turn, or listed. */
	private readonly known = new Set<number>();
	private checking: Resource | null = null;
	private disposed = false;

	constructor(
		private readonly host: ConversationHost,
		private readonly deps: Pick<ConversationDeps, "machine" | "timer">,
		private readonly agent: { readonly pid: number | null },
	) {}

	/** Notes what the agent runs as a turn starts, its MCP servers among them. */
	async started(): Promise<void> {
		const pid = this.agent.pid;
		const table = pid === null ? null : await this.table();
		if (table === null || pid === null) {
			return;
		}
		for (const each of descendants(table, pid)) {
			this.known.add(each);
		}
	}

	/** Lists each process the turn started that still runs. */
	async ended(): Promise<void> {
		const pid = this.agent.pid;
		const table = pid === null ? null : await this.table();
		if (table === null || pid === null || this.disposed) {
			return;
		}
		const fresh = new Set(
			descendants(table, pid).filter((each) => !this.known.has(each)),
		);
		const roots = table.filter(
			(each) => fresh.has(each.pid) && !fresh.has(each.ppid),
		);
		for (const each of fresh) {
			this.known.add(each);
		}
		for (const root of roots) {
			if (ignored(root.command) || this.reported(root.command)) {
				continue;
			}
			this.say({
				sessionUpdate: ASYNC_TASK_SPAWNED,
				asyncTaskId: `pid:${root.pid}`,
				name: named(root.command),
				taskType: "process",
				description: named(root.command),
				command: root.command,
				canStop: false,
				pid: root.pid,
			});
		}
		this.check();
	}

	dispose(): void {
		this.disposed = true;
		this.checking?.dispose();
		this.checking = null;
	}

	/** Looks again soon, while any listed process is still running. */
	private check(): void {
		if (
			this.checking !== null ||
			this.disposed ||
			this.running().length === 0
		) {
			return;
		}
		this.checking = this.deps.timer.setTimeout(() => {
			this.checking = null;
			void this.gone().finally(() => this.check());
		}, CHECK_EVERY);
	}

	/** Says each listed process no longer in the table ended. */
	private async gone(): Promise<void> {
		const table = await this.table();
		if (table === null || this.disposed) {
			return;
		}
		const alive = new Set(table.map((each) => each.pid));
		for (const each of this.running()) {
			if (!alive.has(each.pid)) {
				this.say({
					sessionUpdate: ASYNC_TASK_STATE,
					asyncTaskId: each.id,
					// Its exit code went with its parent, which reaped it.
					state: "completed",
				});
			}
		}
	}

	private running(): { id: string; pid: number }[] {
		return this.host.state.background.flatMap((each) =>
			each.pid !== undefined && each.state === "running"
				? [{ id: each.id, pid: each.pid }]
				: [],
		);
	}

	/** Whether the agent already listed `command` itself, as Claude does. */
	private reported(command: string): boolean {
		const running = plain(command);
		return this.host.state.background.some((each) => {
			if (each.pid !== undefined || each.command === null) {
				return false;
			}
			// What Antigravity backgrounds runs as some step of its command line
			// (`bin/mono fix` as `bun .../index.ts fix`), which no text matches:
			// a process left beside one of its tasks is that task's.
			if (this.host.state.agent === "antigravity") {
				return each.state === "running";
			}
			const said = plain(each.command).slice(0, 60);
			return said !== "" && running.includes(said);
		});
	}

	private say(update: AsyncTaskUpdate): void {
		const at = this.host.now();
		this.host.log.write({ kind: "background", update, at });
		foldBackground(this.host.state, update, at);
		this.host.changed();
	}

	/** The agent's machine's process table; null when it cannot be read. */
	private async table(): Promise<ProcessEntry[] | null> {
		return this.deps.machine.processes().catch(() => null);
	}
}

/**
 * Whether `command` is the agent's own machinery rather than work it left:
 * an MCP server started on first use, or macOS's `caffeinate` held while it
 * works.
 */
function ignored(command: string): boolean {
	// `ps` prints an exited process nobody has reaped yet as `(name)`.
	if (/^\([^()\s]+\)$/.test(command.trim())) {
		return true;
	}
	return /\bmcp\b|mcp-server|[/-]mcp\b|\bcaffeinate\b/i.test(command);
}

/** `command` without quotes, escapes or runs of spaces, for comparing. */
function plain(command: string): string {
	return command
		.replace(/["'\\]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

// vet-ignore doc-comments-address-users: says what the caller reads from it
/** Shortens a process's command line to the name the card shows for it. */
export function named(command: string): string {
	// Claude runs a command as `eval '...'` in a shell; others as its `-c`.
	const run =
		/\beval\s+(['"])(.*?)\1/.exec(command)?.[2] ??
		/\s-l?c(?:\s+-l)?\s+(.*)$/.exec(command)?.[1] ??
		command;
	const words = plain(run);
	return words.length > 80 ? `${words.slice(0, 79)}…` : words;
}
