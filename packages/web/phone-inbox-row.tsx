import {
	answersTo,
	type Needing,
} from "@stringsync/splates-server/plans/browser";
import { type JSX, useContext } from "react";
import { cn } from "#web/lib/utils.ts";
import { RowIcon } from "./agent-icons";
import { lastReport, unnamed, useNameOf } from "./conversation-names";
import { automated } from "./conversation-rows";
import { Trunk } from "./dispatching";
import { useHeldConversations } from "./handed-out";
import { Mark } from "./mark";
import { placeInLine } from "./merge-place";
import { Filed, type useLongPress } from "./phone-row-menu";
import { type Quiet, quietText, useQuiet } from "./quiet";
import { Refusal } from "./refusal";
import { useRowRefusal } from "./row-refusal";
import { TaskIcon } from "./task-icon";
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
	/** Whether it is another project's, which this page holds no menu for. */
	foreign: boolean;
	onOpen: () => void;
}): JSX.Element {
	const nameOf = useNameOf();
	const trunk = useContext(Trunk);
	const { conversation, task, need } = row;
	// One that answers to another is not yours to address.
	const subagent = answersTo(row, useHeldConversations()) !== null;
	const reported =
		conversation === null ? null : (lastReport(conversation)?.ending ?? null);
	const name =
		conversation !== null ? nameOf(conversation) : (task?.task ?? "");
	const quiet = useQuiet(conversation);
	const { text, urgent } = statusOf(row, name, trunk, quiet);
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
					conversation !== null &&
						automated(conversation) &&
						"bg-violet-500/15",
					depth === 0 ? "size-10" : "size-8",
				)}
			>
				{conversation !== null && agent !== null ? (
					<RowIcon
						conversation={conversation}
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
					<span className="flex min-w-0 flex-1 items-center gap-1.5">
						<span
							className={cn(
								"min-w-0 truncate font-medium text-[15px]",
								(subagent ||
									(conversation !== null && unnamed(conversation))) &&
									"text-muted-foreground italic",
							)}
						>
							{name}
						</span>
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
						starting={conversation?.status === "starting"}
						picking={conversation?.picking}
						queued={conversation?.queued != null}
						need={need}
						reported={reported}
						unread={conversation?.unread ?? false}
						hosting={hosting}
						subagent={subagent}
						quiet={quiet}
						background={
							conversation?.background.some(
								(each) => each.state === "running",
							) ?? false
						}
					/>
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
	quiet: Quiet | null = null,
): { text: string; urgent: boolean } {
	if (need.kind === "working" && need.merge === "running") {
		return {
			text: `Merging onto ${task?.base ?? trunk ?? "trunk"}`,
			urgent: false,
		};
	}
	if (need.kind === "working" && need.merge === "queued") {
		// Its place in line, where the lock has told it: quiet, one phrase.
		const place =
			need.mergePlace === undefined ? "" : ` · ${placeInLine(need.mergePlace)}`;
		return { text: `Waiting to merge${place}`, urgent: false };
	}
	if (conversation?.queued != null) {
		return { text: "Queued", urgent: false };
	}
	if (conversation?.status === "starting") {
		return {
			text: conversation.picking
				? "Auto pick is choosing the agent"
				: "Waiting for agent to start",
			urgent: false,
		};
	}
	if (quiet !== null && (need.kind === "working" || need.kind === "assuming")) {
		return { text: quietText(quiet), urgent: true };
	}
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
						: need.why === "orphaned"
							? "Orphaned"
							: open > 0
								? `${open} ${open === 1 ? "question" : "questions"}`
								: "Questions";
		// Named, when it waits for an agent this one handed out.
		const subject =
			need.via === undefined ? need.subject : `${need.via}: ${need.subject}`;
		return { text: `${label} · ${subject}`, urgent: true };
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
			merged: `Merged onto ${report.base ?? "main"}`,
			done: "Done",
			removed: "Removed",
			deferred: "Deferred",
			// From before escalating was retired.
			escalated: "Escalated",
			working: "Working",
		}[report.ending];
		return {
			text: report.reason === null ? how : `${how} · ${report.reason}`,
			urgent: false,
		};
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
