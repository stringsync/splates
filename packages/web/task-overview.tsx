import { cleared, deferralBlockers } from "@splates/server/board/browser";
import { type JSX, useContext } from "react";
import { BeforeAfter } from "./before-after";
import { Board } from "./board";
import { CardSection } from "./card-section";
import { deferredTask } from "./deferred-body";
import { Markdown } from "./markdown";
import type { PlanParts } from "./task-plan-parts";
import { stepsIn } from "./task-plan-parts";
import { TaskPorts } from "./task-ports";

/**
 * A task dialog's Overview, for a live task or a finished one alike: what
 * the task is for and how far it got, its Goal, what was verified, and
 * its steps with how many are done; and for a live one, the
 * ports it serves, to open what it runs.
 */
export function Overview({
	task,
	plan,
	none,
	ports = false,
}: {
	task: string;
	/** Its SPLATES.md in parts, or null for none. */
	plan: PlanParts | null;
	/** What to say when it has no SPLATES.md. */
	none: string;
	/** Whether it may still serve ports, as only a live task does. */
	ports?: boolean;
}): JSX.Element {
	const steps = stepsIn(plan?.steps ?? "");
	const record =
		plan === null || (plan.before === "" && plan.goal === "")
			? null
			: { before: plan.before, after: plan.goal };
	const board = useContext(Board);
	const deferredRecord = deferredTask(board.todos, task);
	const deferred = deferredRecord?.deferred;
	const open =
		deferredRecord === null
			? []
			: deferralBlockers(deferredRecord, board.todos).filter(
					(each) => !cleared(each),
				);
	return (
		<div className="flex min-w-0 flex-col gap-6 text-sm">
			{deferred !== undefined && (
				<CardSection label="deferral" title="Deferred">
					<p>{deferred.why}</p>
					{open.length > 0 && (
						<ul className="list-disc pl-5 text-muted-foreground">
							{open.map((each, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of strings
								<li key={i}>
									{each.kind === "task"
										? `#${each.id} ${each.subject}`
										: each.kind === "question"
											? each.text.split("\n")[0]
											: each.what}
								</li>
							))}
						</ul>
					)}
				</CardSection>
			)}
			{plan === null ? (
				<p className="text-muted-foreground">{none}</p>
			) : plan.goal === "" && plan.before === "" && plan.steps === "" ? (
				<p className="text-muted-foreground">Its SPLATES.md has no Goal yet.</p>
			) : (
				<>
					{record !== null && <BeforeAfter record={record} />}
					{plan.verification !== "" && (
						<CardSection label="verification" title="Verification">
							<Markdown text={plan.verification} />
						</CardSection>
					)}
					{plan.steps !== "" && (
						<CardSection
							label="steps"
							title={
								<>
									Steps
									{steps.total > 0 && (
										<span className="font-normal tabular-nums">
											{steps.done} of {steps.total}
										</span>
									)}
								</>
							}
							defaultOpen={steps.total === 0 || steps.done < steps.total}
						>
							<Markdown text={plan.steps} />
						</CardSection>
					)}
				</>
			)}
			{ports && <TaskPorts task={task} />}
		</div>
	);
}
