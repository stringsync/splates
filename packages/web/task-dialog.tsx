import { age } from "@stringsync/splates-server/age";
import type { Question } from "@stringsync/splates-server/plans";
import {
	type Need,
	need,
	questions,
} from "@stringsync/splates-server/plans/browser";
import type { Details } from "@stringsync/splates-server/tasks";
import { CheckIcon, GitBranchIcon } from "lucide-react";
import {
	type JSX,
	type ReactNode,
	useContext,
	useMemo,
	useRef,
	useState,
} from "react";
import { Markdown as Parsed } from "webappwiz/md";
import {
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "#web/components/ui/tabs.tsx";
import { cn } from "#web/lib/utils.ts";
import { Dispatching } from "./dispatching";
import { Markdown } from "./markdown";
import { QuestionCards } from "./question-cards";
import { ActionBar, useRetry } from "./task-actions";
import { TaskIcon } from "./task-icon";
import { TaskPorts } from "./task-ports";

/**
 * One task in a dialog over the task list or a todo that names it, to peek
 * at and go back: where it stands in the header, its plan split into tabs
 * so each says one thing, and everything to do with it in the footer.
 */
export function Task({ task }: { task: Details }): JSX.Element {
	const retry = useRetry(task);
	const plan = useMemo(() => planParts(task.plan), [task.plan]);
	const open = plan.asked.filter((each) => !each.done && each.reply === null);
	const [tab, setTab] = useState<Tab>("overview");
	// Answered here only when the page has nowhere else to answer them.
	const here = useContext(Dispatching) === null;
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
					{plan.asked.length > 0 && (
						<SectionTab value="questions" count={open.length}>
							Questions
						</SectionTab>
					)}
					{plan.notes !== "" && <SectionTab value="notes">Notes</SectionTab>}
					<SectionTab value="details">Details</SectionTab>
				</TabsList>
				<Section value="overview">
					<Overview task={task} plan={plan} />
				</Section>
				<Section value="questions" keepMounted>
					<Questions open={open} asked={plan.asked} copy={here} />
				</Section>
				<Section value="notes">
					<Markdown text={plan.notes} />
				</Section>
				<Section value="details">
					<Facts task={task} />
				</Section>
			</Tabs>
			<DialogFooter className="sm:justify-between">
				<ActionBar
					task={task}
					open={open}
					retry={retry.action}
					onAnswer={() => setTab("questions")}
				/>
			</DialogFooter>
		</DialogContent>
	);
}

type Tab = "overview" | "questions" | "notes" | "details";

/**
 * A steady height on a wide screen, so moving between tabs keeps the footer
 * where it is.
 */
const TASK_DIALOG =
	"max-h-[85dvh] grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] gap-3 sm:h-[min(34rem,85dvh)] sm:max-w-2xl";

/**
 * The dialog on a phone: a sheet up from the bottom edge, within a thumb's
 * reach, its footer clear of the home indicator.
 */
const PHONE_SHEET =
	"max-md:top-auto max-md:bottom-0 max-md:max-h-[90dvh] max-md:max-w-full max-md:-translate-y-0 max-md:rounded-b-none max-md:data-closed:slide-out-to-bottom max-md:data-open:slide-in-from-bottom max-md:data-closed:zoom-out-100 max-md:data-open:zoom-in-100 max-md:[&_[data-slot=dialog-footer]]:pb-[max(1rem,env(safe-area-inset-bottom))]";

function SectionTab({
	value,
	count = 0,
	children,
}: {
	value: Tab;
	/** What waits on the person there, shown beside its name while any does. */
	count?: number;
	children: ReactNode;
}): JSX.Element {
	return (
		<TabsTrigger
			value={value}
			className="flex-none px-0 text-xs group-data-horizontal/tabs:after:bottom-[-1.5px]"
		>
			{children}
			{count > 0 && (
				<span className="rounded-full bg-warning/15 px-1.5 text-[0.7rem] text-warning tabular-nums">
					{count}
				</span>
			)}
		</TabsTrigger>
	);
}

