import type { ConversationState } from "@stringsync/splates-server/conversations";
import { LinkIcon } from "lucide-react";
import { type JSX, useContext } from "react";
import { Board } from "./board";
import { TaskIcon } from "./task-icon";

/**
 * The tasks a conversation references: the one it runs in, any it acted on
 * (added, claimed, merged), in the order it first met them. Each opens on a tap, as
 * its dialog if live, else as it finished. Nothing at all
 * while it references none.
 */
export function ReferencesCard({
	conversation,
}: {
	conversation: ConversationState;
}): JSX.Element | null {
	const board = useContext(Board);
	const tasks = referencedTasks(conversation);
	if (tasks.length === 0) {
		return null;
	}
	return (
		<section
			aria-label="references"
			data-widget
			className="overflow-hidden rounded-lg border bg-background py-1"
		>
			<h3 className="flex h-8 items-center gap-2 px-3 font-medium text-sm [&_svg]:size-4 [&_svg]:text-muted-foreground">
				<LinkIcon />
				References
			</h3>
			<ul aria-label="referenced tasks">
				{tasks.map((task) => {
					return (
						<li key={task}>
							<button
								type="button"
								disabled={!board.linked}
								onClick={() => board.openTask(task)}
								className="flex h-8 w-full items-center gap-2 px-3 text-left text-sm transition-colors enabled:hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0"
							>
								<TaskIcon />
								<span className="min-w-0 flex-1 truncate">{task}</span>
							</button>
						</li>
					);
				})}
			</ul>
		</section>
	);
}

/** The tasks the conversation ran in or acted on, each once, oldest first. */
export function referencedTasks(
	conversation: Pick<ConversationState, "task" | "lastTask" | "events">,
): string[] {
	const seen = new Set<string>();
	for (const event of conversation.events) {
		if (event.task !== null && event.reason === null) {
			seen.add(event.task);
		}
	}
	for (const own of [conversation.lastTask, conversation.task]) {
		if (own !== null) {
			seen.add(own);
		}
	}
	return [...seen];
}
