import type { JSX, ReactNode } from "react";
import { Markdown } from "./markdown";
import { DemoButton } from "./task-demo";
import type { PlanParts } from "./task-plan-parts";
import { stepsIn } from "./task-plan-parts";
import { TaskPorts } from "./task-ports";

/**
 * A task dialog's Overview, for a live task or a finished one alike: what
 * the task is for and how far it got, its Goal, what was verified with a
 * demo to start beside it, and its steps with how many are done; and for a live one, the
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
	return (
		<div className="flex min-w-0 flex-col gap-4 text-sm">
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
					{/* What was checked, its screenshots with it, and a demo to
					see it for yourself: one body of evidence. */}
					{(plan.verification !== "" || plan.demo !== "") && (
						<section aria-label="verification" className="flex flex-col gap-1">
							{/* The button by the heading, where screenshots below
							never push it out of sight. */}
							<div className="flex items-center justify-between gap-2">
								<SectionHeading>Verification</SectionHeading>
								{plan.demo !== "" && <DemoButton task={task} />}
							</div>
							{plan.verification !== "" && (
								<Markdown text={plan.verification} />
							)}
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
