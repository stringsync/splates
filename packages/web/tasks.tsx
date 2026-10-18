import { age } from "@stringsync/splates-server/age";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import {
	type Needing,
	needs,
	questions,
} from "@stringsync/splates-server/plans/browser";
import type { Details } from "@stringsync/splates-server/show";
import type { Snapshot } from "@stringsync/splates-server/snapshot";
import { ChevronRightIcon, SquarePenIcon } from "lucide-react";
import {
	type CSSProperties,
	type JSX,
	type ReactNode,
	useContext,
	useState,
} from "react";
import { Duration } from "webappwiz/time";
import { Button } from "#web/components/ui/button.tsx";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#web/components/ui/collapsible.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "#web/components/ui/empty.tsx";
import { cn } from "#web/lib/utils.ts";
import { NEW } from "./conversation-address";
import { reportedAs } from "./conversation-names";
import { Dispatching, OnIt } from "./dispatching";
import { useEverywhere } from "./everywhere-context";
import type { EverywhereSummary, InProject } from "./everywhere-feed";
import { useFolded } from "./folded";
import { useNow } from "./hooks/use-now";
import { Mark } from "./mark";
import { HEADING, Markdown } from "./markdown";
import { NavigationContext } from "./navigation";
import { isPartOf, type Nested, nest } from "./parts";
import { PHONE_NAME, PHONE_ROW, PHONE_TILE } from "./phone-rows";
import { QuestionCards } from "./question-cards";
import { QueueMark } from "./slot-queue";
import { ActionBar, useRetry } from "./task-actions";
import { TaskIcon } from "./task-icon";
import { TaskPorts } from "./task-ports";
import { TopBar } from "./top-bar";

/**
 * Every project's tasks, a line each, grouped by project: its name and the
 * marks of the conversations on it. Where the task stands in splates (its
 * status, its plan) waits behind a tap; another project's opens on that
 * project's page, where everything in its dialog is that project's.
 */
export function Tasks({
	project,
	open,
	onOpen,
}: {
	/** This project, as its snapshot has it, to find among every project the feed lists. */
	project: Here;
	/** The task whose dialog is open, by name, so it follows the task as the page reads it again. */
	open: string | null;
	onOpen: (task: string | null) => void;
}): JSX.Element {
	const { tasks } = project;
	const opened = tasks.find((task) => task.task === open) ?? null;
	const dispatching = useContext(Dispatching);
	const groups = useGroups(project);
	const none = groups === null ? tasks.length === 0 : groups.length === 0;
	useNow(!none, Duration.mins(1));

	return (
		<section aria-label="tasks" className="flex flex-col gap-2">
			<TopBar title="Tasks" />
			{none ? (
				<Empty className="min-h-80 py-16">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<TaskIcon aria-hidden />
						</EmptyMedia>
						<EmptyTitle>No tasks yet</EmptyTitle>
						<EmptyDescription>
							Start a conversation and tell an agent what you’d like to work on.
							Tasks will appear here as your agent picks up work.
						</EmptyDescription>
					</EmptyHeader>
					{dispatching !== null && (
						<EmptyContent>
							<Button
								onClick={() => dispatching.open(NEW)}
								className="max-md:min-h-11"
							>
								<SquarePenIcon data-icon="inline-start" aria-hidden />
								Start a conversation
							</Button>
						</EmptyContent>
					)}
				</Empty>
			) : groups === null ? (
				<TaskRows label="task list" rows={nested(tasks)} onOpen={onOpen} />
			) : (
				<ProjectGroups groups={groups} onOpen={onOpen} />
			)}
			<Dialog
				open={opened !== null}
				onOpenChange={(opening) => {
					if (!opening) {
						onOpen(null);
					}
				}}
			>
				{opened && <Task task={opened} />}
			</Dialog>
		</section>
	);
}

/** What the Tasks page reads of this project's snapshot. */
type Here = Pick<Snapshot, "tasks" | "root" | "repo">;

