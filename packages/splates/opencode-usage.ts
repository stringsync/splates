import type * as acp from "@agentclientprotocol/sdk";
import { agentError } from "./agent-errors";
import type { ConversationState } from "./conversation-state";

/** Observations, never a quota estimate or evidence of an invoice. */
export interface OpenCodeUsage {
	turns: ObservedTurn[];
	costAt: string | null;
	retry: {
		attempt: number | null;
		nextRetryAt: string | null;
		message: string;
		type: string | null;
		status: number | null;
	} | null;
}

/** Null means absent or invalid, including in logs predating instrumentation. */
export interface ObservedTurn {
	at: string;
	until: string | null;
	firstText: string | null;
	requested: string | null;
	confirmed: string | null;
	cwd: string | null;
	/** ACP prompt response; per turn, parent session only. */
	tokens: {
		input: number | null;
		output: number | null;
		cachedRead: number | null;
		cachedWrite: number | null;
	} | null;
}

export function metric(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: null;
}

/** End exactly once, including cancellation, failure and worker reattachment. */
export function finishObservation(
	state: ConversationState,
	at: string | null,
): void {
	const report = state.usage.opencode;
	if (report === undefined) {
		return;
	}
	const turn = report.turns.at(-1);
	if (turn !== undefined && turn.until === null) {
		turn.until = at;
	}
	report.retry = null;
}

/** Keep only documented retry fields; provider response bodies are not diagnostics. */
export function safeOpenCodeUpdate(
	update: acp.SessionUpdate,
): acp.SessionUpdate {
	const retry = update._meta?.["opencode/retry"];
	if (retry == null) {
		return update;
	}
	const value =
		typeof retry === "object" ? (retry as Record<string, unknown>) : {};
	const error = value.error as
		| { message?: unknown; type?: unknown; status?: unknown }
		| undefined;
	return {
		...update,
		_meta: {
			...update._meta,
			"opencode/retry": {
				attempt: metric(value.attempt),
				nextRetryAt:
					typeof value.nextRetryAt === "string" &&
					Number.isFinite(Date.parse(value.nextRetryAt))
						? value.nextRetryAt
						: null,
				error: {
					type: typeof error?.type === "string" ? agentError(error.type) : null,
					status: metric(error?.status),
					message: agentError(
						typeof error?.message === "string"
							? error.message
							: "Provider retry",
					),
				},
			},
		},
	};
}

/** Snapshot fields independently; optional cache data is not evidence of zero. */
export function observeTokens(
	state: ConversationState,
	usage: acp.Usage,
): void {
	const turn = state.usage.opencode?.turns.at(-1);
	if (turn === undefined || turn.tokens !== null) {
		return;
	}
	turn.tokens = {
		input: metric(usage.inputTokens),
		output: metric(usage.outputTokens),
		cachedRead: metric(usage.cachedReadTokens),
		cachedWrite: metric(usage.cachedWriteTokens),
	};
}
