import type { JSX } from "react";
import { byNamespace } from "./eval-improve";

/** Repetitions a run card starts with, as the loop's first round does. */
export const DEFAULT_REPS = 3;

/** The plan to accept: the agents left on, and the repetitions. */
export type RunChoice = {
	agents: string[];
	reps: number;
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
	const starting = byNamespace(ids.filter((id) => !existing.has(id))).length;
	return (
		<section aria-label="What Start will do" className="flex flex-col gap-3">
			<div>
				<h2 className="font-medium text-lg">Review these evals</h2>
				<p className="text-muted-foreground text-xs">
					Accepting creates {starting}{" "}
					{starting === 1 ? "conversation" : "conversations"}, one per namespace
					of new scenarios
					{existing.size > 0 && ids.some((id) => existing.has(id))
						? "; scenarios that already have a conversation open it instead"
						: ""}
					. Nothing starts until you accept.
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
									? "Already has a conversation: continues there, with its current settings"
									: "New conversation for this scenario"}
							</span>
						</div>
					</li>
				))}
			</ol>
			<p className="text-muted-foreground text-xs">
				Each new conversation prepares its scenario on{" "}
				{choice.agents.join(", ")} and works its improvement loop. Repetitions
				start at their default ({choice.reps}) and are changed in each
				conversation. Every eval round waits for you to press Run there.
			</p>
		</section>
	);
}

/** Whether the chosen agents and repetitions can authorize a run. */
export function validRunChoice(choice: RunChoice): boolean {
	return (
		choice.agents.length > 0 && Number.isInteger(choice.reps) && choice.reps > 0
	);
}