/** One project's tasks on the Tasks page. */
interface Group {
	/** Its slug, as `?project=` names it; null for this one, unlisted yet. */
	project: string | null;
	/** Its repository's name, as its page heads itself. */
	name: string;
	/** Whether it is the project this page shows. */
	here: boolean;
	tasks: Details[];
	/**
	 * What each conversation on its tasks needs, for another project's, whose
	 * `Dispatching` this page does not hold; null for this one.
	 */
	needing: Needing[] | null;
}

/**
 * Every project with tasks, as `groupsOf` gathers them, null while the feed
 * of every project is not to be had, loading or refused, when the page lists
 * this one's alone.
 */
function useGroups(here: Here): Group[] | null {
	const feed = useEverywhere(
		({ available, projects, tasks, conversations }) => ({
			available,
			projects,
			tasks,
			conversations,
		}),
	);
	return feed.available
		? groupsOf(feed.projects, feed.tasks, feed.conversations, here)
		: null;
}

/**
 * Every project with tasks, by name, this one's tasks as its snapshot has
 * them, which its dialog reads too.
 */
function groupsOf(
	projects: EverywhereSummary[],
	everywhere: InProject<Details>[],
	conversations: InProject<ConversationState>[],
	here: Here,
): Group[] {
	const listed = projects.map((project): Group => {
		if (project.root === here.root) {
			return {
				project: project.project,
				name: here.repo,
				here: true,
				tasks: here.tasks,
				needing: null,
			};
		}
		const tasks = everywhere.filter((task) => task.project === project.project);
		const its = conversations.filter(
			(conversation) => conversation.project === project.project,
		);
		return {
			project: project.project,
			name: project.repo,
			here: false,
			tasks,
			needing: needs({ tasks, conversations: its }),
		};
	});
	if (!listed.some((group) => group.here)) {
		listed.push({
			project: null,
			name: here.repo,
			here: true,
			tasks: here.tasks,
			needing: null,
		});
	}
	return listed
		.filter((group) => group.tasks.length > 0)
		.sort(
			(one, other) =>
				one.name.localeCompare(other.name) ||
				(one.project ?? "").localeCompare(other.project ?? ""),
		);
}

function nested(tasks: Details[]): Nested<Details>[] {
	return nest(tasks, (host, part) => isPartOf(part.base, host.task));
}

/** Where the Tasks page keeps the projects folded away, by slug. */
const COLLAPSED = "splates.tasks.collapsed";

/**
 * Each project's tasks under its name, which folds them away, as this
 * browser remembers. Another project's task opens on its project's page,
 * at the task.
 */
function ProjectGroups({
	groups,
	onOpen,
}: {
	groups: Group[];
	onOpen: (task: string) => void;
}): JSX.Element {
	const navigation = useContext(NavigationContext);
	const { folded, fold } = useFolded(COLLAPSED);
	return (
		<div className="flex flex-col gap-4">
			{groups.map((group) => {
				const key = group.project ?? "";
				const { project } = group;
				return (
					<Collapsible
						key={key}
						open={!folded.has(key)}
						onOpenChange={(open) => fold(key, open)}
						render={<section aria-label={group.name} />}
						className="group/project flex flex-col"
					>
						<CollapsibleTrigger className="-mx-2 flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 font-medium text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 max-md:min-h-11">
							<ChevronRightIcon
								aria-hidden
								className="size-3.5 transition-transform duration-150 group-data-[open]/project:rotate-90"
							/>
							{group.name}
							<span className="tabular-nums">{group.tasks.length}</span>
						</CollapsibleTrigger>
						<CollapsibleContent>
							<TaskRows
								label={`${group.name} tasks`}
								rows={nested(group.tasks)}
								needing={group.needing}
								onOpen={
									group.here || project === null
										? onOpen
										: (task) => navigation.show(taskUrl(project, task))
								}
							/>
						</CollapsibleContent>
					</Collapsible>
				);
			})}
		</div>
	);
}

/** Project `project`'s page, opened on its task `task`. */
function taskUrl(project: string, task: string): string {
	const url = new URL(location.href);
	url.searchParams.set("project", project);
	url.hash = `#tasks/${task}`;
	return url.toString();
}

