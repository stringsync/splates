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

/**
 * The notification the client hears each of those updates as, once
 * `asyncTasks` has moved it there: the SDK would refuse it as a session update
 * it does not know.
 */
export const ASYNC_TASK_UPDATE = "_arbor/async_task";

/**
 * The messages from an agent, each update on a background command moved to
 * `ASYNC_TASK_UPDATE`, ahead of the SDK's checks.
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

/** Folds an update on a background command into those the agent left. */
export function foldBackground(
	state: ConversationState,
	update: AsyncTaskUpdate,
): void {
	if (update.sessionUpdate === ASYNC_TASK_SPAWNED) {
		if (update.taskType === "shell") {
			state.background = [
				...state.background.filter((each) => each.id !== update.asyncTaskId),
				{
					id: update.asyncTaskId,
					name: update.description || update.name,
					command:
						update.toolCallId === undefined
							? null
							: (toolIn(state, update.toolCallId)?.command ?? null),
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
