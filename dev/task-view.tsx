import {
	ChevronLeftIcon,
	GitBranchIcon,
	SquarePenIcon,
	TriangleAlertIcon,
	UnplugIcon,
} from "lucide-react";
import {
	type JSX,
	useContext,
	useEffect,
	useEffectEvent,
	useMemo,
	useRef,
	useState,
} from "react";
import { Duration } from "webappwiz/time";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "#dev/components/ui/alert.tsx";
import { Button } from "#dev/components/ui/button.tsx";
import { Dialog } from "#dev/components/ui/dialog.tsx";
import { cn } from "#dev/lib/utils.ts";
import { age } from "../age";
import type { ConversationState, Session } from "../conversations";
import { answersTo, type Need, quietSince } from "../needs";
import type { Question } from "../plan";
import type { Details } from "../show";
import { AgentIcon } from "./agent-icons";
import { type Reply, ReplyContext } from "./card-reply";
import { toCardTop } from "./card-shell";
import { TASK } from "./conversation-address";
import { bringSession, listSessions } from "./conversation-api";
import { type AgentChoice, agentName } from "./conversation-feed";
import { type Drafts, externalDraft } from "./drafts";
import { Held, ReadOnlyBanner, SubagentComposer } from "./handed-out";
import { useNow } from "./hooks/use-now";
import { QuestionCards } from "./question-cards";
import { Refusal, useRefusal } from "./refusal";
import { SystemsCard, systemsAction } from "./systems";
import { TakeUpOrRemove } from "./task-actions";
import { TaskIcon } from "./task-icon";
import { Task } from "./tasks";
import { BarButton, BELOW_BAR, TopBar } from "./top-bar";

/**
 * A task whose agent runs outside the page, such as in Claude Code or Codex,
 * where its conversation would be: the same header, its open questions as
 * cards, and what the page knows of the agent beyond its plan, whose details
 * the header's task line opens. The page cannot message that agent, so the cards
 * copy their answers to paste into its own session, unless its session is
 * brought in. What is written in them is kept in `drafts` until the agent
 * has none open, so a reload loses nothing. An agent that answers to a
 * conversation, such as a subagent its harness started, is answered there,
 * so its cards are read-only and the view links to that one.
 */
export function TaskView({
	task,
	need,
	agents,
	drafts,
	onBrought,
	onOpen,
	onNew,
	onBack,
}: {
	task: Details;
	need: Need;
	agents: AgentChoice[];
	drafts: Drafts;
	/** Opens a session brought in, as the conversation it now is. */
	onBrought: (conversation: ConversationState) => void;
	/** Opens the conversation it answers to. */
	onOpen: (id: string) => void;
	/** On to a new conversation, as from a conversation's bar. */
	onNew: () => void;
	/** Back to the list, on a phone; null beside a sidebar. */
	onBack: (() => void) | null;
}): JSX.Element {
	const [details, setDetails] = useState(false);
	const by = answersTo({ conversation: null, task }, useContext(Held));
	const quiet = quietSince(
		{ task, need },
		useNow(need.kind !== "waiting", Duration.mins(1)),
	);
	const open = openQuestions(need);
	const section = useRef<HTMLElement>(null);
	const kept = draftOf(task.task);
	const reply = useMemo<Reply>(
		() => ({
			send: null,
			drafts: {
				read: (name) => drafts.read(`${kept}:${name}`),
				write: (name, text) => drafts.write(`${kept}:${name}`, text),
			},
		}),
		[drafts, kept],
	);
	// Seen as they show, so they wait on you no longer. Once its agent
	// recorded every answer, nothing is left to keep.
	const shown = asking(open);
	useEffect(() => {
		drafts.write(`${kept}:seen`, shown);
		if (shown === "") {
			drafts.write(`${kept}:questions`, "");
			drafts.write(`${kept}:copied`, "");
		}
	}, [shown, drafts, kept]);
	useArrived(`${TASK}${task.task}`, () => toWaiting(section.current));
	return (
		<section
			ref={section}
			aria-label={task.task}
			className={cn(
				"@container flex min-h-0 min-w-0 flex-col gap-3",
				onBack === null ? BELOW_BAR : "h-full",
			)}
		>
			<TopBar
				leading={
					onBack !== null && (
						<BarButton label="Back to conversations" onClick={onBack}>
							<ChevronLeftIcon />
						</BarButton>
					)
				}
				title={task.task}
				detail={
					onBack === null && (
						<TaskLine
							branch={task.branch}
							task={task}
							onDetails={() => setDetails(true)}
						/>
					)
				}
				actions={[
					// A phone keeps its bar to the name: this opens what the branch
					// beside it would.
					onBack === null
						? null
						: {
								label: `About ${task.task}`,
								icon: <TaskIcon />,
								run: () => setDetails(true),
							},
					systemsAction(task.systems),
					{ label: "New conversation", icon: <SquarePenIcon />, run: onNew },
				].filter((each) => each !== null)}
			/>
			{by !== null && <ReadOnlyBanner by={by} phone={onBack !== null} />}
			<div className="relative min-h-0 flex-1 overflow-y-auto">
				{/* Where a conversation's widgets stand, at the right. */}
				<div className="absolute top-4 right-4 hidden w-60 @min-[61rem]:block">
					<SystemsCard systems={task.systems} />
				</div>
				<div className="@min-[61rem]:pe-[16.75rem]">
					<div className="mx-auto flex w-full max-w-[44rem] flex-col gap-6 px-4 pt-4 pb-8 text-sm">
						{need.kind === "waiting" && need.why === "abandoned" ? (
							<Alert>
								<UnplugIcon className="text-muted-foreground" />
								<AlertTitle>Abandoned</AlertTitle>
								<AlertDescription>
									{need.subject}, so no agent is left on it. Take it up in a new
									conversation, which picks up from its ARBOR.md, or remove it.
								</AlertDescription>
								<TakeUpOrRemove task={task} className="col-start-2 mt-2" />
							</Alert>
						) : by !== null ? null : (
							<Alert variant="warning">
								<TriangleAlertIcon />
								<AlertTitle>Its agent runs outside the page</AlertTitle>
								<AlertDescription>
									{quiet !== null &&
										`No sign of it for ${age(quiet)}: no edit, commit or arbor command. `}
									The page cannot message it: answer here, then paste the reply
									into its own session, or bring that session in below.
								</AlertDescription>
							</Alert>
						)}
						{open.length > 0 && (
							<div
								id={`questions-${task.task}`}
								className="flex flex-col gap-2"
							>
								<ReplyContext value={by === null ? reply : null}>
									<QuestionCards
										questions={open}
										draft="questions"
										copy={by === null}
										onSent={() => drafts.write(`${kept}:copied`, asking(open))}
									/>
								</ReplyContext>
							</div>
						)}
						{open.length === 0 && (
							<p className="text-muted-foreground">No open questions.</p>
						)}
						<Agent task={task} />
						{by === null && (
							<Sessions
								task={task.task}
								agents={agents}
								onBrought={onBrought}
							/>
						)}
					</div>
				</div>
			</div>
			{by !== null && (
				<div className="@min-[61rem]:pe-[16.75rem]">
					<div className="mx-auto w-full max-w-[44rem] px-4 pb-4">
						<SubagentComposer task={task.task} by={by} onOpen={onOpen} />
					</div>
				</div>
			)}
			<Dialog open={details} onOpenChange={setDetails}>
				{details && <Task task={task} />}
			</Dialog>
		</section>
	);
}

