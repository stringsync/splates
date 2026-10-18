import { age } from "@stringsync/splates-server/age";
import {
	answersTo,
	type Needing,
	quietSince,
} from "@stringsync/splates-server/plans/browser";
import { type JSX, useContext } from "react";
import { cn } from "#web/lib/utils.ts";
import { AgentIcon } from "./agent-icons";
import {
	lastReport,
	leadsLanes,
	unnamed,
	useNameOf,
} from "./conversation-names";
import { Trunk } from "./dispatching";
import { Held } from "./handed-out";
import { Mark } from "./mark";
import { Filed, type useLongPress } from "./phone-row-menu";
import { Refusal } from "./refusal";
import { useRowRefusal } from "./row-refusal";
import { LaneIcon, TaskIcon } from "./task-icon";
import { unanswered } from "./unanswered";

/**
 * One agent: its mark, its name, what it waits on, and how long since it
 * moved. One handed out sits indented under the agent it answers to, smaller
 * and muted.
 * Held down, a conversation's row opens its menu.
 */
export function Row({
	row,
	depth,
	agent,
	hosting,
	project,
	foreign,
	onOpen,
}: {
	row: Needing;
	/** How many agents it is handed out under; 0 for one you talk to. */
	depth: number;
	/** The agent's name; null for an external one. */
	agent: string | null;
	/** Whether an agent it handed a task to is at work. */
	hosting: boolean;
	/** The project to name after it, as Needs you does; null to name none. */
	project: string | null;
	/** Whether it is another project's, which this page holds no menu for. */
	foreign: boolean;
	onOpen: () => void;
}): JSX.Element {
	const nameOf = useNameOf();
	const trunk = useContext(Trunk);
	const { conversation, task, need } = row;
	// One that answers to another is not yours to address.
	const subagent = answersTo(row, useContext(Held)) !== null;
	const reported =
		conversation === null ? null : (lastReport(conversation)?.ending ?? null);
	const name =
		conversation !== null ? nameOf(conversation) : (task?.task ?? "");
	const { text, urgent } = statusOf(row, name, trunk);
	const moved = movedAt(row);
	const { refusal, refuse } = useRowRefusal(
		conversation?.id ?? `task ${task?.task}`,
	);
	const button = (press: Partial<ReturnType<typeof useLongPress>>) => (
		<button
			type="button"
			onClick={onOpen}
			{...press}
			className={cn(
				// No callout or selection to fight the long press.
				"flex w-full select-none items-center gap-3 py-2.5 pr-4 text-left [-webkit-touch-callout:none] active:bg-muted",
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
					<TaskIcon
						className={cn(
							"text-foreground/80",
							depth === 0 ? "size-5" : "size-4",
						)}
					/>
				)}
			</span>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="flex items-baseline gap-2">
					{conversation !== null && leadsLanes(conversation) && (
						<LaneIcon
							aria-label="Lane"
							className="size-3.5 shrink-0 self-center text-muted-foreground"
						/>
					)}
					<span
						className={cn(
							"min-w-0 flex-1 truncate font-medium text-[15px]",
							(subagent || (conversation !== null && unnamed(conversation))) &&
								"text-muted-foreground italic",
						)}
					>
						{name}
					</span>
					{project !== null && (
						<span className="max-w-[40%] shrink-0 truncate text-muted-foreground text-xs">
							{project}
						</span>
					)}
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
					{/* A quiet external agent's status says so, rather than a spinner. */}
					{(conversation !== null || quietSince(row, Date.now()) === null) && (
						<Mark
							need={need}
							reported={reported}
							unread={conversation?.unread ?? false}
							hosting={hosting}
							subagent={subagent}
						/>
					)}
				</span>
			</span>
		</button>
	);
	return (
		<>
			{conversation !== null && !foreign ? (
				<Filed conversation={conversation} refuse={refuse} nested={depth > 0}>
					{button}
				</Filed>
			) : (
				button({})
			)}
			<Refusal refusal={refusal} className="px-4 pb-1.5" />
		</>
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
						: need.why === "abandoned"
							? "Abandoned"
							: open > 0
								? `${open} ${open === 1 ? "question" : "questions"}`
								: "Escalated";
		// Named, when it waits for an agent this one handed out.
		const subject =
			need.via === undefined ? need.subject : `${need.via}: ${need.subject}`;
		return { text: `${label} · ${subject}`, urgent: true };
	}
	// An external agent with no sign of it at work for a while may be gone.
	const quiet = quietSince({ task, need }, Date.now());
	if (conversation === null && quiet !== null) {
		return { text: `No sign since ${age(quiet)}`, urgent: false };
	}
	if (need.kind === "assuming") {
		const subject =
			need.via === undefined ? need.subject : `${need.via}: ${need.subject}`;
		return { text: `Working · ${subject}`, urgent: false };
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
			working: "lanes" in report ? "Lanes working" : "Working",
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
		last?.until ??
		last?.at ??
		conversation?.createdAt ??
		task?.activeAt ??
		task?.createdAt;
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