function Section({
	value,
	keepMounted = false,
	children,
}: {
	value: Tab;
	/** Whether it keeps its state while another tab shows, as what is written in a card. */
	keepMounted?: boolean;
	children: ReactNode;
}): JSX.Element {
	return (
		<TabsContent
			value={value}
			keepMounted={keepMounted}
			className="min-h-0 overflow-y-auto px-4 pt-3 pb-1 data-[hidden]:hidden"
		>
			{children}
		</TabsContent>
	);
}

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

type Tone = "waiting" | "ready" | "working" | "failed" | "quiet";

const TONES: Record<Tone, string> = {
	waiting: "bg-warning/15 text-warning",
	ready: "bg-success/15 text-success",
	working: "bg-primary/10 text-primary",
	failed: "bg-destructive/10 text-destructive",
	quiet: "bg-muted text-muted-foreground",
};

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
	const all: Need[] =
		rows.length > 0
			? rows.map((row) => row.need)
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
 * The questions its agent asked: those still open as cards, which copy a
 * reply to paste into its session where the page has nowhere else to answer
 * them, then those answered, a line each.
 */
function Questions({
	open,
	asked,
	copy,
}: {
	open: Question[];
	asked: Question[];
	copy: boolean;
}): JSX.Element {
	const answered = asked.filter((each) => each.done || each.reply !== null);
	return (
		<div className="flex min-w-0 flex-col gap-4 text-sm">
			{open.length > 0 ? (
				// Without the margin a card keeps between messages in a thread.
				<div className="[&_[data-card]]:my-0">
					<QuestionCards questions={open} copy={copy} />
				</div>
			) : (
				<p className="text-muted-foreground">No open questions.</p>
			)}
			{answered.length > 0 && (
				<section aria-label="answered" className="flex flex-col gap-1">
					<SectionHeading>Answered</SectionHeading>
					<ul className="flex flex-col gap-1">
						{answered.map((each) => (
							<li
								key={each.number}
								className="flex min-w-0 gap-2 text-muted-foreground"
							>
								<CheckIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
								<span className="min-w-0">
									{each.number}. {each.text}
									{each.reply !== null && (
										<span className="text-foreground"> → {each.reply}</span>
									)}
								</span>
							</li>
						))}
					</ul>
				</section>
			)}
		</div>
	);
}

/**
 * What splates knows of a task that its SPLATES.md does not say, a row each,
 * with how its SPLATES.md departs from the shape the skill asks for.
 */
function Facts({ task }: { task: Details }): JSX.Element {
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

/** A task's SPLATES.md, split into what each tab shows. */
interface PlanParts {
	/** `## Goal`, as markdown; "" when it has none. */
	goal: string;
	/** `## Next`, as markdown; "" when it has none. */
	steps: string;
	/** Every question under `## Blocked`, in order. */
	asked: Question[];
	/**
	 * `## Notes`, then any other section under its heading, or the whole of
	 * a plan that keeps none of the sections the skill names.
	 */
	notes: string;
}

function planParts(plan: string | null): PlanParts {
	if (plan === null) {
		return { goal: "", steps: "", asked: [], notes: "" };
	}
	const sections = Parsed.parse(plan).sections.filter(
		(section) => section.level === 2,
	);
	const named = (name: string) =>
		sections
			.find((section) => section.heading.toLowerCase() === name)
			?.body.trim() ?? "";
	const known = ["goal", "next", "notes", "blocked"];
	const others = sections.filter(
		(section) => !known.includes(section.heading.toLowerCase()),
	);
	const kept = sections.length > others.length;
	const notes = kept
		? [
				named("notes"),
				...others.map(
					(section) => `### ${section.heading}\n\n${section.body.trim()}`,
				),
			]
				.filter((part) => part !== "")
				.join("\n\n")
		: plan.replace(/^\s*#\s[^\n]*/, "").trim();
	return {
		goal: named("goal"),
		steps: named("next"),
		asked: questions(plan),
		notes,
	};
}

/** How many of the `- [ ]` steps in `steps` are checked, of how many. */
function stepsIn(steps: string): { done: number; total: number } {
	const boxes = [...steps.matchAll(/^- \[([ xX])\]/gm)];
	return {
		done: boxes.filter(([, box]) => box !== " ").length,
		total: boxes.length,
	};
}