/** The questions an agent has open: unchecked and unanswered in its plan. */
export function openQuestions(need: Need): Question[] {
	return "questions" in need ? need.questions : [];
}

/** Where the reply to task `task`'s external agent is kept in the page's drafts. */
function draftOf(task: string): string {
	return externalDraft(
		new URLSearchParams(location.search).get("project"),
		task,
	);
}

/** The questions a copied reply answered, as kept beside it. */
function asking(questions: Question[]): string {
	return questions.map((asked) => `${asked.number}. ${asked.text}`).join("\n");
}

/** What the page's drafts keep of the replies to external agents' questions. */
export class ExternalReplies {
	constructor(private readonly drafts: Drafts) {}

	/**
	 * Whether the reply to every question task `task`'s external agent has
	 * open was copied, to paste into its session; a question asked since, not.
	 */
	copied(task: string, need: Need): boolean {
		return this.answers(task, need, "copied");
	}

	/**
	 * Whether every question task `task`'s external agent has open was shown
	 * in its view, which the person opened since it asked; a question asked
	 * since, not.
	 */
	seen(task: string, need: Need): boolean {
		return this.answers(task, need, "seen");
	}

	private answers(task: string, need: Need, kept: "copied" | "seen"): boolean {
		const open = openQuestions(need);
		// With no agent left to paste it to, it waits on you all the same.
		if (need.kind === "waiting" && need.why === "abandoned") {
			return false;
		}
		return (
			open.length > 0 &&
			this.drafts.read(`${draftOf(task)}:${kept}`) === asking(open)
		);
	}
}

/**
 * Renders again as a reply is copied for an external agent, or let go, or
 * its questions are seen.
 */
export function useCopiedReplies(drafts: Drafts): void {
	const [, setWrites] = useState(0);
	useEffect(
		() =>
			drafts.events.on("written", (key) => {
				if (
					key.startsWith("external:") &&
					(key.endsWith(":copied") || key.endsWith(":seen"))
				) {
					setWrites((writes) => writes + 1);
				}
			}),
		[drafts],
	);
}

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
 * Scrolls to the top of the newest card in `within` that an agent waits on
 * you through and focuses its first stop, false when there is none.
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
	toCardTop(card, "smooth");
	stop?.focus({ preventScroll: true });
	return true;
}

/**
 * Where ⌥⌘M, which opens the next agent waiting on you, and the view that
 * shows that agent meet: the agent it opened last, until its view goes to
 * what it waits on you for.
 */
const arrivals = new EventTarget();
let opening: { open: string; from: string } | null = null;

/**
 * Goes to what agent `open` waits on you for once its view shows, from the
 * address the page is at, which is where to come back to.
 */
export function arriveAt(open: string): void {
	opening = { open, from: location.hash };
	arrivals.dispatchEvent(new Event("arrive"));
}

/**
 * Runs `go` once ⌥⌘M opens agent `open`: as its view shows, or at once
 * when it already does, with the address it came from.
 */
export function useArrived(open: string, go: (from: string) => void): void {
	const arrive = useEffectEvent(() => {
		if (opening?.open === open) {
			const { from } = opening;
			opening = null;
			go(from);
		}
	});
	useEffect(() => {
		arrive();
		arrivals.addEventListener("arrive", arrive);
		return () => arrivals.removeEventListener("arrive", arrive);
	}, []);
}

/**
 * The line under a header's title: the branch, which opens the task's
 * details on a click.
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
	return (
		<button
			type="button"
			aria-label={`About ${task.task}`}
			onClick={onDetails}
			className="flex min-w-0 items-center gap-1 self-start rounded-sm text-muted-foreground text-xs hover:text-foreground"
		>
			{line}
		</button>
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
