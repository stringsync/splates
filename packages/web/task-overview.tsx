import {
	cleared,
	deferralBlockers,
} from "@stringsync/splates-server/board/browser";
import { type JSX, type ReactNode, useContext } from "react";
import { Board } from "./board";
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
		<div className="flex min-w-0 flex-col gap-4 text-sm">
			{deferred !== undefined && (
				<section aria-label="deferral" className="flex flex-col gap-1">
					<SectionHeading>Deferred</SectionHeading>
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
				</section>
			)}
			{plan === null ? (
				<p className="text-muted-foreground">{none}</p>
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
			{ports && <TaskPorts task={task} />}
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
