import type {
	EvalBudgetStatus,
	EvalPlan,
	EvalStatus,
} from "@splates/server/evals/browser";
import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";

/** How each outcome is colored, wherever a run's status shows. */
const TONES: Record<EvalStatus, string> = {
	pass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
	fail: "bg-destructive/15 text-destructive",
	error: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
	unreadable: "bg-destructive/15 text-destructive",
	pending: "bg-muted text-muted-foreground",
};

/** A run's outcome as a chip: its word, colored by how it went. */
export function StatusChip({
	status,
	className,
}: {
	status: EvalStatus;
	className?: string;
}): JSX.Element {
	return (
		<span
			className={cn(
				"inline-flex h-5 shrink-0 items-center rounded-full px-2 font-medium text-xs whitespace-nowrap",
				TONES[status],
				className,
			)}
		>
			{status}
		</span>
	);
}

/** Tokens, dollars and time, "?" where a run could not say. */
export function spent({
	tokens,
	costUsd,
	milliseconds,
}: {
	tokens: number | null;
	costUsd: number | null;
	milliseconds?: number;
}): string {
	return [
		tokens === null ? "? tokens" : `${tokens.toLocaleString()} tokens`,
		costUsd === null ? "$?" : `$${costUsd.toFixed(2)}`,
		...(milliseconds === undefined
			? []
			: [`${(milliseconds / 1000).toFixed(1)}s`]),
	].join(" · ");
}

/** Outcomes in the order a tally reads them, the worst first. */
export const ORDER: EvalStatus[] = [
	"fail",
	"error",
	"unreadable",
	"pending",
	"pass",
];

/** What the plan says of the run: its ceiling, its refusal, or that the project prints none. */
export function planText(plan: EvalPlan): string {
	if (plan.refused) {
		return plan.output;
	}
	if (plan.usd === null) {
		return plan.output !== ""
			? plan.output
			: "This project prints no plan, so the run shows no cost ceiling.";
	}
	const runs =
		plan.cells === null
			? ""
			: ` across ${plan.cells} ${plan.cells === 1 ? "run" : "runs"}`;
	return `At most $${plan.usd.toFixed(2)}${runs}.`;
}

/** `$spent of $budget` with the tokens beside it, as a budget line reads. */
export function budgetText(status: EvalBudgetStatus): string {
	const tokens =
		status.tokens > 0 ? ` · ${status.tokens.toLocaleString()} tokens` : "";
	return `$${status.spentUsd.toFixed(2)} of $${status.budget.usd.toFixed(2)}${tokens}`;
}

/** `round n of max`, n being the rounds started. */
export function roundsText(status: EvalBudgetStatus): string {
	return `round ${status.roundsUsed} of ${status.budget.rounds}`;
}

/** Which limit stopped the loop, or null while there is room. */
export function stoppedText(status: EvalBudgetStatus): string | null {
	return status.stoppedBy === "rounds"
		? "Stopped: the round cap is reached."
		: status.stoppedBy === "usd"
			? "Stopped: the dollar budget is used up."
			: null;
}
