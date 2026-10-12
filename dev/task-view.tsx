import {
	CircleAlertIcon,
	CircleCheckIcon,
	GitBranchIcon,
	SquareArrowOutUpRightIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { type JSX, useEffect, useEffectEvent, useRef, useState } from "react";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "#dev/components/ui/alert.tsx";
import { Button } from "#dev/components/ui/button.tsx";
import { Dialog } from "#dev/components/ui/dialog.tsx";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import { age } from "../age";
import type { ConversationState, Session } from "../conversations";
import type { Need } from "../needs";
import type { Question } from "../plan";
import { progress } from "../progress";
import type { Details } from "../show";
import type { Action } from "./actions";
import { AgentIcon } from "./agent-icons";
import { bringSession, listSessions } from "./api";
import { Back } from "./back";
import { type AgentChoice, agentName } from "./conversation-feed";
import { QuestionCards } from "./question-cards";
import { Refusal, useRefusal } from "./refusal";
import { Task } from "./tasks";

/** What `#conversations/task/<name>` opens: a task whose agent runs outside the page. */
export const TASK = "task/";

/** The questions an agent has open: unchecked and unanswered in its plan. */
export function openQuestions(need: Need): Question[] {
	return "questions" in need ? need.questions : [];
}

/**
 * The chord that goes to what an agent waits on you for, beside Alt+N, which
 * opens the next conversation waiting.
 */
export const TO_QUESTIONS = "Alt+Q";

/**
 * The cards an agent waits on you through, newest last: its questions, an
 * escalation, a review, or a live ask.
 */
const WAITING_CARDS = [
	'section[aria-label="questions for you"]',
	'section[aria-label^="escalated "]',
	'section[aria-label^="review "]',
	'[aria-label="permission"]',
	'form[aria-label="question"]',
].join(", ");

/**
 * Scrolls to the newest card in `within` that an agent waits on you through
 * and focuses its first stop, false when there is none.
 */
export function toWaiting(within: HTMLElement | null): boolean {
	const cards = within?.querySelectorAll<HTMLElement>(WAITING_CARDS) ?? [];
	const card = cards[cards.length - 1];
	if (card === undefined) {
		return false;
	}
	const stop = card.querySelector<HTMLElement>(
		"[data-stop], textarea, input, button:not([disabled])",
	);
	// What is focused in the middle, as a tall card's middle can leave it out of sight.
	(stop ?? card).scrollIntoView({ block: "center", behavior: "smooth" });
	stop?.focus({ preventScroll: true });
	return true;
}

/**
 * Goes to what the agent waits on you for on Alt+Q, beside Alt+N, which opens
 * the next conversation waiting.
 */
export function useToQuestions(go: () => void): void {
	const press = useEffectEvent(go);
	useEffect(() => {
		const down = (event: KeyboardEvent) => {
			// By the key's place, since Alt+Q types œ on a Mac.
			if (
				event.code === "KeyQ" &&
				event.altKey &&
				!event.metaKey &&
				!event.ctrlKey &&
				!event.shiftKey
			) {
				event.preventDefault();
				press();
			}
		};
		document.addEventListener("keydown", down);
		return () => document.removeEventListener("keydown", down);
	}, []);
}

/**
 * The actions' row on whether the agent has open questions, or waits on you
 * otherwise, which goes there as Alt+Q does.
 */
export function questionsAction(need: Need, go: () => void): Action {
	const said = waitingOn(need);
	if (said === null) {
		return {
			label: "No open questions",
			icon: <CircleCheckIcon />,
			run: null,
		};
	}
	return {
		label: said,
		// The sidebar's mark for an agent waiting on you.
		icon: <CircleAlertIcon className="text-warning" />,
		detail: <Kbd className="h-4">{TO_QUESTIONS}</Kbd>,
		run: go,
		count: Math.max(openQuestions(need).length, 1),
	};
}

/** What the agent waits on you for, in a few words, or null when nothing. */
function waitingOn(need: Need): string | null {
	const open = openQuestions(need).length;
	if (need.kind === "waiting" && need.why === "ask") {
		return "Waiting on your answer";
	}
	if (open > 0) {
		return `${open} open question${open === 1 ? "" : "s"}`;
	}
	if (need.kind === "waiting" && need.why === "escalated") {
		return "Escalated";
	}
	if (need.kind === "waiting" && need.why === "review") {
		return "Ready to merge";
	}
	return null;
}

/**
 * The line under a header's title: the branch, and how far its task is,
 * which opens the task's details on a click.
 */
export function TaskLine({
	branch,
	task,
	onDetails,
}: {
	/** Null once its task is gone. */
	branch: string | null;
	task: Details | null;
	onDetails: () => void;
}): JSX.Element | null {
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
	const counted = task.plan === null ? null : progress(task.plan);
	return (
		<button
			type="button"
			aria-label={`About ${task.task}`}
			onClick={onDetails}
			className="flex min-w-0 items-center gap-1 self-start rounded-sm text-muted-foreground text-xs hover:text-foreground"
		>
			{line}
			{counted && (
				<span className="shrink-0 tabular-nums">
					· {counted.done}/{counted.total}
				</span>
			)}
		</button>
	);
}

/**
 * A task whose agent runs outside the page, such as in Claude Code or Codex,
 * where its conversation would be: the same header, its open questions as
 * cards, and what the page knows of the agent beyond its plan, whose details
 * the header's task line opens. The page cannot message that agent, so the cards
 * copy their answers to paste into its own session, unless its session is
 * brought in.
 */
export function TaskView({
	task,
	need,
	agents,
	onBrought,
	onBack,
}: {
	task: Details;
	need: Need;
	agents: AgentChoice[];
	/** Opens a session brought in, as the conversation it now is. */
	onBrought: (conversation: ConversationState) => void;
	/** Back to the list, on a phone; null beside a sidebar. */
	onBack: (() => void) | null;
}): JSX.Element {
	const [details, setDetails] = useState(false);
	const open = openQuestions(need);
	const section = useRef<HTMLElement>(null);
	useToQuestions(() => toWaiting(section.current) || setDetails(true));
	return (
		<section
			ref={section}
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
							its own session, or bring that session in below.
						</AlertDescription>
					</Alert>
					{open.length > 0 && (
						<div id={`questions-${task.task}`} className="flex flex-col gap-2">
							<QuestionCards questions={open} copy blocked />
						</div>
					)}
					{open.length === 0 && (
						<p className="text-muted-foreground">No open questions.</p>
					)}
					<Agent task={task} />
					<Sessions task={task.task} agents={agents} onBrought={onBrought} />
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

/**
 * The sessions the agents hold in the task's tree that the page does not,
 * such as one started in the Claude or Codex CLI, each brought in as a
 * conversation on a click.
 */
function Sessions({
	task,
	agents,
	onBrought,
}: {
	task: string;
	agents: AgentChoice[];
	onBrought: (conversation: ConversationState) => void;
}): JSX.Element {
	// Null while the agents are asked, which starts each of them.
	const [sessions, setSessions] = useState<Session[] | null>(null);
	const [bringing, setBringing] = useState<string | null>(null);
	const { refusal, refuse } = useRefusal();
	useEffect(() => {
		let current = true;
		setSessions(null);
		listSessions(task).then(
			(listed) => current && setSessions(listed),
			(error: unknown) => {
				if (current) {
					setSessions([]);
					refuse("Sessions not listed", error);
				}
			},
		);
		return () => {
			current = false;
		};
	}, [task, refuse]);
	const bring = (session: Session) => {
		setBringing(session.session);
		bringSession(session, task).then(onBrought, (error: unknown) => {
			setBringing(null);
			refuse("Not brought in", error);
		});
	};
	return (
		<section aria-label="sessions" className="flex flex-col gap-1">
			<h3 className="font-medium text-muted-foreground text-xs">
				Sessions in this worktree
			</h3>
			{sessions === null ? (
				<p className="text-muted-foreground text-xs">Asking the agents…</p>
			) : sessions.length === 0 ? (
				<p className="text-muted-foreground text-xs">
					None the page could bring in.
				</p>
			) : (
				<>
					<p className="text-muted-foreground text-xs">
						Close one in its CLI before bringing it in, so the two do not write
						to it at once.
					</p>
					<ul className="flex flex-col">
						{sessions.map((each) => (
							<li
								key={`${each.agent} ${each.session}`}
								className="flex min-w-0 items-center gap-2 py-1"
							>
								<AgentIcon
									agent={each.agent}
									name={agentName(agents, each.agent)}
									className="size-3.5 text-foreground/70"
								/>
								<span
									className={
										each.title === null
											? "min-w-0 flex-1 truncate text-muted-foreground italic"
											: "min-w-0 flex-1 truncate"
									}
								>
									{each.title ?? "Untitled session"}
								</span>
								{each.updatedAt !== null && (
									<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
										{age(each.updatedAt)} ago
									</span>
								)}
								<Button
									size="xs"
									variant="outline"
									disabled={bringing !== null}
									onClick={() => bring(each)}
								>
									{bringing === each.session ? "Bringing in…" : "Bring in"}
								</Button>
							</li>
						))}
					</ul>
				</>
			)}
			<Refusal refusal={refusal} />
		</section>
	);
}
