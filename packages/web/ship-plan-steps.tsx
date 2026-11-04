import type { JSX } from "react";
import { Progress } from "./components/ui/progress";

const STEPS = ["Choose projects", "Review and accept", "Ship"];

/** Where the ship plan is: choosing projects, reviewing the ship, or shipping it. */
export function PlanSteps({ step }: { step: 1 | 2 | 3 }): JSX.Element {
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex justify-between text-muted-foreground text-xs">
				<span>
					Step {step} of {STEPS.length}
				</span>
				<span className="text-foreground">{STEPS[step - 1]}</span>
			</div>
			<Progress value={step} max={STEPS.length} aria-label="Ship step" />
		</div>
	);
}
