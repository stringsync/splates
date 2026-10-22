import type { AutoPickTrial } from "@stringsync/splates-server/auto-pick";
import { DEPTHS, KINDS } from "@stringsync/splates-server/auto-pick/browser";
import type { TaskRecord } from "@stringsync/splates-server/board";
import { useReactive } from "@webappwiz/react";
import { type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Field,
	FieldDescription,
	FieldLabel,
} from "#web/components/ui/field.tsx";
import {
	NativeSelect,
	NativeSelectOption,
} from "#web/components/ui/native-select.tsx";
import type { TrialRun } from "./auto-pick-trial";
import { Refusal, useRefusal } from "./refusal";

/**
 * Picks a task and shows what Auto pick would start it on, on the rules
 * saved now: the pick, how sure the judge was of each kind and depth,
 * the rule that matched and why. Starts nothing and changes no task.
 */
export function TrialView({
	run,
	todos,
}: {
	run: TrialRun;
	todos: readonly TaskRecord[];
}): JSX.Element {
	const { trial, trying } = useReactive(
		run,
		(each) => ({ trial: each.trial, trying: each.trying }),
		["changed"],
	);
	const [chosen, setChosen] = useState(todos[0]?.id ?? null);
	const { refusal, attempt } = useRefusal();
	if (todos.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				This project has no tasks yet: add one, then come back to try it.
			</p>
		);
	}
	return (
		<div className="flex flex-col gap-6">
			<Field>
				<FieldLabel htmlFor="auto-pick-task">Task</FieldLabel>
				<div className="flex flex-wrap items-center gap-3">
					<NativeSelect
						id="auto-pick-task"
						className="min-w-0 max-w-full flex-1"
						value={chosen ?? ""}
						onChange={(event) => setChosen(Number(event.currentTarget.value))}
					>
						{todos.map((todo) => (
							<NativeSelectOption key={todo.id} value={todo.id}>
								#{todo.id} {todo.subject}
								{todo.takenBy === null ? "" : " (started)"}
							</NativeSelectOption>
						))}
					</NativeSelect>
					<Button
						type="button"
						variant="outline"
						disabled={chosen === null || trying}
						onClick={() =>
							chosen !== null &&
							void attempt(run.run({ todo: chosen }), "Could not try it")
						}
					>
						{trying ? "Trying…" : "Try it"}
					</Button>
				</div>
				<FieldDescription>
					Asks the judge, unless an earlier Auto pick kept what it said of the
					same words; nothing starts and the task stays as it is.
				</FieldDescription>
			</Field>
			<Refusal refusal={refusal} className="text-sm" />
			{trial !== null && <TrialResult trial={trial} />}
		</div>
	);
}

/** What a try decided, and why. */
function TrialResult({ trial }: { trial: AutoPickTrial }): JSX.Element {
	const { decision, classification } = trial;
	const [headline, ...why] = decision.reasons;
	return (
		<section
			aria-label="Auto pick would start"
			className="flex flex-col gap-3 rounded-lg border bg-card p-4 text-sm"
		>
			<p>
				<span className="text-muted-foreground">Would start on </span>
				<span className="font-medium">{headline}</span>
			</p>
			<p className="text-muted-foreground">
				Rule {decision.rule + 1}
				{trial.cached ? " · from what the judge said before" : ""}
			</p>
			{classification !== null && (
				<div className="grid grid-cols-2 gap-4">
					<Confidences
						title="Kind"
						classes={KINDS}
						answers={classification.kinds}
						taken={decision.kind}
					/>
					<Confidences
						title="Depth"
						classes={DEPTHS}
						answers={classification.depth}
						taken={decision.depth}
					/>
				</div>
			)}
			<ul
				aria-label="Why"
				className="flex flex-col gap-0.5 text-muted-foreground"
			>
				{why.map((reason) => (
					<li key={reason}>{reason}</li>
				))}
			</ul>
		</section>
	);
}

/** How sure the judge was of each class, the one taken marked. */
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
		<dl aria-label={title} className="flex flex-col gap-0.5">
			<dt className="font-medium">{title}</dt>
			{classes.map((each) => (
				<dd
					key={each.id}
					className={
						each.id === taken
							? "flex justify-between font-medium"
							: "flex justify-between text-muted-foreground"
					}
				>
					<span>{each.label}</span>
					<span className="tabular-nums">
						{Math.round(answers[each.id] * 100)}%
					</span>
				</dd>
			))}
		</dl>
	);
}
