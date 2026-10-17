import { ChevronDownIcon, PlayIcon } from "lucide-react";
import { type JSX, useContext, useState } from "react";
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
import type { AgentPick } from "../roster";
import { AgentIcon } from "./agent-icons";
import { still, touchArea, touchItems } from "./board";
import { useNameOf } from "./conversation-names";
import type { Assignment } from "./dispatch";
import { Dispatching, Trunk, whereRuns } from "./dispatching";

/**
 * Puts an agent to work on `assignment`: a new conversation with the agent
 * picked, or one already going, its prompt composed in the composer it opens
 * at, to send once the person has looked. With the agent it is assigned to,
 * the conversation starts straight away, the prompt sent.
 */
export function StartMenu({
	assignment,
	assignee = null,
	label = "Start",
	size = "xs",
	className,
	onStart,
}: {
	assignment: Assignment;
	/** The agent that should work it, offered first, on its model. */
	assignee?: AgentPick | null;
	label?: string;
	/** Called as a pick opens its conversation, as to close a dialog. */
	onStart?: () => void;
	/** `sm` beside a dialog's other actions in its footer. */
	size?: "xs" | "sm";
	className?: string;
}): JSX.Element | null {
	const context = useContext(Dispatching);
	if (context === null) {
		return null;
	}
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						size={size}
						variant="outline"
						className={cn(
							"w-fit gap-1 bg-transparent pointer-coarse:h-10 pointer-coarse:px-3",
							className,
						)}
						{...still}
					/>
				}
			>
				<PlayIcon data-icon="inline-start" />
				{label}
				<ChevronDownIcon className="text-muted-foreground" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className={cn("w-56", touchItems)}>
				<StartItems
					assignment={assignment}
					assignee={assignee}
					onStart={onStart}
				/>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * Starts `assignee` on `assignment` in one tap, as the first of `StartMenu`'s
 * items does: a new conversation on its model, the prompt sent, and opens it.
 * As `quiet`, a card's line of plain text naming the assignee; otherwise a
 * play button for beside the assignee's own menu, which names it, disabled
 * with none assigned. Null while the assignee's agent is not on the roster.
 */
export function StartAssigned({
	assignment,
	assignee,
	quiet = false,
	onStart,
}: {
	assignment: Assignment;
	assignee: AgentPick | null;
	quiet?: boolean;
	/** Called as it opens its conversation, as to close a dialog. */
	onStart?: () => void;
}): JSX.Element | null {
	const context = useContext(Dispatching);
	// Started once: a second tap before the conversation opens would start
	// another.
	const [starting, setStarting] = useState(false);
	if (context === null) {
		return null;
	}
	const { dispatch } = context;
	if (assignee === null) {
		return quiet ? null : (
			<Button
				size="icon-xs"
				variant="outline"
				aria-label="Start"
				title="Pick an agent to start"
				disabled
				className="bg-transparent pointer-coarse:size-10"
			>
				<PlayIcon />
			</Button>
		);
	}
	if (!dispatch.agents.some((each) => each.id === assignee.agent)) {
		return null;
	}
	const name = dispatch.pickName(assignee);
	const start = (): void => {
		setStarting(true);
		onStart?.();
		void dispatch
			.begin(assignee, assignment)
			.then(context.open)
			.finally(() => setStarting(false));
	};
	if (quiet) {
		return (
			<button
				type="button"
				aria-label={`Start with ${name}`}
				title={`Start with ${name}`}
				disabled={starting}
				onClick={start}
				{...still}
				className={cn(
					"relative -mx-1 inline-flex min-w-0 cursor-pointer items-center gap-1 rounded px-1 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50",
					touchArea,
				)}
			>
				<PlayIcon aria-hidden className="size-3 shrink-0" />
				<AgentIcon
					agent={assignee.agent}
					name={dispatch.agentName(assignee.agent)}
					className="size-3"
				/>
				<span className="truncate">{name}</span>
			</button>
		);
	}
	// The assignee's menu beside it names the agent, so the button need not.
	return (
		<Button
			size="icon-xs"
			variant="outline"
			aria-label={`Start with ${name}`}
			title={`Start with ${name}`}
			disabled={starting}
			onClick={start}
			className="bg-transparent pointer-coarse:size-10"
			{...still}
		>
			<PlayIcon />
		</Button>
	);
}

/**
 * What `StartMenu` offers, for a menu of its own or one with more in it: each
 * agent for a new conversation, then the conversations already going.
 */
export function StartItems({
	assignment,
	assignee = null,
	onStart,
}: {
	assignment: Assignment;
	assignee?: AgentPick | null;
	onStart?: () => void;
}): JSX.Element | null {
	const context = useContext(Dispatching);
	const trunk = useContext(Trunk);
	const nameOf = useNameOf();
	if (context === null) {
		return null;
	}
	const { dispatch } = context;
	const open = (address: string): void => {
		onStart?.();
		context.open(address);
	};
	const others = dispatch.others(assignment);
	const set =
		assignee !== null &&
		dispatch.agents.some((each) => each.id === assignee.agent)
			? assignee
			: null;
	return (
		<>
			<DropdownMenuGroup>
				<DropdownMenuLabel>In a new conversation with</DropdownMenuLabel>
				{set !== null && (
					<DropdownMenuItem
						onClick={() => {
							onStart?.();
							void dispatch.begin(set, assignment).then(context.open);
						}}
					>
						<AgentIcon agent={set.agent} name={dispatch.agentName(set.agent)} />
						<span className="min-w-0 flex-1 truncate">
							{dispatch.pickName(set)}
						</span>
						<span className="shrink-0 text-muted-foreground text-xs">
							assigned
						</span>
					</DropdownMenuItem>
				)}
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
						<DropdownMenuSubContent
							className={cn("max-h-80 w-64 overflow-y-auto", touchItems)}
						>
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
											{whereRuns(each.task, trunk)}
										</span>
									)}
								</DropdownMenuItem>
							))}
						</DropdownMenuSubContent>
					</DropdownMenuSub>
				</>
			)}
		</>
	);
}
