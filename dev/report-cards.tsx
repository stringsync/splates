import { makeAssistantDataUI } from "@assistant-ui/react";
import {
	ArchiveIcon,
	CheckIcon,
	CodeIcon,
	CopyIcon,
	GitBranchIcon,
	HourglassIcon,
	ListTodoIcon,
	MessageSquarePlusIcon,
	PaperclipIcon,
	PlayIcon,
} from "lucide-react";
import { createContext, type JSX, useContext, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { Proposal, Report } from "../asked";
import { todoReference } from "../prompts";
import { Board } from "./board";
import { Badge, copiedLabel, useCopy } from "./card";
import { CardBody, CardShell, ENDINGS, reportText } from "./card-shell";
import { Markdown } from "./markdown";
import { InMessage, useCardReply } from "./question-cards";
import { Refusal, useRefusal } from "./refusal";

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
	archive: () => Promise<void>;
} | null>(null);

export function ReportCard({ report }: { report: Report }): JSX.Element {
	const conversation = useContext(ArchiveContext);
	const { title, Icon, tone } = ENDINGS[report.ending];
	// An escalated task still waits on the person; only one that is over offers
	// to put its conversation away.
	const over = report.ending !== "escalated";
	const text = reportText(report);
	// Shows the markdown the agent wrote in place of the card's body, until
	// toggled back; never kept, so the card opens rendered.
	const [showing, setShowing] = useState(false);
	return (
		<CardShell
			label={`${report.ending} ${report.task}`}
			Icon={Icon}
			title={title}
			tone={tone}
			task={report.task}
			base={report.base}
			aside={
				<span className="flex items-center gap-2">
					<Button
						size="icon-xs"
						variant="ghost"
						aria-label="Show source"
						aria-pressed={showing}
						title={showing ? "Hide source" : "Show source"}
						onClick={() => setShowing(!showing)}
						className={cn(showing && "bg-accent text-accent-foreground")}
					>
						<CodeIcon />
					</Button>
					{conversation !== null && over && <Archive {...conversation} />}
				</span>
			}
		>
			{showing ? (
				<Source text={report.source} />
			) : text === "" ? undefined : (
				<CardBody text={text} lead={report.reason !== null} />
			)}
		</CardShell>
	);
}

/** A report's markdown as the agent wrote it, to read or copy. */
function Source({ text }: { text: string }): JSX.Element {
	const { copied, copy } = useCopy();
	return (
		<div className="relative">
			<pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words px-4 py-3.5 pr-24 font-mono text-[12px] leading-relaxed">
				{text}
			</pre>
			<Button
				size="sm"
				variant="outline"
				title={copied.state === "failed" ? copied.error : undefined}
				onClick={() => copy(text)}
				className="absolute top-2.5 right-2.5 h-7 gap-1.5 bg-background"
			>
				{copied.state === "copied" ? (
					<CheckIcon data-icon="inline-start" />
				) : (
					<CopyIcon data-icon="inline-start" />
				)}
				<span aria-live="polite">{copiedLabel(copied, "Copy")}</span>
			</Button>
		</div>
	);
}

function Archive({
	archived,
	archive,
}: {
	archived: boolean;
	archive: () => Promise<void>;
}): JSX.Element {
	const { refusal, attempt } = useRefusal();
	return archived ? (
		<span className="flex h-7 items-center gap-1 text-muted-foreground text-xs">
			<CheckIcon className="size-3.5" strokeWidth={3} />
			Archived
		</span>
	) : (
		<span className="flex items-center gap-2">
			<Refusal refusal={refusal} />
			<Button
				size="sm"
				variant="outline"
				onClick={() => void attempt(archive(), "Not archived")}
				className="h-7 gap-1.5 bg-background"
			>
				<ArchiveIcon data-icon="inline-start" />
				Archive
			</Button>
		</span>
	);
}

/**
 * Opens the new conversation screen with `text` typed in, to start it there;
 * none outside a conversation.
 */
export const StartNewContext = createContext<((text: string) => void) | null>(
	null,
);

/**
 * Renders a `data-todo` part as the todo it proposes. Until the person
 * replies it is read live as the board has it: a proposal another task has
 * since taken says so, and one merged or removed says it is gone. Start sends
 * the todo's reference at once, as the reply asking the agent to take it;
 * beside it, the reference is typed into a new conversation instead. Once replied to, it keeps the todo as proposed, and whether it was started.
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
	const board = useContext(Board);
	const { reply, sent } = useCardReply();
	const reference = todoReference(proposal.id);
	const settled = sent !== null;
	const started = sent?.includes(reference) ?? false;
	const live = board.todos.find((each) => each.id === proposal.id) ?? null;
	const todo = settled ? null : live;
	const gone = !settled && board.linked && todo === null;
	const lane =
		todo?.lane == null
			? null
			: (board.lanes.find((each) => each.id === todo.lane) ?? null);
	const send = reply?.send ?? null;
	const { refusal, attempt } = useRefusal();
	const startNew = useContext(StartNewContext);
	const open = todo !== null && todo.takenBy === null;
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
				{live === null ? (
					<p className="font-medium text-sm">{proposal.subject}</p>
				) : (
					// Opens it while it is on the list, replied to or not.
					<button
						type="button"
						onClick={() => board.open(proposal.id)}
						className="cursor-pointer self-start rounded text-left font-medium text-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
					>
						{todo?.subject ?? proposal.subject}
					</button>
				)}
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
					{gone && (
						<span
							title="No longer on the list: merged or removed"
							className="flex items-center gap-1"
						>
							<ArchiveIcon aria-hidden className="size-3" />
							archived
						</span>
					)}
				</span>
				<Refusal refusal={refusal} />
			</div>
			{started && (
				<span className="flex shrink-0 items-center gap-1 py-1 text-success text-xs">
					<CheckIcon className="size-3.5" strokeWidth={3} />
					Started
				</span>
			)}
			{open && (send !== null || startNew !== null) && (
				<span className="flex shrink-0 items-center gap-1">
					{send !== null && (
						<Button
							size="sm"
							variant="outline"
							onClick={() => void attempt(send(reference), "Not started")}
							className="gap-1.5"
						>
							<PlayIcon data-icon="inline-start" />
							Start
						</Button>
					)}
					{startNew !== null && (
						<Button
							size="icon-sm"
							variant="outline"
							aria-label="Start in a new conversation"
							title="Start in a new conversation"
							onClick={() => startNew(reference)}
						>
							<MessageSquarePlusIcon />
						</Button>
					)}
				</span>
			)}
		</section>
	);
}
