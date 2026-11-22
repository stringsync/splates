import type { TaskRecord } from "@splates/server/board";
import type { ConversationState } from "@splates/server/conversations";
import type { Needing } from "@splates/server/plans/browser";
import type { RunState } from "@splates/server/ship";
import { lastReport } from "./conversation-names";

/** Where work a ship spawned stands, from its board task and conversation. */
export type SpawnedStatus =
	| "queued"
	| "working"
	| "asking"
	| "review"
	| "merging"
	| "idle"
	| "merged"
	| "removed"
	| "ended";

/**
 * A task or conversation a ship spawned: a failed step's fix, or a task the
 * ship owns and started itself, such as checking an upstream update.
 */
export interface SpawnedWork {
	/** Why the ship has it: a fix of a failed step, or its own agent task. */
	kind: "fix" | "agent";
	/** The board task, when there is one. */
	todo?: number;
	/** The conversation working on it, once one is. */
	conversation?: string;
	subject: string;
	target?: string;
	step?: string;
	status: SpawnedStatus;
	/** What it says now: what it is doing, or the question it waits on. */
	line?: string;
}

/**
 * Every task and conversation run `run` spawned, in the order they came:
 * each failed step's fix, then each board task and conversation the ship
 * owns, with where each stands now.
 */
export function spawnedWork({
	run,
	todos,
	conversations,
	needing,
}: {
	run: RunState;
	todos: readonly TaskRecord[];
	conversations: readonly ConversationState[];
	/** What each agent needs, as the page reads it, for a live one's status. */
	needing: readonly Needing[];
}): SpawnedWork[] {
	const found: Found[] = [];
	for (const target of run.targets) {
		for (const step of target.steps) {
			if (step.fix !== undefined) {
				found.push({
					kind: "fix",
					todo: step.fix.task,
					target: target.name,
					step: step.id,
					ended: step.fix.ended,
				});
			}
		}
	}
	for (const todo of todos) {
		if (
			todo.ship?.run === run.id &&
			!found.some((each) => each.todo === todo.id)
		) {
			found.push({
				kind: "agent",
				todo: todo.id,
				step: todo.ship.step,
				target: targetOf(run, todo.ship.step),
			});
		}
	}
	// Archived conversations count too, so a fix's link reaches its conversation
	// however it was put away; a live one is preferred when two took the task.
	const live = [...conversations].sort(
		(first, second) => Number(first.archived) - Number(second.archived),
	);
	const claimed = new Set<string>();
	const rows = found.map((each) => {
		const record = todos.find((todo) => todo.id === each.todo);
		const conversation = live.find(
			(talk) =>
				talk.heldForTask === each.todo ||
				(record?.takenBy != null &&
					(talk.task === record.takenBy || talk.lastTask === record.takenBy)),
		);
		if (conversation !== undefined) {
			claimed.add(conversation.id);
		}
		return rowOf(each, record, conversation, needing);
	});
	for (const conversation of live) {
		if (
			!conversation.archived &&
			conversation.ship === run.id &&
			!claimed.has(conversation.id)
		) {
			rows.push(rowOf({ kind: "agent" }, undefined, conversation, needing));
		}
	}
	return rows;
}

/** Spawned work found, before its board task and conversation are read. */
interface Found {
	kind: SpawnedWork["kind"];
	todo?: number;
	target?: string;
	step?: string;
	/** How a fix ended, as the run recorded it. */
	ended?: "merged" | "removed" | "abandoned" | undefined;
}

function rowOf(
	found: Found,
	record: TaskRecord | undefined,
	conversation: ConversationState | undefined,
	needing: readonly Needing[],
): SpawnedWork {
	const { status, line } = standing(found, record, conversation, needing);
	return {
		kind: found.kind,
		subject:
			record?.subject ??
			conversation?.name ??
			conversation?.title ??
			(found.step === undefined ? "Ship task" : `Fix ${found.step}`),
		status,
		...(found.todo !== undefined && { todo: found.todo }),
		...(conversation !== undefined && { conversation: conversation.id }),
		...(found.target !== undefined && { target: found.target }),
		...(found.step !== undefined && { step: found.step }),
		...(line !== undefined && { line }),
	};
}

/** Where spawned work stands: how it ended, else what its agent needs. */
function standing(
	found: Found,
	record: TaskRecord | undefined,
	conversation: ConversationState | undefined,
	needing: readonly Needing[],
): { status: SpawnedStatus; line?: string } {
	if (found.ended !== undefined) {
		// An agent that ended without taking its task gave the fix up.
		return { status: found.ended === "abandoned" ? "removed" : found.ended };
	}
	const ending =
		conversation === undefined ? null : lastReport(conversation)?.ending;
	if (ending === "merged" || ending === "removed") {
		return { status: ending };
	}
	if (ending === "done" || ending === "deferred" || ending === "escalated") {
		return { status: "ended" };
	}
	const row =
		conversation === undefined
			? undefined
			: needing.find((each) => each.conversation?.id === conversation.id);
	if (row === undefined) {
		// No agent yet: the board says whether one has taken it.
		return {
			status:
				record === undefined || record.takenBy !== null ? "working" : "queued",
		};
	}
	const { need } = row;
	switch (need.kind) {
		case "waiting":
			return need.why === "review"
				? { status: "review", line: need.subject }
				: { status: "asking", line: need.subject };
		case "assuming":
			return { status: "working", line: need.subject };
		case "working":
			return need.merge !== undefined
				? { status: "merging" }
				: {
						status: "working",
						...(need.subject !== null && { line: need.subject }),
					};
		case "idle":
			return { status: record?.takenBy === null ? "queued" : "idle" };
	}
}

/** The target of `run` with a step `step`, when one has. */
function targetOf(run: RunState, step: string): string | undefined {
	return run.targets.find((target) =>
		target.steps.some((each) => each.id === step),
	)?.name;
}
