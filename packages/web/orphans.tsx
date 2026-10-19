import type { ConversationState } from "@stringsync/splates-server/conversations";
import { orphaned } from "@stringsync/splates-server/plans/browser";
import type { Details } from "@stringsync/splates-server/tasks";
import type { JSX } from "react";
import { UpdateDot } from "./release";

/** How many of `tasks` no agent is left on, as `orphaned` says. */
export function orphanCount(
	tasks: readonly Details[],
	conversations: readonly ConversationState[],
): number {
	return tasks.filter((task) => orphaned(task, conversations) !== null).length;
}

/**
 * The Tasks tab's dot, saying a task waits on the person to hand it to an
 * agent or remove it.
 */
export function OrphansDot({ ring }: { ring?: string }): JSX.Element {
	return (
		<span role="img" aria-label="orphaned tasks">
			<UpdateDot ring={ring} />
		</span>
	);
}
