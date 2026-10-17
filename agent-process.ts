import * as acp from "@agentclientprotocol/sdk";
import type { Resource } from "webappwiz/disposable";
import { NodePs } from "webappwiz/system";
import { Duration, type Timer } from "webappwiz/time";
import { AgentStream } from "./agent-stream";
import { SERVING } from "./supervise";

/** An agent arbor can hold a conversation with over ACP, and how to start it. */
export interface Agent {
	id: string;
	name: string;
	argv: string[];
}

/** What a process wrote to stdout, numbered from 1 so a restart can say what it holds. */
export interface AgentFrame {
	bytes: Uint8Array;
	seq: number;
}

/** What finds a process again after a restart: the worker it runs on and its channel there. */
export interface ProcessHandle {
	worker: string;
	channel: number;
}

/** A running agent: bytes in, frames out, and a way to stop it. */
export interface AgentProcess {
	/** Its pid, for what runs under it; null for one that never started. */
	pid: number | null;
	input: WritableStream<Uint8Array>;
	output: ReadableStream<AgentFrame>;
	/**
	 * Says everything up to frame `seq` is written down, so a restart replays
	 * from past it; nothing to do for a process that ends with this one.
	 */
	ack(seq: number): void;
	/** What takes it back after a restart; null for one that ends with this process. */
	handle: ProcessHandle | null;
	/** What it last wrote to stderr, for when it dies before saying why. */
	stderr(): string;
	exited: Promise<number>;
	kill(): void;
}

/** `bytes` as frames, numbered from 1 as they come. */
export function framed(
	bytes: ReadableStream<Uint8Array>,
): ReadableStream<AgentFrame> {
	let seq = 0;
	return bytes.pipeThrough(
		new TransformStream<Uint8Array, AgentFrame>({
			transform: (chunk, controller) =>
				controller.enqueue({ bytes: chunk, seq: ++seq }),
		}),
	);
}

/** Starts `argv` in `cwd`, with `env` added to its own, its stdio piped. */
export type Launch = (
	argv: string[],
	cwd: string,
	env: Record<string, string>,
) => AgentProcess;

/** What starts a conversation's agent, and takes one back after a restart. */
export interface Launcher {
	launch: Launch;
	/**
	 * The process `handle` names, kept running while this coordinator was
	 * away, its output carrying on from past frame `held`, the last one the
	 * log holds. Throws when nothing here can take it back.
	 */
	resume(handle: ProcessHandle, held: number): AgentProcess;
}

/** `launch` alone, for a process that ends with this one: nothing takes one back. */
export function launcherOf(launch: Launch): Launcher {
	return {
		launch,
		resume: (handle) => {
			throw new Error(
				`nothing here takes back channel ${handle.channel} of worker ${handle.worker}`,
			);
		},
	};
}

export const launch: Launch = (argv, cwd, env) => {
	// So an `arbor dev` the agent runs supervises itself rather than serving
	// as this one's child.
	const child = new NodePs().start(argv, { cwd, env, unset: [SERVING] });
	let tail = "";
	// One that never started, as in a directory since removed, aborts its
	// pipes and rejects its exit: it ends as one that exited saying why.
	void (async () => {
		const decoder = new TextDecoder();
		for await (const chunk of child.stderr) {
			tail = (tail + decoder.decode(chunk)).slice(-STDERR_CHARS);
		}
	})().catch(() => {});
	return {
		pid: child.pid,
		input: child.stdin,
		output: framed(child.stdout),
		ack: () => {},
		handle: null,
		stderr: () => tail,
		exited: child.exited.catch((error: unknown) => {
			tail = `cannot start ${argv[0]} in ${cwd}: ${error instanceof Error ? error.message : String(error)}`;
			return 127;
		}),
		kill: () => child.kill(),
	};
};

/** How much of an agent's stderr is kept to explain how it died. */
const STDERR_CHARS = 2_000;

/** A session an agent holds that arbor could bring in. */
export interface Session {
	agent: string;
	session: string;
	title: string | null;
	/** When it was last active, as the agent says; null when it does not. */
	updatedAt: string | null;
}

/** How long an agent has to start and list its sessions. */
const LIST_WAIT = Duration.secs(30);

/** How many pages of sessions are read from an agent, at most. */
const LIST_PAGES = 10;

/**
 * The sessions `agent` holds in `cwd`, asked of a process of its own that
 * stops once it answers; none when it cannot both list and load them.
 */
export async function listSessions(
	agent: Agent,
	cwd: string,
	run: Launch,
	timer: Timer,
): Promise<Session[]> {
	const process = run(agent.argv, cwd, {});
	let timeout: Resource | null = null;
	try {
		const connection = new acp.ClientSideConnection(
			() => ({
				sessionUpdate: async () => {},
				requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
			}),
			new AgentStream(process),
		);
		const listing = (async () => {
			const initialized = await connection.initialize({
				protocolVersion: acp.PROTOCOL_VERSION,
				clientCapabilities: {},
			});
			const capabilities = initialized.agentCapabilities;
			if (
				capabilities?.loadSession !== true ||
				capabilities.sessionCapabilities?.list == null
			) {
				return [];
			}
			const sessions: Session[] = [];
			let cursor: string | null = null;
			for (let page = 0; page < LIST_PAGES; page++) {
				const listed: acp.ListSessionsResponse = await connection.listSessions({
					cwd,
					cursor,
				});
				for (const each of listed.sessions) {
					// An agent may list more than it was asked for.
					if (each.cwd === cwd) {
						sessions.push({
							agent: agent.id,
							session: each.sessionId,
							title: each.title ?? null,
							updatedAt: each.updatedAt ?? null,
						});
					}
				}
				cursor = listed.nextCursor ?? null;
				if (cursor === null) {
					break;
				}
			}
			return sessions;
		})();
		const gaveUp = new Promise<never>((_, reject) => {
			timeout = timer.setTimeout(
				() => reject(new Error(`${agent.name} did not list its sessions`)),
				LIST_WAIT,
			);
		});
		const died = process.exited.then((code): never => {
			throw new Error(`${agent.name} exited with code ${code}`);
		});
		return await Promise.race([listing, gaveUp, died]);
	} finally {
		(timeout as Resource | null)?.dispose();
		process.kill();
	}
}
