import {
	GitBranchIcon,
	SquareArrowOutUpRightIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { type JSX, useState } from "react";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "#dev/components/ui/alert.tsx";
import { Button } from "#dev/components/ui/button.tsx";
import { Dialog } from "#dev/components/ui/dialog.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#dev/components/ui/popover.tsx";
import type { Need } from "../needs";
import { goalLine, type Question, unfinished } from "../plan";
import { progress } from "../progress";
import type { Details } from "../show";
import { Back } from "./back";
import { QuestionCards } from "./question-cards";
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
 * cards, and what the page knows of the agent beyond its plan, which the
 * header's task line opens. The page cannot message that agent, so the cards
 * copy their answers to paste into its own session.
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
					<Alert variant="warning">
						<TriangleAlertIcon />
						<AlertTitle>Its agent runs outside the page</AlertTitle>
						<AlertDescription>
							The page cannot message it: answer here, then paste the reply into
							its own session.
						</AlertDescription>
					</Alert>
					{open.length > 0 && (
						<div id={`questions-${task.task}`} className="flex flex-col gap-2">
							<QuestionCards questions={open} copy />
						</div>
					)}
					{open.length === 0 && (
						<p className="text-muted-foreground">No open questions.</p>
					)}
					<Agent task={task} />
				</div>
			</div>
			<Dialog open={details} onOpenChange={setDetails}>
				{details && <Task task={task} />}
			</Dialog>
		</section>
	);
}

/**
 * What the page knows of the agent that its ARBOR.md does not say: why it
 * stopped, and how much it has changed so far.
 */
function Agent({ task }: { task: Details }): JSX.Element {
	const said =
		task.review !== null
			? `Ready to merge: ${task.review}`
			: task.escalation === null
				? null
				: `Escalated: ${task.escalation}`;
	return (
		<div className="flex flex-col gap-2">
			{said !== null && (
				<p className="rounded-lg border bg-muted/40 px-3 py-2">{said}</p>
			)}
			<p className="text-muted-foreground text-xs tabular-nums">
				{task.ahead ?? "?"} commit{task.ahead === 1 ? "" : "s"}
				{task.added !== null && (
					<>
						{" · "}
						<span className="text-success">+{task.added}</span>{" "}
						<span className="text-destructive">-{task.removed ?? 0}</span>
					</>
				)}
				{task.age !== null && ` · started ${task.age} ago`}
			</p>
		</div>
	);
}
