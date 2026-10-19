import { age } from "@stringsync/splates-server/age";
import type { AutoPicked } from "@stringsync/splates-server/auto-pick";
import {
	DIFFICULTIES,
	KINDS,
	ruleLabel,
} from "@stringsync/splates-server/auto-pick/browser";
import type { TaskRecord } from "@stringsync/splates-server/board/browser";
import type { Details } from "@stringsync/splates-server/tasks";
import { useReactive } from "@webappwiz/react";
import { ArrowLeftIcon, SparklesIcon, ZapIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { PickChips } from "./auto-pick-pick-chips";
import { RulesEditor } from "./auto-pick-rules";
import { type AutoPickRun, autoPickRuns } from "./auto-pick-runs";
import { ReferenceChip } from "./reference-chip";
import { Refusal, useRefusal } from "./refusal";
import { TaskIcon } from "./task-icon";

/**
 * Auto pick's own page, for the sidebar's and inbox's entry: what started the
 * pick the page shows, what it decided and how sure the judge was, and the
 * rule it matched, to change for the tasks like it. The newest pick shows
 * first; an earlier one opens from the list under it.
 */
export function AutoPickPage({
	tasks,
	todos,
	opens,
	onBack,
}: {
	tasks: readonly Details[];
	todos: readonly TaskRecord[];
	/** Opens a task a pick was for: by its number while queued, or by its name. */
	opens: { todo: (id: number) => void; task: (task: string) => void };
	/** Goes back to the list, on a phone; null beside a sidebar. */
	onBack: (() => void) | null;
}): JSX.Element {
	const runs = autoPickRuns(tasks, todos);
	const [chosen, setChosen] = useState<string | null>(null);
	const run = runs.find((each) => each.key === chosen) ?? runs[0] ?? null;
	return (
		<div className="flex min-w-0 flex-col gap-6">
			<header className="flex items-center gap-3">
				{onBack !== null && (
					<Button
						type="button"
						variant="ghost"
						size="icon"
						aria-label="Back"
						onClick={onBack}
					>
						<ArrowLeftIcon />
					</Button>
				)}
				<AutoPickMark className="size-8" />
				<div className="flex min-w-0 flex-col">
					<h1 className="font-semibold text-lg">Auto pick</h1>
					<p className="text-muted-foreground text-sm">
						Picks an agent for each task that names none, by your routing rules.
					</p>
				</div>
			</header>
			{run === null ? (
				<p className="text-muted-foreground text-sm">
					Nothing yet: the next task you start on Auto pick shows here.
				</p>
			) : (
				<>
					<Trigger run={run} opens={opens} />
					<Outcome picked={run.picked} />
					<Change picked={run.picked} />
					{runs.length > 1 && (
						<Earlier runs={runs} shown={run} onShow={setChosen} />
					)}
				</>
			)}
		</div>
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

function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}): JSX.Element {
	return (
		<section aria-label={title} className="flex flex-col gap-2">
			<h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
				{title}
			</h2>
			{children}
		</section>
	);
}

/** What set the pick off: starting the task, with the task, and when. */
function Trigger({
	run,
	opens,
}: {
	run: AutoPickRun;
	opens: { todo: (id: number) => void; task: (task: string) => void };
}): JSX.Element {
	return (
		<Section title="Trigger">
			<div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-4 text-sm">
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
				<span>was started on Auto pick</span>
				<span className="text-muted-foreground">
					· {age(run.picked.at)} ago
				</span>
			</div>
		</Section>
	);
}

/** What it decided: the pick, the rule that matched, and the judge's confidences. */
function Outcome({ picked }: { picked: AutoPicked }): JSX.Element {
	const [headline, ...why] = picked.reasons;
	const classification = picked.classified?.classification;
	return (
		<Section title="Outcome">
			<div className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
				<p className="font-medium text-base">{headline}</p>
				<p className="text-muted-foreground">Matched rule {picked.rule + 1}</p>
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
		</Section>
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

/**
 * The matched rule's picks, to change for every task it matches, saved to
 * the machine's rules at once as Setup's editor does.
 */
function Change({ picked }: { picked: AutoPicked }): JSX.Element {
	const [editor] = useState(() => new RulesEditor());
	const { draft, dirty, saved, loadProblem } = useReactive(
		editor,
		(each) => ({
			draft: each.draft,
			dirty: each.dirty,
			saved: each.saved,
			loadProblem: each.loadProblem,
		}),
		["changed"],
	);
	const { refusal, attempt } = useRefusal();
	useEffect(() => void editor.load(), [editor]);
	const rule = draft.rules[picked.rule];
	return (
		<Section title="Change the outcome for tasks like this">
			<div className="flex flex-col gap-3 rounded-lg border bg-card p-4 text-sm">
				{loadProblem !== null ? (
					<p role="alert" className="text-destructive">
						Could not read your rules: {loadProblem}
					</p>
				) : saved === null ? (
					<p className="text-muted-foreground">Reading your rules…</p>
				) : rule === undefined ? (
					<p className="text-muted-foreground">
						Your rules have changed since: this pick's rule is gone.
					</p>
				) : (
					<>
						<p>
							Rule {picked.rule + 1}, for{" "}
							<span className="font-medium">{ruleLabel(rule)}</span>, starts on:
						</p>
						<PickChips editor={editor} rule={picked.rule} picks={rule.picks} />
						<div className="flex items-center gap-3">
							<Button
								type="button"
								disabled={!dirty}
								onClick={() => void attempt(editor.save(), "Could not save")}
							>
								Save to rule {picked.rule + 1}
							</Button>
							<span className="text-muted-foreground">
								Applies to future starts only.
							</span>
						</div>
						<Refusal refusal={refusal} className="text-sm" />
					</>
				)}
			</div>
		</Section>
	);
}

/** The other picks, newest first, each opening in the page above. */
function Earlier({
	runs,
	shown,
	onShow,
}: {
	runs: readonly AutoPickRun[];
	shown: AutoPickRun;
	onShow: (key: string) => void;
}): JSX.Element {
	return (
		<Section title="Earlier picks">
			<ul className="flex flex-col">
				{runs.map((each) => (
					<li key={each.key}>
						<button
							type="button"
							aria-current={each === shown ? "true" : undefined}
							onClick={() => onShow(each.key)}
							className={cn(
								"flex w-full items-baseline gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
								each === shown && "bg-accent",
							)}
						>
							<span className="min-w-0 flex-1 truncate">{each.name}</span>
							<span className="shrink-0 text-muted-foreground text-xs">
								{each.picked.reasons[0]} · {age(each.picked.at)} ago
							</span>
						</button>
					</li>
				))}
			</ul>
		</Section>
	);
}
