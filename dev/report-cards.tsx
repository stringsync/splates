import { makeAssistantDataUI } from "@assistant-ui/react";
import {
	ArchiveIcon,
	CheckIcon,
	CircleSlashIcon,
	GitBranchIcon,
	GitMergeIcon,
	HourglassIcon,
	ListTodoIcon,
	type LucideIcon,
	PaperclipIcon,
	PlayIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { createContext, type JSX, useContext } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { Ending, Proposal, Report } from "../asked";
import type { LaneRecord } from "../lanes";
import type { TodoState } from "../todo";
import { Badge, todoReference } from "./card";
import { CardBody, CardShell, type Tone } from "./card-shell";
import { Markdown } from "./markdown";
import { InMessage, useCardReply } from "./question-cards";

/** How each ending shows: on its report card, and beside its conversation. */
export const ENDINGS: Record<
	Ending,
	{ title: string; Icon: LucideIcon; tone: Tone }
> = {
	merged: { title: "Merged", Icon: GitMergeIcon, tone: "success" },
	removed: { title: "Removed", Icon: CircleSlashIcon, tone: "destructive" },
	escalated: {
		title: "Escalated",
		Icon: TriangleAlertIcon,
		tone: "warning",
	},
};

/**
 * Renders a `data-report` part: how a task ended, or what it waits on, as the
 * agent reported it then. It never follows the task afterwards, so a report
 * reads the same however the task has moved on since.
 */
export const ReportUI = makeAssistantDataUI<{ report: Report }>({
	name: "report",
	render: ({ data }) => <ReportCard report={data.report} />,
});

/** The open conversation, to archive; none outside one. */
export const ArchiveContext = createContext<{
	archived: boolean;
	archive: () => void;
} | null>(null);

export function ReportCard({ report }: { report: Report }): JSX.Element {
	const conversation = useContext(ArchiveContext);
	const { title, Icon, tone } = ENDINGS[report.ending];
	// An escalated task still waits on the person; only one that is over offers
	// to put its conversation away.
	const over = report.ending !== "escalated";
	// Why it went, or what it waits on, leads what it says.
	const text = [report.reason, report.body]
		.filter((each) => each !== null && each !== "")
		.join("\n\n");
	return (
		<CardShell
			label={`${report.ending} ${report.task}`}
			Icon={Icon}
			title={title}
			tone={tone}
			task={report.task}
			base={report.base}
			aside={
				conversation === null || !over ? undefined : (
					<Archive {...conversation} />
				)
			}
		>
			{text === "" ? undefined : (
				<CardBody text={text} lead={report.reason !== null} />
			)}
		</CardShell>
	);
}

function Archive({
	archived,
	archive,
}: {
	archived: boolean;
	archive: () => void;
}): JSX.Element {
	return archived ? (
		<span className="flex h-7 items-center gap-1 text-muted-foreground text-xs">
			<CheckIcon className="size-3.5" strokeWidth={3} />
			Archived
		</span>
	) : (
		<Button
			size="sm"
			variant="outline"
			onClick={archive}
			className="h-7 gap-1.5 bg-background"
		>
			<ArchiveIcon data-icon="inline-start" />
			Archive
		</Button>
	);
}

/** The todos and lanes a proposed todo is read from; none outside the page. */
export const TodosContext = createContext<{
	todos: TodoState[];
	lanes: LaneRecord[];
} | null>(null);

/**
 * Renders a `data-todo` part as the todo it proposes. Until the person
 * replies it is read live as the board has it: a proposal another task has
 * since taken says so, and one merged or removed says it is gone. Start sends
 * the todo's reference at once, as the reply asking the agent to take it.
 * Once replied to, it keeps the todo as proposed, and whether it was started.
 */
export const TodoUI = makeAssistantDataUI<{ todo: Proposal }>({
	name: "todo",
	render: ({ data }) => (
		<InMessage>
			<TodoCard proposal={data.todo} />
		</InMessage>
	),
});

export function TodoCard({ proposal }: { proposal: Proposal }): JSX.Element {
	const board = useContext(TodosContext);
	const { reply, sent } = useCardReply();
	const reference = todoReference(proposal.id);
	const settled = sent !== null;
	const started = sent?.includes(reference) ?? false;
	const todo = settled
		? null
		: (board?.todos.find((each) => each.id === proposal.id) ?? null);
	const gone = !settled && board !== null && todo === null;
	const lane =
		todo?.lane == null
			? null
			: (board?.lanes.find((each) => each.id === todo.lane) ?? null);
	const send = reply?.send ?? null;
	return (
		<section
			aria-label={`todo ${proposal.id}`}
			className={cn(
				"my-3 flex items-start gap-3 rounded-lg border border-border/60 bg-card py-2.5 pr-2.5 pl-3 text-card-foreground transition-colors hover:border-border",
				gone && "opacity-60",
			)}
		>
			<ListTodoIcon
				aria-hidden
				className="mt-0.5 size-4 shrink-0 text-muted-foreground"
			/>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<p className="font-medium text-sm">
					{todo?.subject ?? proposal.subject}
				</p>
				{proposal.body !== "" && (
					<Markdown
						text={proposal.body}
						className="text-muted-foreground text-xs leading-relaxed [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
					/>
				)}
				<span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground text-xs">
					<span className="tabular-nums">#{proposal.id}</span>
					{lane !== null && (
						<span title="lane" className="truncate">
							{lane.name}
						</span>
					)}
					{todo !== null && todo.blockedBy.length > 0 && (
						<Badge Icon={HourglassIcon} label="blocked">
							blocked by {todo.blockedBy.map((id) => `#${id}`).join(", ")}
						</Badge>
					)}
					{todo !== null && todo.files.length > 0 && (
						<Badge Icon={PaperclipIcon} label="files">
							{todo.files.length}
						</Badge>
					)}
					{todo?.takenBy != null && (
						<Badge Icon={GitBranchIcon} label="taken by">
							{todo.takenBy}
						</Badge>
					)}
					{gone && <span>gone: merged or removed</span>}
				</span>
			</div>
			{started && (
				<span className="flex shrink-0 items-center gap-1 py-1 text-success text-xs">
					<CheckIcon className="size-3.5" strokeWidth={3} />
					Started
				</span>
			)}
			{send !== null && todo !== null && todo.takenBy === null && (
				<Button
					size="sm"
					variant="outline"
					onClick={() => send(reference)}
					className="shrink-0 gap-1.5"
				>
					<PlayIcon data-icon="inline-start" />
					Start
				</Button>
			)}
		</section>
	);
}
