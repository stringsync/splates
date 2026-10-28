import type { ConversationState } from "@stringsync/splates-server/conversations";
import type { Details } from "@stringsync/splates-server/tasks";
import { createContext, type ReactNode, useContext } from "react";
import { usePendingWrites } from "./pending";
import { RowRefusals } from "./row-refusal";

/** The project whose conversations an action sheet changes, when it is not the page's own. */
const ConversationProject = createContext<{
	project: string;
	tasks: Details[];
	conversations: ConversationState[];
	writes: ReturnType<typeof usePendingWrites>;
} | null>(null);

/** The owning project for conversation actions; null uses the page's feeds. */
export function useConversationProject() {
	return useContext(ConversationProject);
}

/** Keeps another project's conversation actions and pending writes within that project. */
export function InConversationProject({
	project,
	tasks,
	conversations,
	children,
}: {
	project: string;
	tasks: Details[];
	conversations: ConversationState[];
	children: ReactNode;
}) {
	const writes = usePendingWrites();
	return (
		<ConversationProject value={{ project, tasks, conversations, writes }}>
			<RowRefusals value={null}>{children}</RowRefusals>
		</ConversationProject>
	);
}
