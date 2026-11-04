import type { JSX } from "react";
import { cn } from "./lib/utils";

/** Where the ship plan is: choosing projects, or reviewing the ship. */
export function PlanSteps({ reviewing }: { reviewing: boolean }): JSX.Element {
	const steps = ["Choose", "Review"];
	return (
		<ol aria-label="Ship steps" className="flex items-center gap-2 text-xs">
			{steps.map((label, index) => {
				const on = (index === 1) === reviewing;
				return (
					<li
						key={label}
						aria-current={on ? "step" : undefined}
						className={cn(
							"rounded-full px-2.5 py-0.5",
							on
								? "bg-primary text-primary-foreground"
								: "bg-muted text-muted-foreground",
						)}
					>
						{index + 1} {label}
					</li>
				);
			})}
		</ol>
	);
}
