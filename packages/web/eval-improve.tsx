import type { EvalDetail } from "@stringsync/splates-server/evals/browser";
import { targetName } from "@stringsync/splates-server/evals/browser";
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

/** Whether a run's outcome is one worth improving: the agent did not do what the skill asks. */
export function improvable(status: string): boolean {
	return status === "fail";
}

/**
 * What asks an agent to work the eval loop on `run`'s scenario: the
 * requirement, each check and the judge's reason that held it back, the
 * reply, how to show the run in full, and the loop the skill's evals.md
 * lays out, whose runs the person starts from the permission card.
 */
export function improvePrompt(run: EvalDetail): string {
	const held = [
		...run.checks
			.filter((check) => !check.pass)
			.map((check) => `- Check \`${check.id}\`: ${check.about}`),
		...(run.judge?.pass === false ? [`- Judge: ${run.judge.reason}`] : []),
	];
	return `An eval scenario is not passing. Find why, which may be the skill, the scenario, its judge or the harness, and fix it, without special-casing the scenario in the skill.

Scenario: \`${run.scenario}\` (${run.aspect})
Requirement: ${run.requirement}
Agent: ${targetName(run.target)}, repetition ${run.repetition + 1}

It asked the agent:

${run.input}

What held it back:

${held.length === 0 ? "- nothing named; read the transcript" : held.join("\n")}

The agent's reply:

${run.reply || "(none)"}

The run opens on the Evals page as \`${run.id}\`, and in full with \`splates dev eval show ${run.id}\`.

Start a splates task for it and work the loop in the splates skill's \`references/evals.md\`: run this one scenario with 3 repetitions for its starting pass rate, label each failure (harness, scenario, judge or skill), fix one thing in that layer, rerun, and log the round in SPLATES.md, until it passes every repetition or three rounds bring no gain. Never start an eval yourself: ask with the run evals card.`;
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
