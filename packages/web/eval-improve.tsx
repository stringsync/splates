import type { EvalDetail } from "@stringsync/splates-server/evals/browser";
import { ChevronDownIcon, WrenchIcon } from "lucide-react";
import { type JSX, useContext, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";
import { cn } from "#web/lib/utils.ts";
import { AgentIcon } from "./agent-icons";
import { evalRun } from "./api";
import { still, touchItems } from "./board";
import { Dispatching } from "./dispatching";
import { targetLabel } from "./eval-report";

/** Whether a run's outcome is one worth improving: it failed or the harness could not cover it. */
export function improvable(status: string): boolean {
	return status === "fail" || status === "uncovered";
}

/**
 * What asks an agent to improve the skill or the page for `run`'s probe: the
 * probe's spec, each check that did not pass and why, the reply and where
 * the trace is, and the way to re-run only that probe, which the person
 * starts from the permission card.
 */
export function improvePrompt(run: EvalDetail): string {
	const checks = run.checks
		.filter((check) => check.status !== "pass")
		.map(
			(check) =>
				`- \`${check.id}\` (${check.assertion.kind}, ${check.status}): expected ${JSON.stringify(check.expected)}, actual ${JSON.stringify(check.actual)}`,
		);
	return `An eval probe is not passing. Improve the splates skill (\`skills/splates/\`) or the page so it does, without special-casing the probe.

Probe: \`${run.probe}\` (${run.aspect}, requirement ${run.requirement})
Requirement: ${run.requirementText}
Agent: ${targetLabel(run.target)}, repetition ${run.repetition + 1}
Outcome: ${run.status}${run.termination === "stop" ? "" : `, stopped early: ${run.termination}${run.detail === null ? "" : ` (${run.detail})`}`}

It asked the agent:

${run.input}

Checks that did not pass:

${checks.length === 0 ? "- none; see the run's events" : checks.join("\n")}

The agent's reply:

${run.reply ?? "(none)"}

Its trace and logs are in \`${run.logs}\`; the run opens on the Evals page as \`${run.id}\`.

Start a splates task for the change, and note the commit you branched from. When it is ready, ask the person to re-run only this probe with the run evals permission card, naming \`${run.probe}\` and setting \`Baseline:\` to that commit, so the re-run lands as a batch beside this one. Never start an eval yourself. The change lands only once the person approves it.`;
}

/**
 * Improve this, for a failing or uncovered run: a menu of agents, each
 * starting a conversation told what the run did and how to fix it, which
 * it opens. `run` is the id of the run `load` opens when none is at hand.
 */
export function ImproveMenu({
	run,
	className,
}: {
	/** The run, or its id to read as an agent is picked. */
	run: EvalDetail | string;
	className?: string;
}): JSX.Element | null {
	const context = useContext(Dispatching);
	const [error, setError] = useState<string | null>(null);
	if (context === null) {
		return null;
	}
	const { dispatch, open } = context;
	const improve = (agent: string): void => {
		setError(null);
		(typeof run === "string" ? evalRun(run) : Promise.resolve(run))
			.then((detail) =>
				dispatch.beginWith({ agent }, null, improvePrompt(detail)),
			)
			.then(open)
			.catch((failed: unknown) =>
				setError(failed instanceof Error ? failed.message : String(failed)),
			);
	};
	return (
		<span className="flex items-center gap-2">
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							size="sm"
							variant="outline"
							className={cn("w-fit gap-1 bg-transparent", className)}
							{...still}
						/>
					}
				>
					<WrenchIcon data-icon="inline-start" />
					Improve this
					<ChevronDownIcon className="text-muted-foreground" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className={cn("w-56", touchItems)}>
					<DropdownMenuGroup>
						<DropdownMenuLabel>Improve with</DropdownMenuLabel>
						{dispatch.agents.map((each) => (
							<DropdownMenuItem key={each.id} onClick={() => improve(each.id)}>
								<AgentIcon agent={each.id} name={each.name} />
								{each.name}
							</DropdownMenuItem>
						))}
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>
			{error !== null && (
				<span role="alert" className="text-destructive text-xs">
					{error}
				</span>
			)}
		</span>
	);
}