/**
 * Tasks a line each, each part handed out from one in a list of its own
 * under it, indented. On a phone, a row is the inbox's, its name led by a
 * tile; where it stands still waits behind a tap.
 */
function TaskRows({
	label,
	rows,
	onOpen,
	needing = null,
	depth = 0,
}: {
	label: string;
	rows: Nested<Details>[];
	onOpen: (task: string) => void;
	/**
	 * What the conversations on another project's tasks need, which this
	 * page's `Dispatching` does not hold; null for this project's own.
	 */
	needing?: Needing[] | null;
	/** How many tasks it is a part of; 0 for one on its base. */
	depth?: number;
}): JSX.Element {
	return (
		<ul
			aria-label={label}
			className={cn(
				"flex flex-col",
				// A phone indents each row instead, so it still spans the screen.
				depth > 0 &&
					"ml-2 border-foreground/10 border-l pl-3 max-md:ml-0 max-md:border-l-0 max-md:pl-0",
			)}
		>
			{rows.map(({ row: task, parts }) => (
				<li key={task.task}>
					<button
						type="button"
						onClick={() => onOpen(task.task)}
						style={{ "--depth": depth } as CSSProperties}
						className={cn(
							"-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted",
							PHONE_ROW,
							"max-md:pl-[calc(1rem+3.25rem*var(--depth))]",
						)}
					>
						<span aria-hidden className={PHONE_TILE}>
							<TaskIcon />
						</span>
						<span className={cn("min-w-0 flex-1 truncate text-sm", PHONE_NAME)}>
							{task.task}
						</span>
						{(task.createdAt !== null || task.age !== null) && (
							<span
								className="shrink-0 text-muted-foreground text-xs tabular-nums"
								title="Elapsed time since this task started, including waits"
							>
								<span className="sr-only">Elapsed: </span>
								{task.createdAt === null ? task.age : age(task.createdAt)}
							</span>
						)}
						{/* Only marks, since the row is a button: its dialog opens them. */}
						{needing === null ? (
							<OnIt task={task.task} variant="marks" />
						) : (
							<ElsewhereMarks rows={needing} task={task.task} />
						)}
					</button>
					{parts.length > 0 && (
						<TaskRows
							label={`parts of ${task.task}`}
							rows={parts}
							onOpen={onOpen}
							needing={needing}
							depth={depth + 1}
						/>
					)}
				</li>
			))}
		</ul>
	);
}

/** The marks `OnIt` draws, for the conversations on another project's `task`. */
function ElsewhereMarks({
	rows,
	task,
}: {
	rows: Needing[];
	task: string;
}): JSX.Element | null {
	const on = rows.filter(({ conversation }) => conversation?.task === task);
	if (on.length === 0) {
		return null;
	}
	return (
		<span className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
			{on.map(({ conversation, need }) =>
				conversation === null ? null : (
					<span key={conversation.id} className="inline-flex items-center">
						{conversation.queue === null ? (
							<Mark need={need} reported={reportedAs(conversation)} />
						) : (
							<QueueMark spot={conversation.queue} />
						)}
					</span>
				),
			)}
		</span>
	);
}

/**
 * One task, all of it, in a dialog over the task list or a todo that names
 * it: its plan as its SPLATES.md has it, then what splates knows of it as one
 * more section, and everything to do with it in the footer.
 */
