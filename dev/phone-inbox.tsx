import { useReactive } from "@webappwiz/react";
import { GitBranchIcon, MenuIcon, SquarePenIcon } from "lucide-react";
import { type JSX, type ReactNode, useContext } from "react";
import { cn } from "#dev/lib/utils.ts";
import type { Needing } from "../needs";
import type { Details } from "../show";
import { AgentIcon } from "./agent-icons";
import { NEW } from "./conversation-address";
import {
	type AgentChoice,
	agentName,
	type ConversationFeed,
} from "./conversation-feed";
import { lastReport, unnamed, useNameOf } from "./conversation-names";
import {
	flatten,
	isHostOf,
	openedBy,
	rowsOf,
	waitsOnYou,
} from "./conversation-rows";
import { Trunk } from "./dispatching";
import type { Drafts } from "./drafts";
import { Mark } from "./mark";
import { type Nested, nest } from "./parts";
import { launch } from "./phone-home";
import { arriveAt, useCopiedReplies } from "./task-view";
import { unanswered } from "./unanswered";

/**
 * The phone's home: every agent, sorted by what it asks of you. Those waiting
 * on you come first, then those at work, then the rest, newest first in each,
 * each row a finger's height saying what it waits on. The agents one handed
 * out, its subagents and parts, sit under it, in its group, since they answer
 * to it rather than to you. A tap on one waiting goes straight to what it
 * asks. The menu opens the drawer, and the pen, like
 * the composer along the bottom, starts a new conversation.
 */
export function Inbox({
	feed,
	drafts,
	tasks,
	name,
	status,
	onMenu,
	onOpen,
}: {
	feed: ConversationFeed;
	/** Where a reply copied for an external agent is kept. */
	drafts: Drafts;
	tasks: Details[];
	/** The project's name. */
	name: string;
	/** Whether the server is offline or outdated, said beside the name. */
	status: ReactNode;
	onMenu: () => void;
	onOpen: (id: string) => void;
}): JSX.Element {
	const { agents, conversations } = useReactive(
		feed,
		(feed) => ({ agents: feed.agents, conversations: feed.conversations }),
		["changed"],
	);
	useCopiedReplies(drafts);
	const rows = rowsOf(tasks, conversations);
	// Each with the agents it handed out, in the group of the most pressing.
	const trees = nest(rows, (host, part) => isHostOf(tasks, host, part));
	const waiting = trees.filter((tree) =>
		flatten([tree]).some((row) => waitsOnYou(row, drafts)),
	);
	const working = trees.filter(
		(tree) =>
			!waiting.includes(tree) &&
			flatten([tree]).some(
				(row) => row.need.kind === "working" || row.need.kind === "assuming",
			),
	);
	const rest = trees.filter(
		(tree) => !waiting.includes(tree) && !working.includes(tree),
	);
	const open = (row: Needing) => {
		if (waitsOnYou(row, drafts)) {
			arriveAt(openedBy(row));
		}
		onOpen(openedBy(row));
	};
	const agent = agents.find((each) => each.id === "claude") ?? agents[0];
	return (
		<section
			aria-label="inbox"
			className="flex min-h-dvh flex-col bg-background"
		>
			<header className="sticky top-0 z-10 flex h-14 items-center gap-1 border-b bg-background/95 px-2 pt-[env(safe-area-inset-top)] backdrop-blur">
				<IconButton label="Open menu" onClick={onMenu}>
					<MenuIcon />
				</IconButton>
				<h1 className="flex min-w-0 flex-1 items-center gap-2 font-semibold text-base">
					<span className="truncate">{name}</span>
					{status}
				</h1>
				<IconButton label="New conversation" onClick={() => onOpen(NEW)}>
					<SquarePenIcon />
				</IconButton>
			</header>
			<div className="flex flex-1 flex-col pb-28">
				{rows.length === 0 ? (
					<p className="px-6 py-16 text-center text-muted-foreground">
						No conversations yet. Start one below.
					</p>
				) : (
					<>
						<Group
							title="Needs you"
							trees={waiting}
							agents={agents}
							urgent
							onOpen={open}
						/>
						<Group
							title="Working"
							trees={working}
							agents={agents}
							onOpen={open}
						/>
						<Group title="Recent" trees={rest} agents={agents} onOpen={open} />
					</>
				)}
			</div>
			{/* Where a thumb is, as the chat apps keep their composer. */}
			<div className="fixed inset-x-0 bottom-0 z-10 bg-gradient-to-t from-background via-background to-transparent px-4 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
				{/* A field rather than a button, so a tap raises the keyboard,
				    which the new conversation's composer takes over. */}
				<label className="flex h-12 w-full items-center gap-3 rounded-full border bg-card px-4 text-muted-foreground shadow-sm">
					{agent !== undefined && (
						<AgentIcon
							agent={agent.id}
							name={agent.name}
							className="size-4 shrink-0 text-foreground/70"
						/>
					)}
					<input
						aria-label="Start a conversation"
						placeholder={`Ask ${agent?.name ?? "an agent"} to work on something`}
						onFocus={() => {
							launch();
							onOpen(NEW);
						}}
						className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
					/>
				</label>
			</div>
		</section>
	);
}

