import type { EvalScenario } from "@splates/server/evals/browser";
import { ChevronDownIcon } from "lucide-react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#web/components/ui/collapsible.tsx";

/** Definitions of the scenarios requested by a run card. */
export function EvalCardScenarios({
	scenarios,
}: {
	scenarios: EvalScenario[];
}) {
	return (
		<>
			{scenarios.map((scenario) => (
				<Collapsible key={scenario.id}>
					<CollapsibleTrigger className="group flex w-full flex-col gap-1 border-t py-2 text-left">
						<span className="flex w-full items-center justify-between gap-2 font-mono text-xs">
							{scenario.id}
							<ChevronDownIcon className="size-3 shrink-0 group-aria-expanded:rotate-180" />
						</span>
						<span className="text-muted-foreground text-xs">
							{scenario.about}
						</span>
					</CollapsibleTrigger>
					<CollapsibleContent className="flex flex-col gap-3 pb-3 text-xs">
						<div>
							<p className="font-medium">Prompt</p>
							<p className="whitespace-pre-wrap">
								{scenario.prompt ??
									"This framework does not provide the prompt."}
							</p>
						</div>
						<div>
							<p className="font-medium">Checks</p>
							{scenario.checks === undefined ? (
								<p>Check definitions unavailable.</p>
							) : scenario.checks.length === 0 ? (
								<p>No code checks.</p>
							) : (
								<ul>
									{scenario.checks.map((check) => (
										<li key={check.id}>
											{check.id}: {check.about}
										</li>
									))}
								</ul>
							)}
						</div>
						<div>
							<p className="font-medium">Judge</p>
							<p className="whitespace-pre-wrap">
								{scenario.judge === undefined && scenario.prompt === undefined
									? "Judge definition unavailable."
									: (scenario.judge ?? "No judge.")}
							</p>
						</div>
						<a
							href={`#evals/plan/${encodeURIComponent(scenario.id)}`}
							className="underline"
						>
							Open full scenario: {scenario.id}
						</a>
					</CollapsibleContent>
				</Collapsible>
			))}
		</>
	);
}
