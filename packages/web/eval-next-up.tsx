import type {
	EvalScenario,
	EvalScenarioState,
} from "@splates/server/evals/browser";
import { type JSX, useEffect, useState } from "react";
import { evalRun } from "./api";
import { Button } from "./components/ui/button";

/** The worst failing scenario with the judge's reason, and the button to run it. */
export function NextUp({
	label,
	row,
	onRun,
}: {
	label?: string;
	row: { scenario: EvalScenario; state: EvalScenarioState };
	onRun: (ids: string[]) => void;
}): JSX.Element {
	const [reason, setReason] = useState<string | null>(null);
	const run = row.state.run;
	useEffect(() => {
		let current = true;
		setReason(null);
		if (run !== null) {
			evalRun(run).then(
				(detail) => current && setReason(detail.judge?.reason ?? null),
				() => {},
			);
		}
		return () => {
			current = false;
		};
	}, [run]);
	return (
		<section
			aria-label="next up"
			className="flex items-start justify-between gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3"
		>
			<div className="flex min-w-0 flex-col gap-1">
				<span className="text-muted-foreground text-xs uppercase">Next up</span>
				<span className="font-medium text-sm">{row.scenario.id}</span>
				{reason !== null && (
					<p className="line-clamp-3 text-muted-foreground text-xs">{reason}</p>
				)}
			</div>
			<Button
				size="sm"
				className="min-h-9 shrink-0"
				aria-label={`${label ? "Open loop for" : "Run"} next up ${row.scenario.id}`}
				onClick={() => onRun([row.scenario.id])}
			>
				{label ?? "Run"}
			</Button>
		</section>
	);
}