/**
 * A heading and its rows, each agent's subagents under it, or nothing when it
 * has none. The count is of the agents at the top.
 */
function Group({
	title,
	trees,
	agents,
	urgent = false,
	onOpen,
}: {
	agents: AgentChoice[];
	title: string;
	trees: Nested<Needing>[];
	urgent?: boolean;
	onOpen: (row: Needing) => void;
}): ReactNode {
	if (trees.length === 0) {
		return null;
	}
	const lines = (
		trees: Nested<Needing>[],
		depth: number,
	): { row: Needing; depth: number }[] =>
		trees.flatMap(({ row, parts }) => [
			{ row, depth },
			...lines(parts, depth + 1),
		]);
	return (
		<section aria-label={title} className="pt-4">
			<h2
				className={cn(
					"px-4 pb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide",
					urgent && "text-warning",
				)}
			>
				{title} · {trees.length}
			</h2>
			<ul>
				{lines(trees, 0).map(({ row, depth }) => (
					<li key={openedBy(row)}>
						<Row
							row={row}
							depth={depth}
							agent={
								row.conversation === null
									? null
									: agentName(agents, row.conversation.agent)
							}
							onOpen={() => onOpen(row)}
						/>
					</li>
				))}
			</ul>
		</section>
	);
}

/**
 * One agent: its mark, its name, what it waits on, and how long since it
 * moved. One handed out sits indented under the agent it answers to, smaller.
 */
function Row({
	row,
	depth,
	agent,
	onOpen,
}: {
	row: Needing;
	/** How many agents it is handed out under; 0 for one you talk to. */
	depth: number;
	/** The agent's name; null for an external one. */
	agent: string | null;
	onOpen: () => void;
}): JSX.Element {
	const nameOf = useNameOf();
	const trunk = useContext(Trunk);
	const { conversation, task, need } = row;
	const reported =
		conversation === null ? null : (lastReport(conversation)?.ending ?? null);
	const name =
		conversation !== null ? nameOf(conversation) : (task?.task ?? "");
	const { text, urgent } = statusOf(row, name, trunk);
	const moved = movedAt(row);
	return (
		<button
			type="button"
			onClick={onOpen}
			className={cn(
				"flex w-full items-center gap-3 py-2.5 pr-4 text-left active:bg-muted",
				depth === 0 ? "min-h-16" : "min-h-14",
			)}
			// Under the name of the agent it answers to.
			style={{ paddingLeft: `${1 + 3.25 * depth}rem` }}
		>
			<span
				className={cn(
					"flex shrink-0 items-center justify-center rounded-full bg-muted",
					depth === 0 ? "size-10" : "size-8",
				)}
			>
				{conversation !== null && agent !== null ? (
					<AgentIcon
						agent={conversation.agent}
						name={agent}
						className={cn(
							"text-foreground/80",
							depth === 0 ? "size-5" : "size-4",
						)}
					/>
				) : (
					<GitBranchIcon
						className={cn(
							"text-foreground/80",
							depth === 0 ? "size-5" : "size-4",
						)}
					/>
				)}
			</span>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="flex items-baseline gap-2">
					<span
						className={cn(
							"min-w-0 flex-1 truncate font-medium text-[15px]",
							conversation !== null &&
								unnamed(conversation) &&
								"text-muted-foreground italic",
						)}
					>
						{conversation !== null ? nameOf(conversation) : (task?.task ?? "")}
					</span>
					{moved !== null && (
						<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
							{moved}
						</span>
					)}
				</span>
				<span className="flex items-center gap-2">
					<span
						className={cn(
							"min-w-0 flex-1 truncate text-sm",
							urgent ? "text-warning" : "text-muted-foreground",
						)}
					>
						{text}
					</span>
					<Mark
						need={need}
						reported={reported}
						unread={conversation?.unread ?? false}
					/>
				</span>
			</span>
		</button>
	);
}

