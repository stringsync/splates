import { makeAssistantDataUI } from "@assistant-ui/react";
import {
	ArchiveIcon,
	ArrowRightIcon,
	CheckIcon,
	CodeIcon,
	CopyIcon,
	GitBranchIcon,
	HourglassIcon,
	ListPlusIcon,
	ListTodoIcon,
	MessageSquarePlusIcon,
	PaperclipIcon,
	PlayIcon,
	SproutIcon,
} from "lucide-react";
import { createContext, type JSX, useContext, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { Proposal, Report, Start } from "../asked";
import { todoReference } from "../prompts";
import type { TodoState } from "../todo";
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

/**
 * Renders a `data-start` part: the task the agent added, and its Goal, as it
 * said when it began, whether that ends its turn or comes along the way.
 */
export const StartUI = makeAssistantDataUI<{ start: Start }>({
	name: "start",
	render: ({ data }) => <StartCard start={data.start} />,
});

export function StartCard({ start }: { start: Start }): JSX.Element {
	return (
		<CardShell
			label={`added ${start.task}`}
			Icon={SproutIcon}
			title="Added"
			tone="info"
			task={start.task}
		>
			{start.goal === "" ? undefined : <CardBody text={start.goal} />}
		</CardShell>
	);
}

export function ReportCard({ report }: { report: Report }): JSX.Element {
	const { title, Icon, tone } = ENDINGS[report.ending];
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

/**
 * Opens the new conversation screen with `text` typed in, to start it there;
 * none outside a conversation.
 */
export const StartNewContext = createContext<((text: string) => void) | null>(
	null,
);

/**
 * The reply a todo is written in: the task it ran in, when the prompt it
 * answers was sent, and when it last moved; each null where the log cannot say.
 */
export interface Turn {
	task: string | null;
	began: string | null;
	until: string | null;
}

/**
 * Renders a `data-todo` part, a run of todos proposed one after another, as
 * the cards for them. Those the reply's own task added while it ran are
 * gathered by the lane they went to, Untriaged for none, under a line saying
 * so, for as long as the board has them; the rest stand alone, under "Next
 * up" when `next` says the run follows a task's end.
 */
export const TodoUI = makeAssistantDataUI<{
	todos: Proposal[];
	turn?: Turn;
	next?: boolean;
}>({
	name: "todo",
	render: ({ data }) => (
		<InMessage>
			<TodoRun
				proposals={data.todos}
				turn={data.turn ?? null}
				next={data.next ?? false}
			/>
		</InMessage>
	),
});

/** Whether `todo` came up in `turn`'s task while it ran. */
function addedIn(todo: TodoState, turn: Turn | null): boolean {
	if (
		turn === null ||
		turn.task === null ||
		todo.from !== turn.task ||
		turn.began === null ||
		turn.until === null
	) {
		return false;
	}
	const at = Date.parse(todo.createdAt);
	return Date.parse(turn.began) <= at && at <= Date.parse(turn.until);
}

/**
 * `proposals` in order, each next to another added to the same lane joined
 * to it: `lane` is undefined for one not added, null for one added to none.
 */
function gathered(
	proposals: Proposal[],
	todos: TodoState[],
	turn: Turn | null,
): { lane: number | null | undefined; proposals: Proposal[] }[] {
	const groups: { lane: number | null | undefined; proposals: Proposal[] }[] =
		[];
	for (const proposal of proposals) {
		const live = todos.find((each) => each.id === proposal.id);
		const lane =
			live !== undefined && addedIn(live, turn) ? live.lane : undefined;
		const last = groups.at(-1);
		if (last !== undefined && lane !== undefined && last.lane === lane) {
			last.proposals.push(proposal);
		} else {
			groups.push({ lane, proposals: [proposal] });
		}
	}
	return groups;
}

function TodoRun({
	proposals,
	turn,
	next,
}: {
	proposals: Proposal[];
	turn: Turn | null;
	next: boolean;
}): JSX.Element {
	const board = useContext(Board);
	const groups = gathered(proposals, board.todos, turn);
	const first = groups.find(({ lane }) => lane === undefined);
	return (
		<>
			{groups.map((group) => {
				const { lane, proposals } = group;
				return lane === undefined ? (
					next && group === first ? (
						<div key={proposals[0]?.id} className="mt-6 mb-3">
							<p className="mb-1 flex items-center gap-1.5 pl-1 text-muted-foreground text-xs">
								<ArrowRightIcon aria-hidden className="size-3.5 text-primary" />
								<span className="font-medium text-foreground">Next up</span>
							</p>
							<div className="flex flex-col gap-2">
								{proposals.map((proposal) => (
									<TodoCard key={proposal.id} proposal={proposal} grouped />
								))}
							</div>
						</div>
					) : (
						proposals.map((proposal) => (
							<TodoCard key={proposal.id} proposal={proposal} />
						))
					)
				) : (
					<div key={proposals[0]?.id} className="my-3">
						<p className="mb-1 flex items-center gap-1.5 pl-1 text-muted-foreground text-xs">
							<ListPlusIcon aria-hidden className="size-3.5 text-primary" />
							<span>
								<span className="font-medium text-foreground">
									Added {proposals.length > 1 && `${proposals.length} `}to{" "}
									{board.lanes.find((each) => each.id === lane)?.name ??
										"Untriaged"}
								</span>{" "}
								by this task
							</span>
						</p>
						<div
							className={cn(
								"flex flex-col gap-2",
								// A rail ties two or more cards to the line; one needs none.
								proposals.length > 1 &&
									"ml-[11px] border-primary/30 border-l-2 pl-3",
							)}
						>
							{proposals.map((proposal) => (
								<TodoCard key={proposal.id} proposal={proposal} grouped />
							))}
						</div>
					</div>
				);
			})}
		</>
	);
}

export function TodoCard({
	proposal,
	grouped = false,
}: {
	proposal: Proposal;
	/** Whether it stands in a group, which spaces it. */
	grouped?: boolean;
}): JSX.Element {
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
				"flex items-start gap-3 rounded-lg border border-border/60 bg-card py-2.5 pr-2.5 pl-3 text-card-foreground transition-colors hover:border-border",
				!grouped && "my-3",
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