export function Task({ task }: { task: Details }): JSX.Element {
	const retry = useRetry(task);
	// Answered here only when the page has nowhere else to answer them.
	const [answering, setAnswering] = useState(false);
	const open =
		task.plan === null
			? []
			: questions(task.plan).filter(
					(each) => !each.done && each.reply === null,
				);
	return (
		<DialogContent className={cn(TASK_DIALOG, PHONE_SHEET)}>
			<DialogHeader>
				<DialogTitle className="flex items-center gap-2">
					<TaskIcon aria-hidden className="size-4 shrink-0" />
					<span className="min-w-0 break-words">{task.task}</span>
				</DialogTitle>
			</DialogHeader>
			<div className="-mx-4 flex min-w-0 flex-col gap-4 overflow-y-auto px-4 text-sm">
				{answering && open.length > 0 && (
					<QuestionCards questions={open} copy />
				)}
				{task.plan === null ? (
					<p className="text-muted-foreground">
						No SPLATES.md: whoever picks this up starts from the diff.
					</p>
				) : (
					<Markdown
						text={inlineNumbers(task.plan.replace(/^\s*#\s[^\n]*/, ""))}
					/>
				)}
				{task.planProblems.length > 0 && (
					<ul className="flex flex-col gap-1 text-muted-foreground text-xs">
						{task.planProblems.map((problem) => (
							<li key={problem}>{problem}</li>
						))}
					</ul>
				)}
				<Facts task={task} retry={retry.note} />
				<TaskPorts task={task.task} />
			</div>
			<DialogFooter className="sm:justify-between">
				<ActionBar
					task={task}
					open={open}
					retry={retry.action}
					onAnswer={() => setAnswering(true)}
				/>
			</DialogFooter>
		</DialogContent>
	);
}

const TASK_DIALOG =
	"max-h-[85dvh] grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-xl";

/**
 * The dialog on a phone: a sheet up from the bottom edge, within a thumb's
 * reach, its footer clear of the home indicator.
 */
const PHONE_SHEET =
	"max-md:top-auto max-md:bottom-0 max-md:max-h-[90dvh] max-md:max-w-full max-md:-translate-y-0 max-md:rounded-b-none max-md:data-closed:slide-out-to-bottom max-md:data-open:slide-in-from-bottom max-md:data-closed:zoom-out-100 max-md:data-open:zoom-in-100 max-md:[&_[data-slot=dialog-footer]]:pb-[max(1rem,env(safe-area-inset-bottom))]";

/**
 * `- [ ] 2. Why?` with its number escaped, so the item reads as its box and
 * `2. Why?` on one line, not a box above a list that starts at 2.
 */
function inlineNumbers(plan: string): string {
	return plan.replace(/^([ \t]*- \[[ xX]\] [Qq]?\d+)\. /gm, "$1\\. ");
}

/**
 * What splates knows of a task that its SPLATES.md does not say, as one more of
 * its sections: where it stands, its branch and how much it holds, and its
 * tree. The merges tried show only once there are some.
 */
function Facts({
	task,
	retry,
}: {
	task: Details;
	/** What Retry in the footer gives, or gave, once it is out of merges. */
	retry: ReactNode;
}): JSX.Element {
	const facts: [string, ReactNode][] = [
		["branch", `${task.branch} → ${task.base}`],
		["commits", `${task.ahead ?? "?"} commit${task.ahead === 1 ? "" : "s"}`],
	];
	if (task.added !== null) {
		facts.push([
			"diff",
			<>
				<span className="text-success">+{task.added}</span>{" "}
				<span className="text-destructive">-{task.removed ?? 0}</span>
			</>,
		]);
	}
	if (task.mergeAttempts > 0) {
		facts.push([
			"merges",
			`${task.mergeAttempts} of ${task.mergeAttemptLimit} merges tried`,
		]);
	}
	if (task.age !== null) {
		facts.push(["age", `started ${task.age} ago`]);
	}
	return (
		<section aria-label="about the task" className="flex min-w-0 flex-col">
			<h2 className={HEADING}>Task</h2>
			<DialogDescription className="text-foreground">
				{task.review === null
					? (task.escalation ?? task.status)
					: `Ready to merge: ${task.review}`}
			</DialogDescription>
			<div className="mt-1 flex min-w-0 flex-col gap-0.5 text-muted-foreground text-xs tabular-nums">
				<p className="flex min-w-0 flex-wrap gap-x-1">
					{facts.map(([name, fact], i) => (
						<span key={name} className="min-w-0 truncate">
							{i > 0 && (
								<span aria-hidden className="mr-1">
									·
								</span>
							)}
							{fact}
						</span>
					))}
				</p>
				<p className="truncate" title={task.worktree}>
					{task.worktree}
				</p>
			</div>
			{retry}
		</section>
	);
}
