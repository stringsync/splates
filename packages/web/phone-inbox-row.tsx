import { answersTo, type Needing } from "@splates/server/plans/browser";
import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";
import { RowIcon } from "./agent-icons";
import { lastReport, unnamed, useNameOf } from "./conversation-names";
import { automated, shipped } from "./conversation-rows";
import { useHeldConversations } from "./handed-out";
import { Mark } from "./mark";
import { Filed, type useLongPress } from "./phone-row-menu";
import { backgrounded } from "./progress";
import { useEnding } from "./queued-ending";
import { useQuiet } from "./quiet";
import { Refusal } from "./refusal";
import { useRowRefusal } from "./row-refusal";
import { useRowStatus, useRowTags } from "./row-status";
import { TagChips } from "./tag-chips";
import { TaskIcon } from "./task-icon";

/**
 * One agent in the inbox: its mark, name, what it waits on, and how long
 * since it moved. Its action button or a long press opens its action sheet.
 */
export function Row({
	row,
	depth,
	agent,
	hosting,
	onOpen,
}: {
	row: Needing;
	/** How many agents it is handed out under; 0 for one you talk to. */
	depth: number;
	/** The agent's name; null for an external one. */
	agent: string | null;
	/** Whether an agent it handed a task to is at work. */
	hosting: boolean;
	onOpen: () => void;
}): JSX.Element {
	const nameOf = useNameOf();
	const { conversation, task, need } = row;
	// One that answers to another is not yours to address.
	const subagent = answersTo(row, useHeldConversations()) !== null;
	const { reported: ended } = useEnding(conversation);
	const reported =
		conversation === null ? null : (lastReport(conversation)?.ending ?? ended);
	const name =
		conversation !== null ? nameOf(conversation) : (task?.task ?? "");
	const quiet = useQuiet(conversation);
	const { text, label } = useRowStatus(row);
	const tags = useRowTags(row);
	const moved = movedAt(row);
	const { refusal, refuse } = useRowRefusal(
		conversation?.id ?? `task ${task?.task}`,
	);
	const button = (press: Partial<ReturnType<typeof useLongPress>>) => (
		<button
			type="button"
			onClick={onOpen}
			title={text}
			{...press}
			className={cn(
				// No callout or selection to fight the long press.
				"flex w-full min-w-0 flex-1 select-none items-center gap-3 py-2.5 pr-2 text-left [-webkit-touch-callout:none] active:bg-muted",
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
					conversation !== null && shipped(conversation) && "bg-sky-500/15",
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
				<span className="flex items-center gap-2">
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
					<Mark
						starting={conversation?.status === "starting"}
						picking={conversation?.picking}
						queued={conversation?.heldForTask != null}
						need={need}
						reported={reported}
						unread={conversation?.unread ?? false}
						hosting={hosting}
						subagent={subagent}
						quiet={quiet}
						background={conversation != null && backgrounded(conversation)}
					/>
				</span>
				<span className="flex items-center gap-2">
					<TagChips tags={tags} max={3} className="shrink-0 flex-nowrap" />
					<span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground leading-4">
						{label}
					</span>
				</span>
			</span>
		</button>
	);
	return (
		<>
			{conversation !== null ? (
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
