import type { TaskRecord } from "@splates/server/board";
import { UserIcon } from "lucide-react";
import { type JSX, useContext } from "react";
import { cn } from "#web/lib/utils.ts";
import { AgentMark } from "./agent-icons";
import { Board } from "./board";
import { Dispatching } from "./dispatching";
import { Markdown } from "./markdown";
import { TagChips } from "./tag-chips";
import { StageBadge } from "./todo-queue";

/**
 * A queued task as the first message of its conversation: its number, lane,
 * tags and where it stands, what it asks, and the agent that will work it,
 * which follows the composer's picker once the server shows the pick.
 */
export function TaskCard({
	todo,
	changing,
}: {
	todo: TaskRecord;
	/** A new assignee is on its way to the server. */
	changing: boolean;
}): JSX.Element {
	const { lanes } = useContext(Board);
	const lane = lanes.find((each) => each.id === todo.lane)?.name;
	const detail = todo.text.trim();
	return (
		<article
			aria-label={`Task #${todo.id}`}
			className="overflow-hidden rounded-2xl border border-foreground/10 bg-card text-card-foreground shadow-xs"
		>
			<header className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-3 text-muted-foreground text-xs">
				<span className="font-medium tabular-nums">#{todo.id}</span>
				{lane !== undefined && <span className="truncate">{lane}</span>}
				<TagChips tags={todo.labels} />
				<span className="ms-auto">
					<StageBadge todo={todo} />
				</span>
			</header>
			<div className="flex flex-col gap-2 px-4 pt-1 pb-3">
				<h2 className="font-semibold text-base leading-snug wrap-anywhere">
					{todo.subject}
				</h2>
				{detail !== "" && detail !== todo.subject && (
					<Markdown text={detail} className="text-sm" />
				)}
			</div>
			<footer className="flex items-center gap-2 border-foreground/10 border-t bg-muted/40 px-4 py-2 text-muted-foreground text-xs">
				<Assignee todo={todo} changing={changing} />
			</footer>
		</article>
	);
}

/** Who will work the task: the agent, model and thinking level picked, or any agent. */
function Assignee({
	todo,
	changing,
}: {
	todo: TaskRecord;
	changing: boolean;
}): JSX.Element {
	const context = useContext(Dispatching);
	const pick = todo.assignee ?? null;
	return (
		<>
			{pick === null || context === null ? (
				<UserIcon aria-hidden className="size-3.5" />
			) : (
				<AgentMark
					agent={pick.agent}
					name={context.dispatch.agentName(pick.agent)}
					className="size-3.5"
				/>
			)}
			<span
				data-testid="assignee"
				className={cn(
					"min-w-0 truncate transition-opacity",
					changing && "opacity-50",
				)}
			>
				{pick === null || context === null ? (
					"Any agent will pick this up"
				) : (
					<>
						<span className="text-foreground">
							{context.dispatch.pickName(pick)}
						</span>{" "}
						will work this
					</>
				)}
			</span>
		</>
	);
}
