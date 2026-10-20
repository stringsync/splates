import type {
	Compaction,
	ConversationState,
	Tool,
} from "@stringsync/splates-server/conversations";
import { useCallback, useContext, useSyncExternalStore } from "react";
import { Duration } from "webappwiz/time";
import { cancelConversation } from "./conversation-api";
import { EverywhereContext } from "./everywhere-context";
import type { useExpect } from "./expecting";
import { HeldFeed } from "./handed-out";
import { useNow } from "./hooks/use-now";
import type { Refuse } from "./refusal";

/** How long a working agent with nothing in flight may go without a word. */
export const QUIET = Duration.mins(3);
/** How long a tool call, a subagent, or a compaction may run without a word. */
export const QUIET_TOOL = Duration.mins(15);

/** A working agent gone quiet long enough that it may be stuck. */
export interface Quiet {
	/** How long since it last moved, shortly: "4m", "1h 5m". */
	for: string;
	/** The tool call, subagent, or compaction still in flight; null for none. */
	running: string | null;
}

/**
 * Whether conversation `conversation`'s agent may be stuck at `now`: working,
 * not waiting on a permission ask, and with no word for `QUIET`, or for
 * `QUIET_TOOL` while something it started runs. Null otherwise, and as soon
 * as it moves again.
 */
export function quietOf(
	conversation: ConversationState,
	now: number,
): Quiet | null {
	if (conversation.status !== "running" || conversation.ask !== null) {
		return null;
	}
	const last = conversation.messages.at(-1);
	if (
		last === undefined ||
		last.stopped !== undefined ||
		last.interrupted !== undefined
	) {
		return null;
	}
	const moved = Date.parse(
		(last.role === "agent" ? last.until : last.sentAt) ?? last.at ?? "",
	);
	if (!Number.isFinite(moved)) {
		return null;
	}
	const flight =
		last.role === "agent"
			? last.parts.findLast(
					(part): part is Tool | Compaction =>
						(part.type === "tool" &&
							(part.status === "pending" || part.status === "in_progress")) ||
						(part.type === "compaction" && part.status === "in_progress"),
				)
			: undefined;
	const quiet = now - moved;
	if (quiet < (flight === undefined ? QUIET : QUIET_TOOL).ms) {
		return null;
	}
	return {
		for: shortly(quiet),
		running:
			flight === undefined
				? null
				: flight.type === "compaction"
					? "Compacting"
					: flight.title,
	};
}

/** `quietOf` kept current while the agent works. */
export function useQuiet(conversation: ConversationState | null): Quiet | null {
	const local = useContext(HeldFeed);
	const everywhere = useContext(EverywhereContext);
	const project =
		conversation !== null && "project" in conversation
			? conversation.project
			: null;
	const feed = project === null ? local : everywhere;
	const now = useNow(conversation?.status === "running", Duration.secs(15));
	const subscribe = useCallback(
		(changed: () => void) => feed?.events.on("changed", changed) ?? (() => {}),
		[feed],
	);
	const read = useCallback(() => {
		const current =
			feed?.conversations.find(
				(each) =>
					each.id === conversation?.id &&
					(project === null || ("project" in each && each.project === project)),
			) ?? conversation;
		return JSON.stringify(current === null ? null : quietOf(current, now));
	}, [feed, conversation, project, now]);
	const quiet = useSyncExternalStore(subscribe, read, read);
	return JSON.parse(quiet) as Quiet | null;
}

/** What a row says of an agent that may be stuck. */
export function quietText(quiet: Quiet): string {
	return quiet.running === null
		? `Possibly stuck · quiet ${quiet.for}`
		: `Possibly stuck · ${quiet.running} ${quiet.for}`;
}

/** What a mark's tooltip says of an agent that may be stuck. */
export function quietTitle(quiet: Quiet): string {
	return quiet.running === null
		? `Possibly stuck: no activity for ${quiet.for}`
		: `Possibly stuck: ${quiet.running} has run ${quiet.for} with no activity`;
}

function shortly(ms: number): string {
	const mins = Math.floor(ms / 60_000);
	return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/**
 * Stops the turn of `conversation`, as for an agent that may be stuck,
 * showing it stopped at once.
 */
export function stopTurn(
	conversation: ConversationState,
	expect: ReturnType<typeof useExpect>,
	refuse: Refuse,
): void {
	const at = new Date().toISOString();
	void expect(
		conversation.id,
		(state) => ({
			...state,
			messages: state.messages.map((each, index) =>
				index === state.messages.length - 1 && each.role === "agent"
					? { ...each, stopped: at }
					: each,
			),
		}),
		cancelConversation(conversation.id),
	).catch((error: unknown) => refuse("Not stopped", error));
}
