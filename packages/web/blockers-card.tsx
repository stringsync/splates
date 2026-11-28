import {
	cleared,
	type DeferralBlocker,
	deferralBlockers,
	type ElsewhereOnBoard,
	type TaskRecord,
} from "@splates/server/board/browser";
import type { ConversationState } from "@splates/server/conversations";
import {
	CheckIcon,
	ClockIcon,
	ListPlusIcon,
	type LucideIcon,
	MinusIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { type JSX, useContext } from "react";
import { cn } from "#web/lib/utils.ts";
import { queueTodo } from "./api";
import { blockedFix, useApplyFix } from "./blocked-fix";
import { Board } from "./board";
import { CardFooter } from "./card-footer";
import { CardShell, type Tone } from "./card-shell";
import { lastReport } from "./conversation-names";
import { useActs } from "./deferred-acts";
import { deferredTask, linkedBlockers, TASK_STATUS } from "./deferred-body";
import { ElsewhereMention } from "./markdown";
import { Spinner } from "./pending";
import { PulsingDot } from "./signal-card";

/**
 * The card of a blocked task, whether it is queued on the board or set aside
 * in a conversation: its header says what it asks, and its body lists the
 * blockers.
 */
export function BlockersCard({
	task,
	label,
	chip,
}: {
	task: TaskRecord;
	label: string;
	/** The splates task it names in its header, as a conversation's card does. */
	chip?: string;
}): JSX.Element {
	const board = useContext(Board);
	const { Icon, tone, title } = blockersLook(
		blockersOf(task, board.todos, board.elsewhere),
		task,
	);
	return (
		<CardShell label={label} Icon={Icon} title={title} tone={tone} task={chip}>
			<DeferredBody task={task} />
		</CardShell>
	);
}

/**
 * The body of a blocked task's card, the same wherever the task is met: the
 * tasks it waits on, those that need the person first, with a button that
 * queues every blocker nobody has and a line on when the task starts by itself.
 */
export function DeferredBody({
	task,
}: {
	task: TaskRecord;
}): JSX.Element | null {
	const board = useContext(Board);
	const { refusal, pending, act } = useActs();
	const apply = useApplyFix();
	const deferred = task.deferred;
	const blockers = blockersOf(task, board.todos, board.elsewhere);
	const legacy =
		deferred === undefined
			? []
			: deferralBlockers(
					task,
					board.todos,
					board.elsewhere?.blockers[task.id],
				).filter((each) => each.kind !== "task");
	const unqueued = blockers.filter(
		(each) =>
			each.project === undefined &&
			each.status === "available" &&
			!cleared(each),
	);
	const left = blockers.filter((each) => !cleared(each)).length;
	// A queued task's fix reaches blockers of blockers too, blockers first.
	const fix = deferred === undefined ? blockedFix(task, board.todos) : null;
	const chain = fix?.kind === "queue" ? fix.chain : null;
	const count = chain === null ? unqueued.length : chain.length;
	const done = blockers.filter((each) => cleared(each));
	const listed = (group: ReturnType<typeof groupOf>) =>
		blockers.filter((each) => groupOf(each) === group);
	const foldDone = done.length > DONE_LISTED;
	const rows = (group: ReturnType<typeof groupOf>) =>
		listed(group).map((blocker) => (
			<BlockerRow key={`task:${blocker.id}`} blocker={blocker} />
		));
	const hasWhy = deferred !== undefined && deferred.why !== "";
	const hasBody = hasWhy || blockers.length > 0;
	const statusNote =
		task.takenBy !== null ? (
			<>
				Started in{" "}
				<button
					type="button"
					className="underline"
					onClick={() => board.openTask(task.takenBy as string)}
				>
					{task.takenBy}
				</button>
			</>
		) : left === 0 ? (
			"Every blocker is done."
		) : count > 0 ? (
			`#${task.id} can start once its blockers are queued and done.`
		) : (
			`#${task.id} starts automatically once every blocker is done. Nothing needs you.`
		);
	return (
		<div className="flex flex-1 flex-col text-sm">
			{hasWhy && (
				<p className="px-4 py-3 leading-relaxed @max-md:py-2.5">
					{deferred.why}
				</p>
			)}
			<ol
				aria-label="blockers"
				className={cn(
					"flex flex-col",
					!hasWhy && "[&>li:first-child]:border-t-0 [&>li:first-child]:bg-none",
				)}
			>
				{rows("needs you")}
				{rows("in progress")}
				{foldDone ? (
					<li className="rule-t px-4 py-2 text-muted-foreground text-xs">
						<CheckIcon
							aria-hidden
							className="me-2 inline size-3.5 text-success"
						/>
						{done.length} blockers landed
					</li>
				) : (
					rows("done")
				)}
			</ol>
			{legacy.length > 0 && (
				<ul
					aria-label="older notes"
					className={cn(
						"flex flex-col gap-1 px-4 py-2.5 text-muted-foreground text-xs",
						hasBody && "rule-t",
					)}
				>
					{legacy.map((blocker) => (
						<li
							key={`${blocker.kind}:${blocker.kind === "question" ? blocker.text : blocker.kind === "outside" ? blocker.what : ""}`}
						>
							{blocker.kind === "question"
								? blocker.text.split("\n")[0]
								: blocker.kind === "outside"
									? blocker.what
									: ""}
						</li>
					))}
				</ul>
			)}
			<CardFooter
				note={statusNote}
				sheetNote={statusNote}
				refusal={refusal}
				className={!hasBody && legacy.length === 0 ? "border-t-0" : undefined}
				actions={
					count > 0
						? [
								{
									label:
										count === 1 ? "Queue 1 blocker" : `Queue ${count} blockers`,
									Icon: ListPlusIcon,
									primary: true,
									disabled: pending.has("all"),
									onClick: () =>
										void act("all", async () => {
											if (fix?.kind === "queue") {
												await apply(task, fix);
												return;
											}
											for (const each of unqueued) {
												await queueTodo(each.id, true);
											}
										}),
								},
							]
						: []
				}
			/>
		</div>
	);
}

/**
 * Whether the task a conversation set aside as blocked waits on a blocker
 * nobody has queued, which the person has to queue for it to start.
 */
export function useBlockedNeedsYou(
	conversation: ConversationState | null,
): boolean {
	const board = useContext(Board);
	const last = conversation === null ? null : lastReport(conversation);
	const task =
		last?.ending === "deferred" ? deferredTask(board.todos, last.task) : null;
	if (task === null || task.takenBy !== null) {
		return false;
	}
	return blockersOf(task, board.todos, board.elsewhere).some(
		(each) =>
			!cleared(each) &&
			each.status === "available" &&
			each.project === undefined,
	);
}

/**
 * The look of a blocked task's card: what its header says and shows. A task
 * with a blocker nobody has queued asks for the person; once every blocker
 * is queued or landed, it waits with a pulsing blue dot on a neutral header.
 */
export function blockersLook(
	blockers: readonly TaskBlocker[],
	task: TaskRecord,
): { title: string; Icon: LucideIcon; tone: Tone } {
	const open = blockers.filter((each) => !cleared(each));
	const unqueued = open.filter((each) => groupOf(each) === "needs you");
	if (task.takenBy === null && open.length > 0 && unqueued.length === 0) {
		return {
			title: "Waiting on blockers",
			Icon: PulsingDot as LucideIcon,
			tone: "neutral",
		};
	}
	return { title: "Blocked", Icon: TriangleAlertIcon, tone: "warning" };
}

/** The task blockers of `task`, from its deferral when it has one, else what it is linked to wait on. */
export function blockersOf(
	task: TaskRecord,
	board: readonly TaskRecord[],
	elsewhere?: ElsewhereOnBoard,
): TaskBlocker[] {
	if (task.deferred !== undefined) {
		return deferralBlockers(task, board, elsewhere?.blockers[task.id]).filter(
			(each): each is TaskBlocker => each.kind === "task",
		);
	}
	return linkedBlockers(task, board);
}

/** One blocker's row: a mark for its state, its name, where it stands, and its status. */
function BlockerRow({ blocker }: { blocker: TaskBlocker }): JSX.Element {
	const board = useContext(Board);
	const group = groupOf(blocker);
	const status = blocker.status;
	// A dash for an unqueued blocker needing action, a muted clock/spinner for
	// queued/running blockers, and a check only once landed; the tooltip names which.
	const needsYou = group === "needs you" && status === "available";
	const working = status === "working";
	const queued = status === "queued";
	const Mark = needsYou
		? MinusIcon
		: working
			? Spinner
			: queued
				? ClockIcon
				: CheckIcon;
	const said = needsYou ? "not queued" : (TASK_STATUS[status] ?? status);
	const rowStatus = working ? "running" : queued ? "queued" : null;
	const own = blocker.project === undefined;
	return (
		<li
			className={cn(
				"flex items-center gap-3 rule-t px-4 py-2",
				group === "done" && "text-muted-foreground",
			)}
		>
			<Mark
				role="img"
				aria-hidden={undefined}
				aria-label={said}
				className={cn(
					"size-4 shrink-0",
					needsYou ? "text-foreground" : "text-muted-foreground",
				)}
			>
				<title>{said}</title>
			</Mark>
			<div className="flex min-w-0 flex-1 items-baseline gap-2">
				{own ? (
					<button
						type="button"
						onClick={() => board.open(blocker.id)}
						className="min-w-0 cursor-pointer truncate text-left hover:underline"
					>
						<span className="text-muted-foreground tabular-nums">
							#{blocker.id}
						</span>{" "}
						{board.todos.find((each) => each.id === blocker.id)?.subject ??
							blocker.subject}
					</button>
				) : (
					<span className="flex min-w-0 flex-wrap items-center gap-2">
						<ElsewhereMention
							project={
								blocker.slug ??
								blocker.project?.split("/").filter(Boolean).at(-1) ??
								blocker.project ??
								""
							}
							id={blocker.id}
						/>
						<span>{blocker.subject}</span>
					</span>
				)}
			</div>
			{rowStatus !== null && (
				<span className="shrink-0 text-muted-foreground text-xs">
					{rowStatus}
				</span>
			)}
		</li>
	);
}

/** How many cleared blockers a card lists before folding them into one line. */
const DONE_LISTED = 3;

type TaskBlocker = Extract<DeferralBlocker, { kind: "task" }>;

/** Which group of the card a blocker sits in: what needs the person, what moves, what landed. */
function groupOf(blocker: TaskBlocker): "needs you" | "in progress" | "done" {
	if (cleared(blocker)) {
		return "done";
	}
	return blocker.status === "queued" || blocker.status === "working"
		? "in progress"
		: "needs you";
}
