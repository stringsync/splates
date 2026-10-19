import { age } from "@stringsync/splates-server/age";
import {
	answersTo,
	type Need,
	need,
} from "@stringsync/splates-server/plans/browser";
import type { Details } from "@stringsync/splates-server/tasks";
import { GitBranchIcon } from "lucide-react";
import {
	type JSX,
	type ReactNode,
	useContext,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import { Tabs, TabsList } from "#web/components/ui/tabs.tsx";
import { cn } from "#web/lib/utils.ts";
import { Dispatching } from "./dispatching";
import { Held, SubagentComposer } from "./handed-out";
import { Markdown } from "./markdown";
import { ActionBar, useRetry } from "./task-actions";
import { AutoPickFact } from "./task-auto-pick";
import { DemoButtons } from "./task-demo";
import { TaskIcon } from "./task-icon";
import { type PlanParts, planParts, stepsIn } from "./task-plan-parts";
import { TaskPorts } from "./task-ports";
import {
	PHONE_SHEET,
	Section,
	SectionTab,
	TASK_DIALOG,
	TONES,
	type Tone,
} from "./task-sections";
import { Sessions } from "./task-sessions";

/**
 * One task in a dialog over the task list or a todo that names it, to peek
 * at and go back: where it stands in the header, its plan split into tabs
 * so each says one thing, and everything to do with it in the footer.
 */
export function Task({ task }: { task: Details }): JSX.Element {
	const retry = useRetry(task);
	const plan = useMemo(() => planParts(task.plan), [task.plan]);
	const [tab, setTab] = useState<Tab>("overview");
	const context = useContext(Dispatching);
	const external =
		context === null ? null : context.dispatch.external(task.task);
	// A subagent a conversation here started answers to that one, through it.
	const by = useContext(Held);
	const caller =
		external === null ? null : answersTo({ conversation: null, task }, by);
	// Focus lands on the dialog, not its first tab, so a peek opens without a ring.
	const dialog = useRef<HTMLDivElement>(null);
	return (
		<DialogContent
			ref={dialog}
			initialFocus={dialog}
			className={cn(TASK_DIALOG, PHONE_SHEET)}
		>
			<Header task={task} retry={retry.note} />
			<Tabs
				value={tab}
				onValueChange={(value: Tab) => setTab(value)}
				className="-mx-4 min-h-0 gap-0"
			>
				<TabsList
					variant="line"
					aria-label="sections"
					className="h-9! w-full justify-start gap-3 rounded-none border-b px-4 py-0 max-md:h-11!"
				>
					<SectionTab value="overview">Overview</SectionTab>
					{plan.notes !== "" && <SectionTab value="notes">Notes</SectionTab>}
					<SectionTab value="details">Details</SectionTab>
				</TabsList>
				<Section value="overview">
					{caller !== null && context !== null && (
						<div className="mb-4">
							<SubagentComposer
								task={task.task}
								by={caller}
								onOpen={(id) => context.open(id)}
							/>
						</div>
					)}
					<Overview task={task} plan={plan} />
				</Section>
				<Section value="notes">
					<Markdown text={plan.notes} />
				</Section>
				<Section value="details">
					<div className="flex min-w-0 flex-col gap-4">
						<Facts task={task} external={external !== null} />
						{external !== null && caller === null && context !== null && (
							<Sessions
								task={task.task}
								agents={context.dispatch.agents}
								onBrought={(conversation) => {
									context.dispatch.brought(conversation);
									context.open(conversation.id);
								}}
							/>
						)}
					</div>
				</Section>
			</Tabs>
			<DialogFooter className="sm:justify-between">
				<ActionBar task={task} retry={retry.action} />
			</DialogFooter>
		</DialogContent>
	);
}

type Tab = "overview" | "notes" | "details";

/**
 * The task's name, where it stands and why, and the line of facts a glance
 * wants: its branch, how much it holds, how long it has run.
 */
function Header({
	task,
	retry,
}: {
	task: Details;
	/** What Retry in the footer gives, or gave, once it is out of merges. */
	retry: ReactNode;
}): JSX.Element {
	const standing = useStanding(task);
	const started = task.createdAt === null ? task.age : age(task.createdAt);
	return (
		<DialogHeader className="gap-1.5">
			<DialogTitle className="flex items-center gap-2 pr-8">
				<TaskIcon aria-hidden className="size-4 shrink-0" />
				<span className="min-w-0 break-words">{task.task}</span>
			</DialogTitle>
			<DialogDescription className="flex min-w-0 items-baseline gap-2 text-foreground">
				<span
					className={cn(
						"shrink-0 rounded-md px-1.5 py-px font-medium text-xs",
						TONES[standing.tone],
					)}
				>
					{standing.label}
				</span>
				{standing.why !== null && (
					<span className="min-w-0 text-sm">{standing.why}</span>
				)}
			</DialogDescription>
			<p className="flex min-w-0 flex-wrap items-center gap-x-1 text-muted-foreground text-xs tabular-nums">
				<GitBranchIcon aria-hidden className="size-3 shrink-0" />
				<span className="min-w-0 truncate" title={task.branch}>
					{task.branch}
				</span>
				<span>
					→ {task.base}
					{" · "}
					{task.ahead ?? "?"} commit{task.ahead === 1 ? "" : "s"}
					{task.added !== null && (
						<>
							{" · "}
							<span className="text-success">+{task.added}</span>{" "}
							<span className="text-destructive">−{task.removed ?? 0}</span>
						</>
					)}
					{task.mergeAttempts > 0 &&
						` · ${task.mergeAttempts} of ${task.mergeAttemptLimit} merges tried`}
					{started !== null && ` · ${started}`}
				</span>
			</p>
			{retry}
		</DialogHeader>
	);
}

/** A task's standing: a word for it, and what it is about, when anything says. */
interface Standing {
	label: string;
	tone: Tone;
	why: string | null;
}

/** The most pressing need first, as the page ranks them. */
const PRESSING: Need["kind"][] = ["waiting", "assuming", "working", "idle"];

/**
 * Where a task stands, from what the agents on it need, most pressing first:
 * the conversations here on it, or with none, the task itself, as an agent
 * outside the page or none at all leaves it.
 */
function useStanding(task: Details): Standing {
	const context = useContext(Dispatching);
	const rows = context?.dispatch.on(task.task) ?? [];
	const external = context?.dispatch.external(task.task) ?? null;
	const all: Need[] =
		rows.length > 0
			? rows.map((row) => row.need)
			: external !== null
				? [external]
				: context?.dispatch.orphaned(task.task)
					? [
							{
								kind: "waiting",
								why: "orphaned",
								subject: "No agent is left on it",
								since: null,
								questions: [],
							},
						]
					: [need(task, null)];
	const [first] = all.toSorted(
		(one, other) => PRESSING.indexOf(one.kind) - PRESSING.indexOf(other.kind),
	);
	return standingOf(task, first ?? { kind: "idle" });
}

/** Why an agent waits on the person. */
type Why = Extract<Need, { kind: "waiting" }>["why"];

/** What each reason an agent waits on the person reads as. */
const WAITING: Record<Why, Omit<Standing, "why">> = {
	review: { label: "Ready to merge", tone: "ready" },
	questions: { label: "Waiting on you", tone: "waiting" },
	ask: { label: "Waiting on you", tone: "waiting" },
	failed: { label: "Failed", tone: "failed" },
	orphaned: { label: "Orphaned", tone: "quiet" },
};

function standingOf(task: Details, need: Need): Standing {
	switch (need.kind) {
		case "waiting":
			return { ...WAITING[need.why], why: need.subject };
		case "assuming":
		case "working":
			return { label: "Working", tone: "working", why: need.subject };
		case "idle":
			return {
				label: task.status.charAt(0).toUpperCase() + task.status.slice(1),
				tone: "quiet",
				why: null,
			};
	}
}

/**
 * What the task is for and how far it has got: its Goal, its steps with how
 * many are done, and the ports it serves, to open what it runs.
 */
function Overview({
	task,
	plan,
}: {
	task: Details;
	plan: PlanParts;
}): JSX.Element {
	const steps = stepsIn(plan.steps);
	return (
		<div className="flex min-w-0 flex-col gap-4 text-sm">
			{task.plan === null ? (
				<p className="text-muted-foreground">
					No SPLATES.md: whoever picks this up starts from the diff.
				</p>
			) : plan.goal === "" && plan.steps === "" ? (
				<p className="text-muted-foreground">Its SPLATES.md has no Goal yet.</p>
			) : (
				<>
					{plan.goal !== "" && (
						<section aria-label="goal" className="flex flex-col gap-1">
							<SectionHeading>Goal</SectionHeading>
							<Markdown text={plan.goal} />
						</section>
					)}
					{plan.verification !== "" && (
						<section aria-label="verification" className="flex flex-col gap-1">
							<SectionHeading>Verification</SectionHeading>
							<Markdown text={plan.verification} />
						</section>
					)}
					{plan.demo !== "" && (
						<DemoButtons task={task.task} conversation={task.takenBy} />
					)}
					{plan.steps !== "" && (
						<section aria-label="steps" className="flex flex-col gap-1">
							<SectionHeading>
								Steps
								{steps.total > 0 && (
									<span className="font-normal tabular-nums">
										{steps.done} of {steps.total}
									</span>
								)}
							</SectionHeading>
							<Markdown text={plan.steps} />
						</section>
					)}
				</>
			)}
			<TaskPorts task={task.task} />
		</div>
	);
}

function SectionHeading({ children }: { children: ReactNode }): JSX.Element {
	return (
		<h3 className="flex items-baseline gap-2 font-medium text-muted-foreground text-xs">
			{children}
		</h3>
	);
}

/**
 * What splates knows of a task that its SPLATES.md does not say, a row each,
 * with how its SPLATES.md departs from the shape the skill asks for.
 */
function Facts({
	task,
	external,
}: {
	task: Details;
	/** Whether an agent outside the page has it, of which the page knows only signs. */
	external: boolean;
}): JSX.Element {
	const facts: [string, ReactNode][] = [
		["Branch", task.branch],
		["Base", task.base],
		[
			"Worktree",
			<span key="worktree" className="select-all break-all">
				{task.worktree}
			</span>,
		],
		["Commits", `${task.ahead ?? "?"} not on ${task.base}`],
	];
	if (task.added !== null) {
		facts.push([
			"Changes",
			<>
				<span className="text-success">+{task.added}</span>{" "}
				<span className="text-destructive">−{task.removed ?? 0}</span> lines
			</>,
		]);
	}
	facts.push([
		"Merges tried",
		`${task.mergeAttempts} of ${task.mergeAttemptLimit}`,
	]);
	if (task.age !== null) {
		facts.push(["Started", `${task.age} ago`]);
	}
	if (task.activeAt !== null) {
		facts.push(["Last active", `${age(task.activeAt)} ago`]);
	}
	if (external) {
		facts.push([
			"Its agent",
			task.lease === "held"
				? "Outside the page, running a splates command now"
				: "Outside the page, or gone: the page sees only its edits, commits and splates commands",
		]);
	}
	if (task.autoPick !== null) {
		facts.push([
			"Auto pick",
			<AutoPickFact key="auto-pick" picked={task.autoPick} />,
		]);
	}
	if (task.planProblems.length > 0) {
		facts.push([
			"SPLATES.md",
			<ul key="problems" className="flex flex-col gap-0.5">
				{task.planProblems.map((problem) => (
					<li key={problem}>{problem}</li>
				))}
			</ul>,
		]);
	}
	return (
		<dl
			aria-label="about the task"
			className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs"
		>
			{facts.map(([name, fact]) => (
				<div key={name} className="contents">
					<dt className="text-muted-foreground">{name}</dt>
					<dd className="min-w-0 tabular-nums">{fact}</dd>
				</div>
			))}
		</dl>
	);
}
