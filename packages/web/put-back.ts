import type { ConversationState } from "@splates/server/conversations";
import type { TaskReport } from "@splates/server/plans";
import { DEFER } from "@splates/server/plans/browser";
import { useEffect, useRef, useState } from "react";
import { promptConversation, sendQueuedNow } from "./conversation-api";
import { lastReport } from "./conversation-names";
import type { Refuse } from "./refusal";

/**
 * Asks the agent to put the conversation's task back on the board, as the
 * Defer directive does, and says when its Deferred report has come after
 * the ask, so the conversation can be archived once the task is safe.
 */
export function usePutBack(
	conversation: ConversationState,
	refused: Refuse,
): { putBack: () => void; awaiting: string | undefined } {
	// The source of the report the ask began at; undefined while not asking.
	const [awaiting, setAwaiting] = useState<string | undefined>(undefined);
	const { id } = conversation;
	const putBack = () => {
		setAwaiting(lastReport(conversation)?.source ?? "");
		void promptConversation(id, DEFER)
			.then(() => sendQueuedNow(id))
			.catch((error: unknown) => {
				setAwaiting(undefined);
				refused("Not put back on the board", error);
			});
	};
	return { putBack, awaiting };
}

/** Archives, through `file`, once `awaiting` is answered by a new Deferred `report`. */
export function useArchiveAfterPutBack(
	awaiting: string | undefined,
	report: TaskReport | null,
	file: () => void,
): void {
	const filing = useRef(file);
	filing.current = file;
	const deferred = report?.ending === "deferred" ? report.source : undefined;
	useEffect(() => {
		if (
			awaiting !== undefined &&
			deferred !== undefined &&
			deferred !== awaiting
		) {
			filing.current();
		}
	}, [awaiting, deferred]);
}
