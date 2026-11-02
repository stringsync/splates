import type { TaskRecord } from "@splates/server/board/browser";
import { useState } from "react";
import { queueTodo } from "./api";
import { useRefusal } from "./refusal";

/**
 * An action for each of the card's blockers, pending by key until the write
 * resolves; the card says it done only once the board shows it. A refusal
 * clears pending and is said.
 */
export function useActs() {
	const { refusal, attempt } = useRefusal();
	const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
	const act = async (key: string, write: () => Promise<void>) => {
		setPending((was) => new Set(was).add(key));
		await attempt(write(), "Not done");
		setPending((was) => {
			const left = new Set(was);
			left.delete(key);
			return left;
		});
	};
	return { refusal, attempt, pending, act };
}

/** Queues blocker `id`, unless `queuedAlready`, then `task` to run after it. */
export function queueingAfter(task: TaskRecord) {
	return (id: number, queuedAlready: boolean) => async () => {
		if (!queuedAlready) {
			await queueTodo(id, true);
		}
		await queueTodo(task.id, true);
	};
}
