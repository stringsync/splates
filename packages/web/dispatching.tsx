import type { ConversationState } from "@stringsync/splates-server/conversations";
import type { AgentPick } from "@stringsync/splates-server/models";
import { thinkingOf } from "@stringsync/splates-server/models/browser";
import type { Details } from "@stringsync/splates-server/tasks";
import { useReactive } from "@webappwiz/react";
import { CheckIcon, ChevronDownIcon, PlayIcon, UserIcon } from "lucide-react";
import {
	createContext,
	type JSX,
	type ReactNode,
	useContext,
	useMemo,
} from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";
import { cn } from "#web/lib/utils.ts";
import { AgentMark } from "./agent-icons";
import { still, touchArea, touchItems } from "./board";
import type { AgentChoice, ConversationFeed } from "./conversation-feed";
import { useConversationIndex } from "./conversation-index";
import { reportedAs, useNameOf } from "./conversation-names";
import { Dispatch } from "./dispatch";
import type { Drafts } from "./drafts";
import { Mark } from "./mark";
import { QueueMark } from "./slot-queue";

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
 * What `Dispatching` holds for the page, from what it shows; null until
 * its conversations are `available`. `open` opens `#conversations/<address>`.
 */
export function useDispatching({
	available,
	drafts,
	talk,
	agents,
	conversations,
	tasks,
	open,
}: {
	available: boolean;
	drafts: Drafts;
	talk: ConversationFeed;
	agents: AgentChoice[];
	conversations: ConversationState[];
	tasks: Details[];
	open: (address: string) => void;
}): { dispatch: Dispatch; open: (address: string) => void } | null {
	return useMemo(
		() =>
			available
				? {
						dispatch: new Dispatch(
							drafts,
							talk,
							new URLSearchParams(location.search).get("project"),
							agents,
							conversations,
							tasks,
						),
						open,
					}
				: null,
		[available, drafts, talk, agents, conversations, tasks, open],
	);
}

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
	queued,
	variant = "chips",
	spinning,
	className,
}: {
	task: string | null;
	/** A queued task's number, for the conversation the queue holds for it, over `task`. */
	queued?: number;
	variant?: "marks" | "chips" | "rows";
	spinning?: boolean;
	className?: string;
}): JSX.Element | null {
	const context = useContext(Dispatching);
	const nameOf = useNameOf();
	const found =
		context === null
			? []
			: queued !== undefined
				? context.dispatch.heldFor(queued)
				: task === null
					? []
					: context.dispatch.on(task);
	const rows = found.filter(
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
					<AgentMark
						agent={conversation.agent}
						name={dispatch.agentName(conversation.agent)}
						className="size-3.5 text-foreground/70"
					/>
				);
				const mark =
					conversation.queue === null ? (
						<Mark need={need} reported={reportedAs(conversation)} />
					) : (
						<QueueMark spot={conversation.queue} />
					);
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
 * The items that say which agent, and model, should work a todo:
 * any agent, or one on the roster, on its own model or one it lists.
 */
function AssigneeItems({
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
			: assignee?.agent === pick.agent &&
				assignee.model === pick.model &&
				assignee.effort === pick.effort;
	// A pick of the agent already assigned keeps its thinking level.
	const kept = (agent: string) =>
		assignee?.agent === agent && assignee.effort !== undefined
			? { effort: assignee.effort }
			: {};
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
						<AgentMark agent={each.id} name={each.name} />
						{each.name}
					</DropdownMenuCheckboxItem>
				) : (
					<DropdownMenuSub key={each.id}>
						<DropdownMenuSubTrigger>
							<AgentMark agent={each.id} name={each.name} />
							<span className="flex-1">{each.name}</span>
							{assignee?.agent === each.id && (
								<CheckIcon className="size-3.5" />
							)}
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent className={cn("w-48", touchItems)}>
							<DropdownMenuCheckboxItem
								checked={is({ agent: each.id, ...kept(each.id) })}
								onCheckedChange={() =>
									onPick({ agent: each.id, ...kept(each.id) })
								}
							>
								Its own model
							</DropdownMenuCheckboxItem>
							{(each.models ?? []).map((model) => (
								<DropdownMenuCheckboxItem
									key={model.id}
									checked={is({
										agent: each.id,
										model: model.id,
										...kept(each.id),
									})}
									onCheckedChange={() =>
										onPick({
											agent: each.id,
											model: model.id,
											...kept(each.id),
										})
									}
								>
									{model.name}
								</DropdownMenuCheckboxItem>
							))}
							{thinkingOf(each.settings).length > 0 && (
								<>
									<DropdownMenuSeparator />
									<DropdownMenuLabel>Thinking</DropdownMenuLabel>
									{thinkingOf(each.settings).map((level) => {
										const on =
											assignee?.agent === each.id &&
											assignee.effort === level.value;
										return (
											<DropdownMenuCheckboxItem
												key={level.value}
												checked={on}
												onCheckedChange={() => {
													const same = assignee?.agent === each.id;
													onPick({
														agent: each.id,
														...(same && assignee.model !== undefined
															? { model: assignee.model }
															: {}),
														...(on ? {} : { effort: level.value }),
													});
												}}
											>
												{level.name}
											</DropdownMenuCheckboxItem>
										);
									})}
								</>
							)}
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
					<AgentMark
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

/** Provides the board and task controls with live conversation assignments. */
export function DispatchingProvider({
	feed,
	drafts,
	tasks,
	open,
	children,
}: {
	feed: ConversationFeed;
	drafts: Drafts;
	tasks: Details[];
	open: (address: string) => void;
	children: ReactNode;
}): JSX.Element {
	const conversations = useConversationIndex(feed);
	const { available, agents } = useReactive(
		feed,
		(feed) => ({
			available: feed.available,
			agents: feed.agents,
		}),
		["changed"],
	);
	const value = useDispatching({
		available,
		agents,
		conversations,
		talk: feed,
		drafts,
		tasks,
		open,
	});
	return <Dispatching value={value}>{children}</Dispatching>;
}
