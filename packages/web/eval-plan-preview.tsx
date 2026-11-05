import type { EvalBudget } from "@splates/server/evals/browser";
import type { JSX } from "react";

/** Repetitions a run card starts with, as the loop's first round does. */
export const DEFAULT_REPS = 3;

/** The plan to accept: the agents left on, the repetitions and the loop's limits. */
export type RunChoice = {
	agents: string[];
	reps: number;
	limits: EvalBudget;
};

/** Review each conversation and its authorization before starting any agent. */
export function EvalPlanPreview({
	ids,
	existing,
	choice,
}: {
	ids: string[];
	existing: ReadonlySet<string>;
	choice: RunChoice;
}): JSX.Element {
	const starting = ids.filter((id) => !existing.has(id)).length;
	return (
		<section aria-label="What Start will do" className="flex flex-col gap-3">
			<div>
				<h2 className="font-medium text-lg">Review these evals</h2>
				<p className="text-muted-foreground text-xs">
					{starting} new {starting === 1 ? "conversation" : "conversations"}.
					Nothing starts until you accept.
				</p>
			</div>
			<ol className="flex flex-col rounded-lg border bg-card px-4">
				{ids.map((id, index) => (
					<li key={id} className="flex gap-3 border-b py-3.5 last:border-b-0">
						<span
							aria-hidden
							className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs"
						>
							{index + 1}
						</span>
						<div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
							<b className="break-words">{id}</b>
							<span className="text-muted-foreground text-xs">
								{existing.has(id)
									? "Continue the existing conversation with its current limits"
									: `Start a conversation · ${choice.reps} repetitions per agent · up to $${choice.limits.usd.toFixed(2)} across ${choice.limits.rounds} rounds`}
							</span>
						</div>
					</li>
				))}
			</ol>
			<p className="text-muted-foreground text-xs">
				Run on: {choice.agents.join(", ")}. Each new conversation prepares its
				scenario and works its improvement loop. Each eval round waits for you
				to press Run in its conversation.
			</p>
			<p className="font-medium text-sm">
				Total authorized eval budget: $
				{(starting * choice.limits.usd).toFixed(2)}
			</p>
		</section>
	);
}

/** Whether the chosen limits and repetitions can authorize a run. */
export function validRunChoice(choice: RunChoice): boolean {
	return (
		choice.agents.length > 0 &&
		Number.isInteger(choice.reps) &&
		choice.reps > 0 &&
		Number.isFinite(choice.limits.usd) &&
		choice.limits.usd > 0 &&
		Number.isInteger(choice.limits.rounds) &&
		choice.limits.rounds > 0
	);
}
