import { CheckIcon, ChevronDownIcon, PlayIcon, UserIcon } from "lucide-react";
import { createContext, type JSX, useContext, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
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
import type { LaneState } from "../lanes";
import type { AgentPick } from "../roster";
import { AgentIcon } from "./agent-icons";
import { promptConversation, startConversation } from "./api";
import { Board, still } from "./board";
import { laneReference } from "./card";
import { Mark, nameOf, reportedAs } from "./conversations";
import type { Assignment, Dispatch } from "./dispatch";

/**
 * How the board and the Tasks page put agents to work, and open the
 * conversation that does it; none while the page holds no conversations.
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
	assignee = null,
	label = "Start",
	className,
}: {
	assignment: Assignment;
	/** The agent that should work it, offered first, on its model. */
	assignee?: AgentPick | null;
	label?: string;
	className?: string;
}): JSX.Element | null {
	const context = useContext(Dispatching);
	if (context === null) {
		return null;
	}
	const { dispatch, open } = context;
	const others = dispatch.others(assignment);
	const set =
		assignee !== null &&
		dispatch.agents.some((each) => each.id === assignee.agent)
			? assignee
			: null;
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
					{set !== null && (
						<DropdownMenuItem
							onClick={() =>
								open(dispatch.start(set.agent, assignment, set.model))
							}
						>
							<AgentIcon
								agent={set.agent}
								name={dispatch.agentName(set.agent)}
							/>
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

/**
 * Puts an agent on each of several lanes at once, from above the board: the
 * lanes ticked among those with a todo next and no agent, each in a new
 * conversation with the agent picked, sent `[ARBOR LANE <n>]` straight away,
 * since there is one prompt per lane to review and it says only that. A lane
 * that does not start says so on its header.
 */
export function StartLanes({
	lanes,
}: {
	lanes: LaneState[];
}): JSX.Element | null {
	const context = useContext(Dispatching);
	const { refuseLane } = useContext(Board);
	const [picked, setPicked] = useState<number[]>([]);
	const idle = lanes.filter(
		(lane) => lane.agents.length === 0 && lane.next !== null,
	);
	if (context === null || idle.length === 0) {
		return null;
	}
	const { dispatch } = context;
	const chosen = idle.filter((lane) => picked.includes(lane.id));
	// A lane with an agent assigned starts with it; the one picked takes the rest.
	const start = (agent: string): void => {
		setPicked([]);
		for (const lane of chosen) {
			const pick = assigneeOf(lane) ?? { agent };
			void startConversation(pick.agent, null, {}, pick.model)
				.then(({ id }) => promptConversation(id, laneReference(lane.id)))
				.catch((error: unknown) => refuseLane(lane.id, "Not started", error));
		}
	};
	const assigneeOf = (lane: LaneState): AgentPick | null =>
		lane.assignee !== null &&
		dispatch.agents.some((each) => each.id === lane.assignee?.agent)
			? lane.assignee
			: null;
	const rest = chosen.filter((lane) => assigneeOf(lane) === null);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
				<PlayIcon data-icon="inline-start" />
				Start lanes
				<ChevronDownIcon data-icon="inline-end" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-64">
				<DropdownMenuGroup>
					<DropdownMenuLabel>Lanes with no agent</DropdownMenuLabel>
					{idle.map((lane) => (
						<DropdownMenuCheckboxItem
							key={lane.id}
							closeOnClick={false}
							checked={picked.includes(lane.id)}
							onCheckedChange={(checked) =>
								setPicked((was) =>
									checked
										? [...was, lane.id]
										: was.filter((each) => each !== lane.id),
								)
							}
						>
							<span className="min-w-0 flex-1 truncate">{lane.name}</span>
							{assigneeOf(lane) !== null && (
								<span className="shrink-0 truncate text-muted-foreground text-xs">
									{dispatch.pickName(assigneeOf(lane) as AgentPick)}
								</span>
							)}
							{!lane.ready && (
								<span className="text-muted-foreground text-xs">waits</span>
							)}
						</DropdownMenuCheckboxItem>
					))}
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					{chosen.length > 0 && rest.length === 0 ? (
						<DropdownMenuItem onClick={() => start("")}>
							<PlayIcon />
							Start {chosen.length === 1 ? "1 lane" : `${chosen.length} lanes`}{" "}
							with their agents
						</DropdownMenuItem>
					) : (
						<>
							<DropdownMenuLabel>
								{chosen.length === 0
									? "Tick the lanes to start"
									: `Start ${rest.length === 1 ? "1 lane" : `${rest.length} lanes`}${rest.length < chosen.length ? " with no agent assigned" : ""} with`}
							</DropdownMenuLabel>
							{dispatch.agents.map((each) => (
								<DropdownMenuItem
									key={each.id}
									disabled={chosen.length === 0}
									onClick={() => start(each.id)}
								>
									<AgentIcon agent={each.id} name={each.name} />
									{each.name}
								</DropdownMenuItem>
							))}
						</>
					)}
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * The items that say which agent, and model, should work a todo or a lane:
 * any agent, or one on the roster, on its own model or one it lists. For a
 * menu of its own or a submenu of another.
 */
export function AssigneeItems({
	assignee,
	onPick,
	label,
}: {
	assignee: AgentPick | null;
	onPick: (pick: AgentPick | null) => void;
	/** What the items are for, above them. */
	label?: string;
}): JSX.Element | null {
	const context = useContext(Dispatching);
	if (context === null) {
		return null;
	}
	const { dispatch } = context;
	const is = (pick: AgentPick | null) =>
		pick === null
			? assignee === null
			: assignee?.agent === pick.agent && assignee.model === pick.model;
	return (
		<DropdownMenuGroup>
			{label !== undefined && <DropdownMenuLabel>{label}</DropdownMenuLabel>}
			<DropdownMenuCheckboxItem
				checked={is(null)}
				onCheckedChange={() => onPick(null)}
			>
				Any agent
			</DropdownMenuCheckboxItem>
			{dispatch.agents.map((each) =>
				(each.models ?? []).length === 0 ? (
					<DropdownMenuCheckboxItem
						key={each.id}
						checked={is({ agent: each.id })}
						onCheckedChange={() => onPick({ agent: each.id })}
					>
						<AgentIcon agent={each.id} name={each.name} />
						{each.name}
					</DropdownMenuCheckboxItem>
				) : (
					<DropdownMenuSub key={each.id}>
						<DropdownMenuSubTrigger>
							<AgentIcon agent={each.id} name={each.name} />
							<span className="flex-1">{each.name}</span>
							{assignee?.agent === each.id && (
								<CheckIcon className="size-3.5" />
							)}
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent className="w-48">
							<DropdownMenuCheckboxItem
								checked={is({ agent: each.id })}
								onCheckedChange={() => onPick({ agent: each.id })}
							>
								Its own model
							</DropdownMenuCheckboxItem>
							{(each.models ?? []).map((model) => (
								<DropdownMenuCheckboxItem
									key={model.id}
									checked={is({ agent: each.id, model: model.id })}
									onCheckedChange={() =>
										onPick({ agent: each.id, model: model.id })
									}
								>
									{model.name}
								</DropdownMenuCheckboxItem>
							))}
						</DropdownMenuSubContent>
					</DropdownMenuSub>
				),
			)}
		</DropdownMenuGroup>
	);
}

/**
 * Which agent should work a todo, in a button saying so, its menu the
 * `AssigneeItems`; none while the page holds no conversations.
 */
export function AssigneeMenu({
	assignee,
	onPick,
	className,
}: {
	assignee: AgentPick | null;
	onPick: (pick: AgentPick | null) => void;
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
						size="xs"
						variant="ghost"
						aria-label="Assignee"
						className={cn("w-fit gap-1 text-muted-foreground", className)}
						{...still}
					/>
				}
			>
				{assignee === null ? (
					<UserIcon data-icon="inline-start" />
				) : (
					<AgentIcon
						agent={assignee.agent}
						name={context.dispatch.agentName(assignee.agent)}
					/>
				)}
				{assignee === null ? "Any agent" : context.dispatch.pickName(assignee)}
				<ChevronDownIcon />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-52">
				<AssigneeItems assignee={assignee} onPick={onPick} label="Assign to" />
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
