import type * as acp from "@agentclientprotocol/sdk";
import type { ConversationState } from "./conversation-state";
import { toolIn } from "./tool-calls";

/**
 * What every session is opened with. Claude's AskUserQuestion is off, so its
 * questions go under `## Blocked` and into its reply, as the arbor skill asks,
 * rather than into a form `ARBOR.md` never sees. Other agents ignore it.
 */
export const SESSION_META = {
	claudeCode: { options: { disallowedTools: ["AskUserQuestion"] } },
};

/** The ACP extension that says a prompt into the turn the agent is running. */
export const STEER = "_session/steering";

/**
 * The updates and request, an ACP draft Claude's adapter speaks ahead of the
 * SDK, that say when a background command starts and ends, and stop one.
 */
export const ASYNC_TASK_SPAWNED = "async_task_spawned";
export const ASYNC_TASK_STATE = "async_task_state_update";
export const ASYNC_TASK_PROGRESS = "async_task_progress";
export const ASYNC_TASK_STOP = "_session/async_task/stop";

/** The notification the client hears each of those updates as (see `asyncTasks`). */
export const ASYNC_TASK_UPDATE = "_arbor/async_task";

/**
 * The messages from an agent, each update on a background command moved to
 * `ASYNC_TASK_UPDATE`, ahead of the SDK's checks, which would refuse it as a
 * session update they do not know.
 */
export function asyncTasks(
	messages: ReadableStream<acp.AnyMessage>,
): ReadableStream<acp.AnyMessage> {
	return messages.pipeThrough(
		new TransformStream<acp.AnyMessage, acp.AnyMessage>({
			transform(message, controller) {
				const kind =
					"method" in message && message.method === "session/update"
						? (message.params as { update?: { sessionUpdate?: unknown } })
								?.update?.sessionUpdate
						: undefined;
				controller.enqueue(
					kind === ASYNC_TASK_SPAWNED ||
						kind === ASYNC_TASK_STATE ||
						kind === ASYNC_TASK_PROGRESS
						? { ...message, method: ASYNC_TASK_UPDATE }
						: message,
				);
			},
		}),
	);
}

export interface AsyncTaskSpawned {
	sessionUpdate: typeof ASYNC_TASK_SPAWNED;
	asyncTaskId: string;
	name: string;
	/** `shell` for a command, else a workflow or the like. */
	taskType: string;
	description: string;
	toolCallId?: string;
	outputFilePath?: string;
}

export interface AsyncTaskState {
	sessionUpdate: typeof ASYNC_TASK_STATE;
	asyncTaskId: string;
	state: "running" | "paused" | "completed" | "failed" | "stopped";
	outputFilePath?: string;
}

/** What the agent says as a command goes on: here, only where its output is. */
export interface AsyncTaskProgress {
	sessionUpdate: typeof ASYNC_TASK_PROGRESS;
	asyncTaskId: string;
	outputFilePath?: string;
}

export type AsyncTaskUpdate =
	| AsyncTaskSpawned
	| AsyncTaskState
	| AsyncTaskProgress;

/** Whether an agent says, as it starts, that it takes `STEER`. */
export function steers(initialized: acp.InitializeResponse): boolean {
	const steering = initialized._meta?.steering;
	return (
		typeof steering === "object" &&
		steering !== null &&
		"supported" in steering &&
		steering.supported === true
	);
}

/**
 * The AIR session list: subscribed for a working directory, the agent says
 * as each of its sessions there starts or ends a turn. Codex says so of a
 * turn it starts on its own nowhere else.
 */
export const SESSION_LIST_SUBSCRIBE = "_session/list/subscribe";
export const SESSION_LIST_CHANGES = "_session/list/changes";

/** Whether an agent says, as it starts, that it takes `SESSION_LIST_SUBSCRIBE`. */
export function listsSessions(initialized: acp.InitializeResponse): boolean {
	const air = (
		initialized._meta?.jetbrains as
			| { air?: { capabilities?: unknown } }
			| undefined
	)?.air;
	return (
		Array.isArray(air?.capabilities) &&
		air.capabilities.includes("sessionListSubscribe")
	);
}

/** What a `SESSION_LIST_CHANGES` row says of a session's turn. */
export interface ListedTurn {
	running: boolean;
	/** When its last turn ended, in ms; null before one has. */
	endedAt: number | null;
}

/**
 * What `params` of `SESSION_LIST_CHANGES` say of `session`'s turn; null when
 * they hold no row for it, or one that says nothing of its turns, as for a
 * session no process has open.
 */
export function listedTurn(
	params: Record<string, unknown>,
	session: string,
): ListedTurn | null {
	const sessions = Array.isArray(params.sessions) ? params.sessions : [];
	const row = sessions.findLast(
		(each): each is acp.SessionInfo => each?.sessionId === session,
	);
	const air = (
		row?._meta?.jetbrains as
			| { air?: { state?: unknown; lastTurnEndedAt?: unknown } }
			| undefined
	)?.air;
	if (air?.state === undefined) {
		return null;
	}
	const endedAt =
		typeof air.lastTurnEndedAt === "string"
			? Date.parse(air.lastTurnEndedAt)
			: Number.NaN;
	return {
		running: air.state !== "idle" && air.state !== "error",
		endedAt: Number.isNaN(endedAt) ? null : endedAt,
	};
}

/** Whether `update` is the agent's final answer, after which its turn ends. */
export function finalAnswer(update: acp.SessionUpdate): boolean {
	if (update.sessionUpdate !== "agent_message_chunk") {
		return false;
	}
	// Codex marks each message's phase for a client that declares AIR, as
	// arbor does for Claude's background commands.
	const air = (
		update._meta?.jetbrains as { air?: { phase?: unknown } } | undefined
	)?.air;
	return air?.phase === "final_answer";
}

/** Folds an update on a background command into those the agent left. */
export function foldBackground(
	state: ConversationState,
	update: AsyncTaskUpdate,
): void {
	if (update.sessionUpdate === ASYNC_TASK_SPAWNED) {
		if (update.taskType === "shell") {
			const tool =
				update.toolCallId === undefined
					? null
					: toolIn(state, update.toolCallId);
			const parent = tool?.parent ?? null;
			state.background = [
				...state.background.filter((each) => each.id !== update.asyncTaskId),
				{
					id: update.asyncTaskId,
					name: update.description || update.name,
					command: tool?.command ?? null,
					subagent:
						parent === null
							? null
							: {
									id: parent,
									title: toolIn(state, parent)?.title ?? "Subagent",
								},
					state: "running",
					output: update.outputFilePath ?? null,
				},
			];
		}
		return;
	}
	state.background = state.background.map((each) =>
		each.id !== update.asyncTaskId
			? each
			: {
					...each,
					output: update.outputFilePath ?? each.output,
					state:
						update.sessionUpdate === ASYNC_TASK_STATE &&
						update.state !== "running" &&
						update.state !== "paused"
							? update.state
							: each.state,
				},
	);
}
