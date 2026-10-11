import { ChevronDownIcon, PlayIcon } from "lucide-react";
import { createContext, type JSX, useContext } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "#dev/components/ui/dropdown-menu.tsx";
import { cn } from "#dev/lib/utils.ts";
import { AgentIcon } from "./agent-icons";
import { still } from "./board";
import { Mark, nameOf, reportedAs } from "./conversations";
import type { Assignment, Dispatch } from "./dispatch";

/**
 * How the board and the Tasks page put agents to work, and open the
 * conversation that does it; none while the page holds no conversations, as
 * without `--experimental`.
 */
export const Dispatching = createContext<{
	dispatch: Dispatch;
	/** Opens `#conversations/<address>`. */
	open: (address: string) => void;
} | null>(null);

/**
 * The conversations working `task`, newest first, each its agent's mark and
 * whether it needs you. As `chips` or `rows`, each opens its conversation on
 * a click, and one whose agent has stopped says Resume, since sending to it
 * starts the agent again; `rows` say each one's name too, for a dialog with
 * room for it. As `marks` they only show, for inside a button of their own.
 */
export function OnIt({
	task,
	variant = "chips",
	className,
}: {
	task: string;
	variant?: "marks" | "chips" | "rows";
	className?: string;
}): JSX.Element | null {
	const context = useContext(Dispatching);
	const rows = context?.dispatch.on(task) ?? [];
	if (context === null || rows.length === 0) {
		return null;
	}
	const { dispatch, open } = context;
	return (
		<span
			className={cn(
				"flex flex-wrap items-center gap-x-1 gap-y-0.5",
				variant === "rows" && "flex-col items-stretch",
				className,
			)}
		>
			{rows.map(({ conversation, need }) => {
				if (conversation === null) {
					return null;
				}
				const icon = (
					<AgentIcon
						agent={conversation.agent}
						name={dispatch.agentName(conversation.agent)}
						className="size-3.5 text-foreground/70"
					/>
				);
				const mark = <Mark need={need} reported={reportedAs(conversation)} />;
				if (variant === "marks") {
					return (
						<span
							key={conversation.id}
							className="inline-flex items-center gap-1"
						>
							{icon}
							{mark}
						</span>
					);
				}
				const stopped =
					conversation.status === "stopped" || conversation.status === "failed";
				const name = nameOf(conversation);
				return (
					<button
						key={conversation.id}
						type="button"
						aria-label={`${stopped ? "Resume" : "Open"} ${name}`}
						title={name}
						onClick={() => open(conversation.id)}
						{...still}
						className={cn(
							"relative inline-flex min-w-0 cursor-pointer items-center gap-1 rounded px-0.5 text-muted-foreground text-xs outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
							variant === "rows" && "gap-2 px-2 py-1 text-sm",
						)}
					>
						{icon}
						{variant === "rows" && (
							<span className="min-w-0 flex-1 truncate text-left text-foreground">
								{name}
							</span>
						)}
						{stopped ? (
							<span className="flex items-center gap-0.5 text-xs">
								<PlayIcon className="size-3" />
								Resume
							</span>
						) : (
							mark
						)}
					</button>
				);
			})}
		</span>
	);
}

/**
 * Puts an agent to work on `assignment`: a new conversation with the agent
 * picked, or one already going, its prompt composed in the composer it opens
 * at, to send once the person has looked.
 */
export function StartMenu({
	assignment,
	label = "Start",
	className,
}: {
	assignment: Assignment;
	label?: string;
	className?: string;
}): JSX.Element | null {
	const context = useContext(Dispatching);
	if (context === null) {
		return null;
	}
	const { dispatch, open } = context;
	const others = dispatch.others(assignment);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						size="xs"
						variant="outline"
						className={cn("w-fit gap-1 bg-transparent", className)}
						{...still}
					/>
				}
			>
				<PlayIcon data-icon="inline-start" />
				{label}
				<ChevronDownIcon className="text-muted-foreground" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-56">
				<DropdownMenuGroup>
					<DropdownMenuLabel>In a new conversation with</DropdownMenuLabel>
					{dispatch.agents.map((each) => (
						<DropdownMenuItem
							key={each.id}
							onClick={() => open(dispatch.start(each.id, assignment))}
						>
							<AgentIcon agent={each.id} name={each.name} />
							{each.name}
						</DropdownMenuItem>
					))}
				</DropdownMenuGroup>
				{others.length > 0 && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuSub>
							<DropdownMenuSubTrigger>In a conversation</DropdownMenuSubTrigger>
							<DropdownMenuSubContent className="max-h-80 w-64 overflow-y-auto">
								{others.map((each) => (
									<DropdownMenuItem
										key={each.id}
										onClick={() => open(dispatch.link(each.id, assignment))}
									>
										<AgentIcon
											agent={each.agent}
											name={dispatch.agentName(each.agent)}
										/>
										<span className="min-w-0 flex-1 truncate">
											{nameOf(each)}
										</span>
										{/* Where it runs, unless its name says so. */}
										{nameOf(each) !== each.task && (
											<span className="shrink-0 text-muted-foreground text-xs">
												{each.task ?? "main tree"}
											</span>
										)}
									</DropdownMenuItem>
								))}
							</DropdownMenuSubContent>
						</DropdownMenuSub>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
