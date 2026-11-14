import type { EvalBudgetStatus } from "@splates/server/evals/browser";
import { TriangleAlertIcon } from "lucide-react";
import type { JSX } from "react";
import {
	Alert,
	AlertAction,
	AlertDescription,
} from "#web/components/ui/alert.tsx";
import { Button } from "#web/components/ui/button.tsx";
import { Progress } from "#web/components/ui/progress.tsx";
import { budgetText, ceilCents } from "./eval-status";

/** Shows a run's cost against its budget once started, and before that warns when the plan's most is over the budget in the card. */
export function EvalBudgetLine({
	status,
	started,
	usd,
	ceiling,
	onUpdate,
}: {
	status: EvalBudgetStatus;
	/** Whether this card's run has started, so the status is its own. */
	started: boolean;
	/** The budget typed in the card for this run. */
	usd: number;
	/** The most the run could cost, when it is about to start; null otherwise. */
	ceiling: number | null;
	onUpdate: (usd: number) => void;
}): JSX.Element | null {
	if (started) {
		const percent = Math.min(
			100,
			Math.round((status.spentUsd / status.budget.usd) * 100),
		);
		const tone =
			percent >= 100
				? "[&_[data-slot=progress-indicator]]:bg-destructive"
				: percent >= 80
					? "[&_[data-slot=progress-indicator]]:bg-amber-500"
					: "";
		return (
			<div
				data-testid="budget"
				className="mx-4 mb-3 flex flex-col gap-1.5 text-muted-foreground text-xs"
			>
				<Progress value={percent} aria-label="Budget spent" className={tone} />
				<div className="flex justify-between">
					<span>
						{budgetText(status)}
						{percent >= 100 ? " · budget reached" : ""}
					</span>
					<span>{percent}%</span>
				</div>
			</div>
		);
	}
	if (ceiling === null || usd >= ceilCents(ceiling)) {
		return null;
	}
	const enough = ceilCents(ceiling);
	return (
		<div data-testid="budget" className="mb-1 text-xs">
			<Alert
				variant="warning"
				className="flex items-center gap-x-2 has-data-[slot=alert-action]:pr-2.5"
			>
				<TriangleAlertIcon aria-hidden />
				<AlertDescription className="min-w-0 flex-1">
					The most this run can cost is ${enough.toFixed(2)}, over the budget of
					${usd.toFixed(2)}.
				</AlertDescription>
				<AlertAction className="static shrink-0">
					<Button size="sm" variant="outline" onClick={() => onUpdate(enough)}>
						Raise to ${enough.toFixed(2)}
					</Button>
				</AlertAction>
			</Alert>
		</div>
	);
}
