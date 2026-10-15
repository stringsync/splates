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
import { laneReference } from "../prompts";
import type { AgentPick } from "../roster";
import { AgentIcon } from "./agent-icons";
import { Board, still, touchArea, touchItems } from "./board";
import { promptConversation, startConversation } from "./conversation-api";
import { reportedAs, useNameOf } from "./conversation-names";
import type { Dispatch } from "./dispatch";
import { Mark } from "./mark";
import type { BarAction } from "./top-bar";

/**
 * The main tree's branch, which names it where a conversation's place is
 * shown, as its header does; null until the page has read it.
 */
export const Trunk = createContext<string | null>(null);

/** Where `task` runs: its name, or the trunk's branch for the main tree. */
export function whereRuns(task: string | null, trunk: string | null): string {
	return task ?? trunk ?? "main tree";
}

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
 * room for it. As `marks` they only show, for inside a button of their own,
 * and only as how each stands, not whose agent it is.
 * `spinning` keeps only those whose agent is at work, or with false, the rest.
 */
export function OnIt({
	task,
	variant = "chips",
	spinning,
	className,
}: {
	task: string;
	variant?: "marks" | "chips" | "rows";
	spinning?: boolean;
	className?: string;
}): JSX.Element | null {
	const context = useContext(Dispatching);
	const nameOf = useNameOf();
	const rows = (context?.dispatch.on(task) ?? []).filter(
		({ need }) => spinning === undefined || spins(need) === spinning,
	);
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
				// Only rows, with room for the name, show whose agent it is.
				const icon = variant === "rows" && (
					<AgentIcon
						agent={conversation.agent}
						name={dispatch.agentName(conversation.agent)}
						className="size-3.5 text-foreground/70"
					/>
				);
				const mark = <Mark need={need} reported={reportedAs(conversation)} />;
				if (variant === "marks") {
					return (
						<span key={conversation.id} className="inline-flex items-center">
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
							variant === "rows"
								? "gap-2 px-2 py-1 pointer-coarse:min-h-10 text-sm"
								: touchArea,
						)}
					>
						{icon}
						{variant === "rows" && (
							<span className="min-w-0 flex-1 truncate text-left text-foreground">
								{name}
							</span>
						)}
						{stopped ? (
							<span className="flex shrink-0 items-center gap-0.5 whitespace-nowrap text-xs">
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

/** Whether a conversation shows as a spinner: its agent is at work. */
function spins(need: { kind: string }): boolean {
	return need.kind === "working" || need.kind === "assuming";
}

/**
 * Puts one orchestrator on several lanes at once, from the board's bar: the
 * lanes ticked among those with a todo next and no agent, and Untriaged while
 * it holds an open todo, in a new conversation with the agent picked, sent
 * `[ARBOR LANE <n>]` for each straight away, since the prompt says only that.
 * Each lane that does not start says so on its header. An action of the
 * board's bar, or null while no lane is idle.
 */
export function useStartLanes({
	lanes,
	untriaged,
}: {
	lanes: LaneState[];
	/** Whether a todo in no lane is open, for an orchestrator to place. */
	untriaged: boolean;
}): BarAction | null {
	const context = useContext(Dispatching);
	const { refuseLane } = useContext(Board);
	const [picked, setPicked] = useState<(number | null)[]>([]);
	const idle: { id: number | null; name: string; ready: boolean }[] = [
		...(untriaged ? [{ id: null, name: "Untriaged", ready: true }] : []),
		...lanes.filter((lane) => lane.agents.length === 0 && lane.next !== null),
	];
	if (context === null || idle.length === 0) {
		return null;
	}
	const { dispatch } = context;
	const chosen = idle.filter((lane) => picked.includes(lane.id));
	const start = (agent: string): void => {
		setPicked([]);
		void startConversation(agent, null)
			.then(({ id }) =>
				promptConversation(
					id,
					chosen.map((lane) => laneReference(lane.id)).join("\n"),
				),
			)
			.catch((error: unknown) => {
				for (const lane of chosen) {
					refuseLane(lane.id, "Not started", error);
				}
			});
	};
	return {
		label: "Start lanes",
		icon: <PlayIcon />,
		menuClassName: cn("w-64", touchItems),
		menu: (
			<>
				<DropdownMenuGroup>
					<DropdownMenuLabel>Lanes with no agent</DropdownMenuLabel>
					{idle.map((lane) => (
						<DropdownMenuCheckboxItem
							key={lane.id ?? "untriaged"}
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
							{!lane.ready && (
								<span className="text-muted-foreground text-xs">waits</span>
							)}
						</DropdownMenuCheckboxItem>
					))}
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuLabel>
						{chosen.length === 0
							? "Tick the lanes to start"
							: `Start ${chosen.length === 1 ? "1 lane" : `${chosen.length} lanes`} with`}
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
				</DropdownMenuGroup>
			</>
		),
	};
}

/**
 * The items that say which agent, and model, should work a todo:
 * any agent, or one on the roster, on its own model or one it lists. For a
 * menu of its own or a submenu of another.
 */
export function AssigneeItems({
	assignee,
	onPick,
	label,
	anyone = true,
}: {
	assignee: AgentPick | null;
	onPick: (pick: AgentPick | null) => void;
	/** What the items are for, above them. */
	label?: string;
	/** Whether "Any agent" is among them, for a todo that can wait for one. */
	anyone?: boolean;
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
			{anyone && (
				<DropdownMenuCheckboxItem
					checked={is(null)}
					onCheckedChange={() => onPick(null)}
				>
					Any agent
				</DropdownMenuCheckboxItem>
			)}
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
						<DropdownMenuSubContent className={cn("w-48", touchItems)}>
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
						className={cn(
							"w-fit gap-1 text-muted-foreground pointer-coarse:h-10 pointer-coarse:px-3",
							className,
						)}
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
			<DropdownMenuContent align="start" className={cn("w-52", touchItems)}>
				<AssigneeItems assignee={assignee} onPick={onPick} label="Assign to" />
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
