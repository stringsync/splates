import {
	CheckIcon,
	CopyIcon,
	GitBranchIcon,
	SquareArrowOutUpRightIcon,
} from "lucide-react";
import { type JSX, useEffect, useRef, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { Dialog } from "#dev/components/ui/dialog.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#dev/components/ui/popover.tsx";
import { Textarea } from "#dev/components/ui/textarea.tsx";
import type { Need } from "../needs";
import { goalLine, type Question, unfinished } from "../plan";
import { progress } from "../progress";
import type { Details } from "../show";
import { Back } from "./back";
import { Markdown } from "./markdown";
import { QuestionCards, type Reply, ReplyContext } from "./question-cards";
import { Progress, Task } from "./tasks";

/** What `#conversations/task/<name>` opens: a task whose agent runs outside the page. */
export const TASK = "task/";

/** The questions an agent has open: unchecked and unanswered in its plan. */
export function openQuestions(need: Need): Question[] {
	return "questions" in need ? need.questions : [];
}

/**
 * The line under a header's title: the branch, and how far its task is.
 * For a task it opens the rest: the Goal, what the agent does next or needs,
 * its open questions, and the task's details.
 */
export function TaskLine({
	branch,
	task,
	need,
	onQuestions,
	onDetails,
}: {
	/** Null once its task is gone. */
	branch: string | null;
	task: Details | null;
	need: Need;
	onQuestions: () => void;
	onDetails: () => void;
}): JSX.Element | null {
	const [shown, setShow] = useState(false);
	// Out of the way of what it goes to.
	const then = (go: () => void) => () => {
		setShow(false);
		go();
	};
	if (branch === null) {
		return null;
	}
	const line = (
		<>
			<GitBranchIcon
				role="img"
				aria-label="branch"
				className="size-3 shrink-0"
			/>
			<span className="truncate">{branch}</span>
		</>
	);
	if (task === null) {
		return (
			<p className="flex min-w-0 items-center gap-1 text-muted-foreground text-xs">
				{line}
			</p>
		);
	}
	const plan = task.plan;
	const counted = plan === null ? null : progress(plan);
	const goal = plan === null ? null : goalLine(plan);
	// Plain text: markdown's backticks would show as they are.
	const doing = doingOf(need, plan)?.replaceAll("`", "") ?? null;
	const open = openQuestions(need).length;
	return (
		<Popover open={shown} onOpenChange={setShow}>
			<PopoverTrigger
				aria-label={`About ${task.task}`}
				className="flex min-w-0 items-center gap-1 self-start rounded-sm text-muted-foreground text-xs hover:text-foreground"
			>
				{line}
				{counted && (
					<span className="shrink-0 tabular-nums">
						· {counted.done}/{counted.total}
					</span>
				)}
			</PopoverTrigger>
			<PopoverContent
				aria-label={`About ${task.task}`}
				align="start"
				className="w-80"
			>
				{goal !== null && <p>{goal}</p>}
				{counted && <Progress {...counted} />}
				{doing !== null && (
					<p className="text-muted-foreground text-xs">{doing}</p>
				)}
				<div className="flex gap-2">
					{open > 0 && (
						<Button variant="outline" size="sm" onClick={then(onQuestions)}>
							{open} open question{open === 1 ? "" : "s"}
						</Button>
					)}
					<Button variant="outline" size="sm" onClick={then(onDetails)}>
						Details
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}

/** One line on where the agent is: waiting on you, assuming, or what is next. */
function doingOf(need: Need, plan: string | null): string | null {
	switch (need.kind) {
		case "waiting":
			return `Waiting on you: ${need.subject}`;
		case "assuming":
			return `Assuming: ${need.subject}`;
		case "working":
			return need.subject === null ? null : `Next: ${need.subject}`;
		case "idle": {
			const [step] = plan === null ? [] : unfinished(plan).steps;
			return step === undefined ? null : `Next: ${step}`;
		}
	}
}

/**
 * A task whose agent runs outside the page, such as in Claude Code or Codex,
 * where its conversation would be: the same header, its open questions as
 * cards, and its plan. The page cannot message that agent, so the cards
 * compose a reply here to copy into its own session.
 */
export function TaskView({
	task,
	need,
	onBack,
}: {
	task: Details;
	need: Need;
	/** Back to the list, on a phone; null beside a sidebar. */
	onBack: (() => void) | null;
}): JSX.Element {
	const [details, setDetails] = useState(false);
	const open = openQuestions(need);
	const [text, setText] = useState("");
	const box = useRef<HTMLTextAreaElement>(null);
	const reply: Reply = {
		text,
		write: setText,
		focus: () => {
			box.current?.focus();
			box.current?.setSelectionRange(text.length, text.length);
		},
	};
	return (
		<section
			aria-label={task.task}
			className="flex h-[calc(100dvh-2rem)] min-h-0 min-w-0 flex-col gap-3"
		>
			<header className="flex min-h-9 items-center gap-2">
				{onBack !== null && <Back onBack={onBack} />}
				<div className="flex min-w-0 flex-1 flex-col">
					<h2 className="flex min-w-0 items-center gap-1.5 font-medium text-sm">
						<SquareArrowOutUpRightIcon
							role="img"
							aria-label="external agent"
							className="size-3.5 shrink-0 text-foreground/70"
						/>
						<span className="truncate">{task.task}</span>
					</h2>
					<TaskLine
						branch={task.branch}
						task={task}
						need={need}
						onQuestions={() =>
							document
								.getElementById(`questions-${task.task}`)
								?.scrollIntoView({ block: "start", behavior: "smooth" })
						}
						onDetails={() => setDetails(true)}
					/>
				</div>
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto flex w-full max-w-[44rem] flex-col gap-6 px-4 pt-4 pb-8 text-sm">
					{open.length > 0 && (
						<div id={`questions-${task.task}`} className="flex flex-col gap-2">
							<ReplyContext value={reply}>
								<QuestionCards questions={open} />
							</ReplyContext>
							<Textarea
								ref={box}
								aria-label="reply"
								placeholder="Pick or type answers above, or write them here"
								value={text}
								onChange={(event) => setText(event.target.value)}
							/>
							<div className="flex items-center gap-2">
								<p className="flex-1 text-muted-foreground text-xs">
									Its agent runs outside the page: paste this into its session.
								</p>
								<CopyButton text={text} />
							</div>
						</div>
					)}
					{task.plan === null ? (
						<p className="text-muted-foreground">
							No ARBOR.md: whoever picks this up starts from the diff.
						</p>
					) : (
						<Markdown text={withoutQuestions(task.plan)} />
					)}
				</div>
			</div>
			<Dialog open={details} onOpenChange={setDetails}>
				{details && <Task task={task} />}
			</Dialog>
		</section>
	);
}

/** A plan to read under its cards: no title, and no `## Blocked`, which they show. */
function withoutQuestions(plan: string): string {
	return plan
		.replace(/^\s*#\s[^\n]*/, "")
		.replace(/^## Blocked\n[\s\S]*?(?=^## |(?![\s\S]))/m, "");
}

/** How long Copy says Copied before it goes back. */
const COPIED_MS = 1500;

/** Copies `text`, and says so where it was clicked for a moment. */
function CopyButton({ text }: { text: string }): JSX.Element {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) {
			return;
		}
		const back = setTimeout(() => setCopied(false), COPIED_MS);
		return () => clearTimeout(back);
	}, [copied]);
	return (
		<Button
			variant="outline"
			size="sm"
			disabled={text.trim() === ""}
			onClick={() =>
				void navigator.clipboard.writeText(text).then(() => setCopied(true))
			}
		>
			{copied ? (
				<CheckIcon data-icon="inline-start" />
			) : (
				<CopyIcon data-icon="inline-start" />
			)}
			<span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
		</Button>
	);
}
