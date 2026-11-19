import type { ConversationState } from "@splates/server/conversations";
import { needs } from "@splates/server/plans/browser";
import type { RunState } from "@splates/server/ship";
import type { Snapshot } from "@splates/server/tasks";
import { useCallback, useSyncExternalStore } from "react";
import type { ConversationFeed } from "./conversation-feed";
import { type SpawnedWork, spawnedWork } from "./ship-spawned-work";

const NONE: ConversationState[] = [];

/**
 * What a run spawned, read from the project's board and tasks in
 * `snapshot` and the conversations in `talk`, live as either changes.
 */
export function useSpawnedOf(
	snapshot: Snapshot | null,
	talk: ConversationFeed | null,
): (run: RunState) => SpawnedWork[] {
	const subscribe = useCallback(
		(changed: () => void) =>
			talk === null ? () => {} : talk.events.on("changed", changed),
		[talk],
	);
	const read = useCallback(() => talk?.conversations ?? NONE, [talk]);
	const conversations = useSyncExternalStore(subscribe, read, read);
	return useCallback(
		(run: RunState) => {
			const todos = snapshot?.todos ?? [];
			const tasks = snapshot?.tasks ?? [];
			return spawnedWork({
				run,
				todos,
				conversations,
				needing: needs({ tasks, conversations, todos }),
			});
		},
		[snapshot, conversations],
	);
}