/** What a row says under its name: what it waits on, does, or last did. */
export function statusOf(
	{ conversation, task, need }: Needing,
	name: string,
	trunk: string | null,
): { text: string; urgent: boolean } {
	if (need.kind === "waiting") {
		const open =
			need.why === "questions"
				? unanswered(need.questions, conversation?.messages ?? []).length
				: need.questions.length;
		const label =
			need.why === "ask"
				? "Asks to go on"
				: need.why === "review"
					? "Ready to merge"
					: need.why === "failed"
						? "Failed"
						: open > 0
							? `${open} ${open === 1 ? "question" : "questions"}`
							: "Escalated";
		// Named, when it waits for an agent this one handed out.
		const subject =
			need.via === undefined ? need.subject : `${need.via}: ${need.subject}`;
		return { text: `${label} · ${subject}`, urgent: true };
	}
	if (need.kind === "assuming") {
		return { text: `Working · ${need.subject}`, urgent: false };
	}
	if (need.kind === "working") {
		return { text: need.subject ?? "Working", urgent: false };
	}
	const report = conversation === null ? null : lastReport(conversation);
	if (report !== null) {
		const how = {
			merged: `Merged onto ${("base" in report ? report.base : null) ?? "main"}`,
			removed: "Removed",
			escalated: "Escalated",
			finished: "Lanes finished",
			waiting: "Lanes waiting",
			working: "Lanes working",
			handed: `Handed off to ${("to" in report ? report.to : null) ?? "another agent"}`,
		}[report.ending];
		return {
			text: report.reason === null ? how : `${how} · ${report.reason}`,
			urgent: false,
		};
	}
	// An external agent whose escalation is answered through another's row.
	if (conversation === null && task?.escalation != null) {
		return { text: `Escalated · ${task.escalation}`, urgent: false };
	}
	if (conversation?.unread === true) {
		return { text: "New reply", urgent: false };
	}
	// What the agent called it, under the task it goes by.
	if (conversation?.title != null && conversation.title !== name) {
		return { text: conversation.title, urgent: false };
	}
	return {
		text: conversation?.task ?? task?.task ?? trunk ?? "main",
		urgent: false,
	};
}

/** How long since a row's conversation last moved, shortly: "5m", "3h", "2d". */
function movedAt({ conversation, task }: Needing): string | null {
	const last = conversation?.messages.at(-1);
	const at =
		last?.until ?? last?.at ?? conversation?.createdAt ?? task?.createdAt;
	if (at == null) {
		return null;
	}
	const minutes = Math.floor((Date.now() - Date.parse(at)) / 60_000);
	if (Number.isNaN(minutes)) {
		return null;
	}
	if (minutes < 1) {
		return "now";
	}
	if (minutes < 60) {
		return `${minutes}m`;
	}
	const hours = Math.floor(minutes / 60);
	return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/** A header's icon button, as big as a fingertip. */
export function IconButton({
	label,
	onClick,
	children,
}: {
	label: string;
	onClick: () => void;
	children: ReactNode;
}): JSX.Element {
	return (
		<button
			type="button"
			aria-label={label}
			onClick={onClick}
			className="flex size-11 shrink-0 items-center justify-center rounded-full text-foreground active:bg-muted [&_svg]:size-5"
		>
			{children}
		</button>
	);
}
