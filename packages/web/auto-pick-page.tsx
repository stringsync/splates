import { age } from "@stringsync/splates-server/age";
import type { AutoPicked } from "@stringsync/splates-server/auto-pick";
import {
	DIFFICULTIES,
	KINDS,
} from "@stringsync/splates-server/auto-pick/browser";
import type { TaskRecord } from "@stringsync/splates-server/board/browser";
import type { Details } from "@stringsync/splates-server/tasks";
import {
	ChevronRightIcon,
	PencilIcon,
	SparklesIcon,
	ZapIcon,
} from "lucide-react";
import { type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { type AutoPickRun, autoPickRuns } from "./auto-pick-runs";
import { ruleAddress } from "./page-address";
import { ReferenceChip } from "./reference-chip";
import { TaskIcon } from "./task-icon";

/**
 * Auto pick's log, under its card on the Automations page: a line per pick,
 * newest first, with what started it, what it decided and the rule that
 * matched. A line opens to how sure the judge was and why, and to "Edit
 * rule", which sets the page on that rule. `only` lists the picks of one
 * rule, by its place from 0.
 */
export function AutoPickLog({
	tasks,
	todos,
	opens,
	only = null,
}: {
	tasks: readonly Details[];
	todos: readonly TaskRecord[];
	/** Opens a task a pick was for: by its number while queued, or by its name. */
	opens: { todo: (id: number) => void; task: (task: string) => void };
	only?: number | null;
}): JSX.Element {
	const runs = autoPickRuns(tasks, todos).filter(
		(run) => only === null || run.picked.rule === only,
	);
	const [shown, setShown] = useState<string | null>(null);
	if (runs.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				{only === null
					? "Nothing yet: the next task you start on Auto pick shows here."
					: `No task has been picked by rule ${only + 1} yet.`}
			</p>
		);
	}
	return (
		<ol aria-label="Auto pick log" className="flex flex-col gap-2">
			{runs.map((run) => (
				<Line
					key={run.key}
					run={run}
					open={shown === run.key}
					onToggle={() => setShown(shown === run.key ? null : run.key)}
					opens={opens}
				/>
			))}
		</ol>
	);
}

/** Auto pick's mark: a sparkles tile in amber, as the groomer's is violet. */
export function AutoPickMark({
	className,
}: {
	className?: string;
}): JSX.Element {
	return (
		<span
			aria-hidden
			className={cn(
				"flex shrink-0 items-center justify-center rounded-lg bg-amber-500/15",
				className,
			)}
		>
			<SparklesIcon className="size-1/2 fill-amber-500/25 text-amber-600 dark:text-amber-400" />
		</span>
	);
}

/** One pick in the log: a line, opening to its detail. */
function Line({
	run,
	open,
	onToggle,
	opens,
}: {
	run: AutoPickRun;
	open: boolean;
	onToggle: () => void;
	opens: { todo: (id: number) => void; task: (task: string) => void };
}): JSX.Element {
	const { picked } = run;
	const [headline] = picked.reasons;
	return (
		<li
			className={cn(
				"flex flex-col rounded-lg border bg-card text-sm",
				open && "border-amber-500/40",
			)}
		>
			<button
				type="button"
				aria-expanded={open}
				onClick={onToggle}
				className="flex w-full items-center gap-3 p-3 text-left"
			>
				<ChevronRightIcon
					aria-hidden
					className={cn(
						"size-4 shrink-0 text-muted-foreground transition-transform",
						open && "rotate-90",
					)}
				/>
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="truncate font-medium">{run.name}</span>
					<span className="truncate text-muted-foreground">
						{headline} · rule {picked.rule + 1}
					</span>
				</span>
				<span className="shrink-0 text-muted-foreground text-xs">
					{age(picked.at)} ago
				</span>
			</button>
			{open && (
				<div className="flex flex-col gap-4 border-t p-4">
					<div className="flex flex-wrap items-center gap-2">
						<span className="inline-flex items-center gap-1 rounded-full border px-2 py-px text-xs">
							<ZapIcon className="size-3" />
							task.started
						</span>
						{run.task === null ? (
							<ReferenceChip
								Icon={TaskIcon}
								kind={`#${run.todo}`}
								name=""
								title={run.name}
								open={() => run.todo !== null && opens.todo(run.todo)}
								inline
							/>
						) : (
							<ReferenceChip
								Icon={TaskIcon}
								kind=""
								name={run.task}
								title={run.task}
								open={() => run.task !== null && opens.task(run.task)}
								inline
							/>
						)}
						<span className="text-muted-foreground">
							was started on Auto pick, which decided {headline}.
						</span>
					</div>
					<Judged picked={picked} />
					<div className="flex flex-wrap items-center gap-3">
						<Button
							type="button"
							variant="outline"
							onClick={() => {
								location.hash = ruleAddress(picked.rule);
							}}
						>
							<PencilIcon data-icon="inline-start" />
							Edit rule {picked.rule + 1}
						</Button>
						<span className="text-muted-foreground">
							Opens the routing rules in Automations, set on it.
						</span>
					</div>
				</div>
			)}
		</li>
	);
}

/** How sure the judge was of the task's kind and difficulty, and the reasons given. */
function Judged({ picked }: { picked: AutoPicked }): JSX.Element {
	const [, ...why] = picked.reasons;
	const classification = picked.classified?.classification;
	return (
		<div className="flex flex-col gap-3">
			{classification !== undefined && (
				<div className="grid gap-4 sm:grid-cols-2">
					<Confidences
						title="Kind"
						classes={KINDS}
						answers={classification.kinds}
						taken={picked.kind}
					/>
					<Confidences
						title="Difficulty"
						classes={DIFFICULTIES}
						answers={classification.difficulty}
						taken={picked.difficulty}
					/>
				</div>
			)}
			<ul className="flex flex-col gap-0.5 text-muted-foreground">
				{why.map((reason) => (
					<li key={reason}>{reason}</li>
				))}
			</ul>
		</div>
	);
}

/** How sure the judge was of each class, as bars, the one taken in amber. */
function Confidences<Id extends string>({
	title,
	classes,
	answers,
	taken,
}: {
	title: string;
	classes: readonly { id: Id; label: string }[];
	answers: Record<Id, number>;
	taken: Id | null;
}): JSX.Element {
	return (
		<section aria-label={title} className="flex flex-col gap-1">
			<span className="font-medium">{title}</span>
			{classes.map((each) => {
				const percent = Math.round(answers[each.id] * 100);
				return (
					<div
						key={each.id}
						className={cn(
							"grid grid-cols-[5.5rem_1fr_2.5rem] items-center gap-2",
							each.id !== taken && "text-muted-foreground",
						)}
					>
						<span>{each.label}</span>
						<span className="h-1.5 overflow-hidden rounded-full bg-muted">
							<span
								className={cn(
									"block h-full",
									each.id === taken ? "bg-amber-500" : "bg-foreground/20",
								)}
								style={{ width: `${percent}%` }}
							/>
						</span>
						<span className="text-right tabular-nums">{percent}%</span>
					</div>
				);
			})}
		</section>
	);
}
